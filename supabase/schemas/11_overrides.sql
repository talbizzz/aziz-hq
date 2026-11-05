-- Milestone 3, contract C1: manual overrides. Active = not cleared and not expired (expiry needs no job).
create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pause', 'off_today')),
  expires_at timestamptz not null,
  created_by text not null check (created_by in ('dashboard', 'telegram')),
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
-- at most one uncleared row per kind; set_override clears the previous one first
create unique index overrides_one_open_per_kind on public.overrides (kind) where cleared_at is null;

alter table public.overrides enable row level security;

create view public.active_overrides with (security_invoker = true) as
  select id, kind, expires_at, created_by, created_at
  from public.overrides
  where cleared_at is null and expires_at > now();
