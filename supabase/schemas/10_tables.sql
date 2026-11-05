-- Core schema (Milestone 1, contract C2). Writes go through the service role or RPCs (ADR-2).

create table public.app_owner (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
-- at most one owner row
create unique index app_owner_single on public.app_owner ((true));

create table public.modules (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  demo_note text,
  created_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  module_id text not null references public.modules (id),
  title text not null,
  status public.run_status not null default 'pending',
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  type public.task_type not null,
  role text,
  title text not null,
  status public.task_status not null default 'pending',
  depends_on uuid[] not null default '{}',
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts >= 1),
  lease_until timestamptz,
  claimed_by text,
  priority int not null default 0,
  lane text,
  payload jsonb not null default '{}',
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_agent_has_role check (type <> 'agent' or role is not null),
  constraint tasks_lease_only_when_running check (lease_until is null or status = 'running')
);
create index tasks_run_status_idx on public.tasks (run_id, status);
create index tasks_pending_queue_idx on public.tasks (status, priority desc, created_at) where status = 'pending';

create table public.gates (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  kind text not null check (
    kind in ('spec', 'plan', 'milestone_review', 'release', 'checklist', 'budget', 'usage_extension', 'secret_request', 'escalation', 'other')
  ),
  -- 0 info, 1 normal, 2 blocking
  priority smallint not null default 1 check (priority between 0 and 2),
  title text not null,
  context jsonb not null default '{}',
  options jsonb not null default '[]',
  decision public.gate_decision,
  comment text,
  decided_at timestamptz,
  decided_via text check (decided_via in ('dashboard', 'telegram')),
  created_at timestamptz not null default now(),
  constraint gates_decision_matches_decided_at check ((decision is null) = (decided_at is null))
);

create function public.gates_task_must_be_gate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tasks where id = new.task_id and type = 'gate') then
    raise exception 'gate % must reference a task of type gate', new.task_id using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger gates_task_must_be_gate
  before insert or update of task_id on public.gates
  for each row execute function public.gates_task_must_be_gate();

-- No foreign keys: events must survive deletions of what they describe. Append-only guard lives in 30_triggers.sql.
create table public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  run_id uuid,
  task_id uuid,
  entity_type text not null,
  entity_id uuid,
  kind text not null,
  actor_type public.actor_type not null default 'system',
  actor_id text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_run_idx on public.events (run_id, id);
create index events_task_idx on public.events (task_id, id);

-- Empty until M4.
create table public.usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  task_id uuid,
  role text,
  model text,
  runner text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create table public.worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now(),
  info jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_owner enable row level security;
alter table public.modules enable row level security;
alter table public.runs enable row level security;
alter table public.tasks enable row level security;
alter table public.gates enable row level security;
alter table public.events enable row level security;
alter table public.usage enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.settings enable row level security;
