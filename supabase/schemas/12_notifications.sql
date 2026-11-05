-- Milestone 3, contract C1: the notification outbox (ADR-14). Written by triggers and the watchdog, read by the
-- Edge Function (service_role) and the owner. Not in the Realtime publication: the dashboard inbox shows gates.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gate_open', 'run_done', 'run_failed', 'worker_offline', 'worker_online')),
  priority smallint not null check (priority between 0 and 2),
  gate_task_id uuid,
  run_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  deliver_after timestamptz not null default now(),
  attempts int not null default 0,
  sent_at timestamptz,
  telegram_message_id bigint,
  error text,
  created_at timestamptz not null default now()
);
create unique index notifications_gate_open_once on public.notifications (gate_task_id) where kind = 'gate_open';
create index notifications_pending_idx on public.notifications (status, deliver_after) where status = 'pending';

alter table public.notifications enable row level security;
