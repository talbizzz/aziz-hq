-- Milestone 3, contract C1: manual overrides. Active = not cleared and not expired (expiry needs no job).
create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pause', 'off_today', 'working', 'stop', 'sleeping', 'custom', 'limit', 'pacing_bypass_day', 'pacing_bypass_week')),
  expires_at timestamptz not null,
  created_by text not null check (created_by in ('dashboard', 'telegram', 'system')),
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  -- only for the `custom` mode (usage cap in percent); the other modes take their cap from the usage_policy setting
  cap_pct smallint check (cap_pct between 0 and 100)
);
-- at most one uncleared row per kind; set_override clears the previous one first
create unique index overrides_one_open_per_kind on public.overrides (kind) where cleared_at is null;

alter table public.overrides enable row level security;

create view public.active_overrides with (security_invoker = true) as
  select id, kind, expires_at, created_by, created_at, cap_pct
  from public.overrides
  where cleared_at is null and expires_at > now();
