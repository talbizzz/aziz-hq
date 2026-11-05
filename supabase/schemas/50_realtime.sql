-- ADR-4: tables the dashboard subscribes to. Mirrored by supabase/migrations/20261105110800_realtime_publication.sql.
alter publication supabase_realtime add table public.runs, public.tasks, public.gates, public.events, public.worker_heartbeats;
alter publication supabase_realtime add table public.overrides;
alter publication supabase_realtime add table public.usage_snapshots;
