-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md): the generated migration before this one drops and recreates
-- the view public.active_overrides (new cap_pct column), and the diff tool does not re-emit grants on a recreated view.
grant select on public.active_overrides to authenticated;
grant all on public.active_overrides to service_role;
