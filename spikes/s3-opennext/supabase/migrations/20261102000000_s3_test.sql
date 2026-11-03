create table public.s3_events (id bigint generated always as identity primary key, note text not null, created_at timestamptz not null default now());
alter table public.s3_events enable row level security;
create policy s3_select_aal2 on public.s3_events for select to authenticated using ((auth.jwt()->>'aal') = 'aal2');
alter publication supabase_realtime add table public.s3_events;
-- new tables get no default grants for API roles on this Supabase version: grant explicitly
grant select on public.s3_events to authenticated;
grant all on public.s3_events to service_role;
