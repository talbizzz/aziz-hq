-- Milestone 4, contract C1: the latest reading of the Claude plan windows (from the stream-json rate_limit_event, spike S1).
create table public.usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  source text not null check (source in ('rate_limit_event', 'estimate')),
  five_hour_pct numeric(5, 2) not null check (five_hour_pct between 0 and 100),
  five_hour_resets_at timestamptz not null,
  seven_day_pct numeric(5, 2) not null check (seven_day_pct between 0 and 100),
  seven_day_resets_at timestamptz not null,
  run_id uuid,
  task_id uuid
);
create index usage_snapshots_at_idx on public.usage_snapshots (at desc);

alter table public.usage_snapshots enable row level security;
