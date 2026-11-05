-- New public tables get no default grants on this Supabase version (spike S3), so every privilege is explicit.
-- The dashboard (authenticated) can only read, plus update settings; anon gets nothing; the worker uses service_role.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.app_owner, public.modules, public.runs, public.tasks, public.gates,
  public.events, public.usage, public.worker_heartbeats, public.settings to authenticated;
grant update on public.settings to authenticated;

grant all on all tables in schema public to service_role;
