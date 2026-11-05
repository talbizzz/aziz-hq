SET check_function_bodies = false;
CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog;
CREATE FUNCTION public.flush_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.flush_notifications() TO service_role;
CREATE FUNCTION public.http_post_json(p_url text, p_headers jsonb, p_body jsonb)
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select net.http_post(url := p_url, headers := p_headers, body := p_body) $function$;
CREATE FUNCTION public.send_telegram_direct(p_text text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.send_telegram_direct(text) TO service_role;
CREATE FUNCTION public.telegram_config()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'bot_token', public.vault_secret('telegram_bot_token'),
    'chat_id', public.vault_secret('telegram_chat_id'),
    'webhook_secret', public.vault_secret('telegram_webhook_secret'),
    'flush_secret', public.vault_secret('flush_secret'),
    'dashboard_url', public.vault_secret('dashboard_url'),
    'functions_url', public.vault_secret('functions_url')
  )
$function$;
GRANT ALL ON FUNCTION public.telegram_config() TO service_role;
CREATE FUNCTION public.vault_secret(p_name text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $function$;
CREATE FUNCTION public.watchdog_tick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.watchdog_tick() TO service_role;
