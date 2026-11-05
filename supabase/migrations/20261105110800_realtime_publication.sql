-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md): the diff tool does not track publication
-- membership or DML. ADR-4.
alter publication supabase_realtime add table public.runs, public.tasks, public.gates, public.events, public.worker_heartbeats;

insert into public.modules (id, name) values ('factory', 'SaaS Factory') on conflict do nothing;
