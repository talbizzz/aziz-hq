-- New public tables get no default grants on this Supabase version (spike S3), so every privilege is explicit.
-- The dashboard (authenticated) can only read, plus update settings; anon gets nothing; the worker uses service_role.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.app_owner, public.modules, public.runs, public.tasks, public.gates,
  public.events, public.usage, public.worker_heartbeats, public.settings to authenticated;
grant update on public.settings to authenticated;

grant all on all tables in schema public to service_role;

-- Default ACLs: new tables and functions carry no implicit privileges for API roles or PUBLIC, so every grant is
-- explicit. Mirrored by supabase/migrations/20261105110810_lock_down_table_privileges.sql (the diff tool tracks default ACLs).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
