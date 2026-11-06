-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md). The hosted Supabase platform grants every new function, table
-- and sequence in public to anon and authenticated by default (the local stack does not), and the diff tool never emits
-- REVOKEs. Found when verifying the first hosted push: anon could execute all 45 public functions (including
-- telegram_config) and held full table privileges. This makes the privileges exact, on any database, idempotently.

-- 1. functions: nothing for PUBLIC/anon/authenticated, then grant back exactly what the API roles call
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.health() to anon, authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.next_local_midnight(timestamptz, text) to authenticated, service_role;
grant execute on function public.resolve_gate(uuid, public.gate_decision, text) to authenticated;
grant execute on function public.set_override(text, integer, text) to authenticated, service_role;
grant execute on function public.clear_override(text) to authenticated, service_role;
grant execute on function public.set_mode_override(text, integer, integer, text) to authenticated, service_role;
-- the private helpers are callable only by the security definer functions that wrap them
revoke all on function public.vault_secret(text) from service_role;
revoke all on function public.http_post_json(text, jsonb, jsonb) from service_role;

-- 2. tables, views and sequences: the dashboard reads (RLS decides which rows) and the owner updates settings
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.app_owner, public.modules, public.runs, public.tasks, public.gates, public.events, public.usage,
  public.worker_heartbeats, public.settings, public.overrides, public.notifications, public.usage_snapshots,
  public.active_overrides to authenticated;
grant update on public.settings to authenticated;

-- 3. default privileges: future objects start locked, whichever role creates them
do $$
declare
  creator text;
begin
  foreach creator in array array['postgres', 'supabase_admin'] loop
    begin
      execute format('alter default privileges for role %I in schema public revoke all on functions from public, anon, authenticated', creator);
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon, authenticated', creator);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated', creator);
    exception when insufficient_privilege then
      raise notice 'cannot change the default privileges of role %', creator;
    end;
  end loop;
end $$;
