-- Milestone 3, contract C2: Vault access, direct Telegram sends, the flush trigger and the watchdog job body.
-- Secrets live only in Vault (ADR-14); everything that reads them is service_role-only.

-- Private helpers: no role can execute these directly, only the security definer functions below.
create function public.vault_secret(p_name text) returns text
language sql
security definer
set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;

-- The one place that performs HTTP, so tests can replace it with a recorder.
create function public.http_post_json(p_url text, p_headers jsonb, p_body jsonb) returns bigint
language sql
set search_path = ''
as $$ select net.http_post(url := p_url, headers := p_headers, body := p_body) $$;

create function public.telegram_config() returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bot_token', public.vault_secret('telegram_bot_token'),
    'chat_id', public.vault_secret('telegram_chat_id'),
    'webhook_secret', public.vault_secret('telegram_webhook_secret'),
    'flush_secret', public.vault_secret('flush_secret'),
    'dashboard_url', public.vault_secret('dashboard_url'),
    'functions_url', public.vault_secret('functions_url')
  )
$$;

create function public.send_telegram_direct(p_text text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := public.vault_secret('telegram_bot_token');
  v_chat text := public.vault_secret('telegram_chat_id');
begin
  if v_token is null or v_chat is null then
    raise exception 'telegram is not configured';
  end if;
  return public.http_post_json(
    'https://api.telegram.org/bot' || v_token || '/sendMessage',
    '{"Content-Type": "application/json"}',
    jsonb_build_object('chat_id', case when v_chat ~ '^-?[0-9]+$' then to_jsonb(v_chat::bigint) else to_jsonb(v_chat) end, 'text', p_text)
  );
end $$;

-- Called every minute by pg_cron: asks the Edge Function to send what is due. A missing configuration is a quiet no-op.
create function public.flush_notifications() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.vault_secret('functions_url');
  v_secret text := public.vault_secret('flush_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  perform public.http_post_json(
    v_url || '/telegram/flush',
    jsonb_build_object('Content-Type', 'application/json', 'x-flush-secret', v_secret),
    '{}'
  );
end $$;

-- Called every 3 minutes by pg_cron. Alerts go straight to the Bot API (independent of the Edge Function, which may be
-- the thing that broke). Without Telegram configuration the notification stays pending for the flush path.
create function public.watchdog_tick() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text := public.check_worker_offline();
  v_note public.notifications;
  v_text text;
begin
  if public.vault_secret('telegram_bot_token') is null or public.vault_secret('telegram_chat_id') is null then
    return v_result;
  end if;

  for v_note in
    select * from public.notifications where status = 'pending' and kind in ('worker_offline', 'worker_online') order by created_at, id
  loop
    v_text := case v_note.kind
      when 'worker_offline' then format('⚠️ Worker offline: no heartbeat for %s min.', round((v_note.payload ->> 'age_seconds')::numeric / 60))
      else '✅ Worker is back online.'
    end;
    perform public.send_telegram_direct(v_text);
    update public.notifications
       set status = 'sent', sent_at = now(), payload = payload || jsonb_build_object('via', 'pg_net')
     where id = v_note.id;
  end loop;
  return v_result;
end $$;

revoke all on function public.vault_secret(text) from public, anon, authenticated, service_role;
revoke all on function public.http_post_json(text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.telegram_config() from public, anon, authenticated;
revoke all on function public.send_telegram_direct(text) from public, anon, authenticated;
revoke all on function public.flush_notifications() from public, anon, authenticated;
revoke all on function public.watchdog_tick() from public, anon, authenticated;
grant execute on function public.telegram_config(), public.send_telegram_direct(text), public.flush_notifications(),
  public.watchdog_tick() to service_role;
