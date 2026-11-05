begin;
select plan(42);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');
delete from public.notifications;
delete from public.worker_heartbeats;
delete from public.settings where key = 'worker_alert';

-- extensions and the two cron jobs (the manual migration registers them)
select ok(exists (select 1 from pg_extension where extname = 'pg_net'), 'pg_net is installed');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select ok(exists (select 1 from pg_extension where extname = 'supabase_vault'), 'supabase_vault is installed');
select is((select schedule from cron.job where jobname = 'flush_notifications'), '* * * * *', 'flush job runs every minute');
select is((select command from cron.job where jobname = 'flush_notifications'), 'select public.flush_notifications()', 'flush job command');
select is((select schedule from cron.job where jobname = 'worker_watchdog'), '*/3 * * * *', 'watchdog job runs every 3 minutes');
select is((select command from cron.job where jobname = 'worker_watchdog'), 'select public.watchdog_tick()', 'watchdog job command');

-- privileges: service_role only; the helpers are private
select ok(has_function_privilege('service_role', 'public.telegram_config()', 'execute'), 'service_role can telegram_config');
select ok(not has_function_privilege('authenticated', 'public.telegram_config()', 'execute'), 'authenticated cannot telegram_config');
select ok(not has_function_privilege('anon', 'public.telegram_config()', 'execute'), 'anon cannot telegram_config');
select ok(not has_function_privilege('public', 'public.telegram_config()', 'execute'), 'PUBLIC cannot telegram_config');
select ok(not has_function_privilege('authenticated', 'public.send_telegram_direct(text)', 'execute'), 'authenticated cannot send directly');
select ok(not has_function_privilege('authenticated', 'public.flush_notifications()', 'execute'), 'authenticated cannot flush');
select ok(not has_function_privilege('authenticated', 'public.watchdog_tick()', 'execute'), 'authenticated cannot tick the watchdog');
select ok(has_function_privilege('service_role', 'public.watchdog_tick()', 'execute'), 'service_role can tick the watchdog');
select ok(not has_function_privilege('service_role', 'public.vault_secret(text)', 'execute'), 'the vault reader is private');
select ok(not has_function_privilege('service_role', 'public.http_post_json(text, jsonb, jsonb)', 'execute'), 'the HTTP wrapper is private');

-- not configured: config is null-filled, sending refuses, flushing is a quiet no-op
select is((public.telegram_config() ->> 'bot_token'), null, 'no bot token without a Vault secret');
select throws_ok($$select public.send_telegram_direct('x')$$, 'P0001', 'telegram is not configured', 'sending without configuration refuses');

-- stub the HTTP wrapper: record the request instead of sending it
create temp table http_calls (url text, headers jsonb, body jsonb) on commit drop;
create or replace function public.http_post_json(p_url text, p_headers jsonb, p_body jsonb) returns bigint
language sql set search_path = '' as $$
  insert into pg_temp.http_calls values (p_url, p_headers, p_body);
  select 42::bigint
$$;

select public.flush_notifications();
select is((select count(*)::int from http_calls), 0, 'flush without configuration makes no request');

-- configure through Vault
select vault.create_secret('TOKEN123', 'telegram_bot_token');
select vault.create_secret('4242', 'telegram_chat_id');
select vault.create_secret('whsecret', 'telegram_webhook_secret');
select vault.create_secret('flushsecret', 'flush_secret');
select vault.create_secret('https://proj.supabase.co/functions/v1', 'functions_url');
select vault.create_secret('https://hq.example.test', 'dashboard_url');
select is(public.telegram_config(), '{"bot_token":"TOKEN123","chat_id":"4242","webhook_secret":"whsecret","flush_secret":"flushsecret","dashboard_url":"https://hq.example.test","functions_url":"https://proj.supabase.co/functions/v1"}'::jsonb, 'telegram_config reads every value from Vault');
select pg_temp.act_as_service();
select is((public.telegram_config() ->> 'chat_id'), '4242', 'service_role can read the config');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select throws_ok($$select public.telegram_config()$$, '42501', null, 'even the owner cannot read the config through the API');
reset role;

select is(public.send_telegram_direct('hello'), 42::bigint, 'send_telegram_direct returns the request id');
select is((select url from http_calls order by ctid desc limit 1), 'https://api.telegram.org/botTOKEN123/sendMessage', 'it calls the Bot API sendMessage with the token from Vault');
select is((select body from http_calls order by ctid desc limit 1), '{"chat_id": 4242, "text": "hello"}'::jsonb, 'the chat id is sent as a number');
select is((select headers ->> 'Content-Type' from http_calls order by ctid desc limit 1), 'application/json', 'JSON content type');

delete from http_calls;
select public.flush_notifications();
select is((select url from http_calls), 'https://proj.supabase.co/functions/v1/telegram/flush', 'flush calls the Edge Function flush route');
select is((select headers ->> 'x-flush-secret' from http_calls), 'flushsecret', 'with the shared secret header');

-- watchdog: one direct alert per outage, marked as sent via pg_net
delete from http_calls;
insert into public.worker_heartbeats (worker_id, last_seen_at) values ('w', now() - interval '10 minutes');
select is(public.watchdog_tick(), 'alerted', 'a stale worker is alerted');
select is((select count(*)::int from http_calls), 1, 'one Telegram request');
select ok((select body ->> 'text' like '%offline%' from http_calls), 'the text says the worker is offline');
select is((select status from public.notifications where kind = 'worker_offline'), 'sent', 'the notification is marked sent');
select is((select payload ->> 'via' from public.notifications where kind = 'worker_offline'), 'pg_net', 'sent via pg_net');
select is(public.watchdog_tick(), 'none', 'the next tick has nothing to say');
select is((select count(*)::int from http_calls), 1, 'and sends nothing again');
update public.worker_heartbeats set last_seen_at = now();
select is(public.watchdog_tick(), 'recovered', 'the worker returns');
select is((select count(*)::int from http_calls), 2, 'one more request');
select ok((select body ->> 'text' like '%back online%' from http_calls order by ctid desc limit 1), 'the text says it is back online');

-- watchdog with Telegram not configured keeps the notification pending (the flush path may still deliver it)
delete from vault.secrets where name in ('telegram_bot_token', 'telegram_chat_id');
delete from http_calls;
update public.worker_heartbeats set last_seen_at = now() - interval '10 minutes';
select is(public.watchdog_tick(), 'alerted', 'a second outage is detected');
select is((select count(*)::int from http_calls), 0, 'but without Telegram configuration nothing is sent');
select is((select count(*)::int from public.notifications where kind = 'worker_offline' and status = 'pending'), 1, 'and the notification stays pending');

select * from finish();
rollback;
