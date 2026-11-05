-- Contract C3.

-- True only for the single owner AND only when the session is MFA-verified (aal2): ADR-1.
create function public.is_owner() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_owner where user_id = (select auth.uid()))
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Used by the keepalive job (T1.12).
create function public.health() returns text
language sql
stable
set search_path = ''
as $$ select 'ok' $$;
revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Callers may set app.actor_type / app.actor_id (transaction-local) before an update to attribute the event.
create function public.current_actor_type() returns public.actor_type
language sql
stable
set search_path = ''
as $$ select coalesce(nullif(current_setting('app.actor_type', true), ''), 'system')::public.actor_type $$;

create function public.current_actor_id() returns text
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('app.actor_id', true), '') $$;

-- Requirement 7: every status change produces an event (ADR-3). Used on runs and tasks.
create function public.log_status_event() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_data jsonb := '{}';
  v_run_id uuid;
  v_task_id uuid;
begin
  if tg_op = 'INSERT' then
    v_kind := 'created';
  else
    v_kind := 'status_changed';
    v_data := jsonb_build_object('from', old.status, 'to', new.status);
  end if;
  -- scheduler functions attach context (reason, attempt, ...) with set_config('app.event_data', '{...}', true)
  v_data := v_data || coalesce(nullif(current_setting('app.event_data', true), '')::jsonb, '{}');

  if tg_table_name = 'runs' then
    v_run_id := new.id;
  else
    v_run_id := new.run_id;
    v_task_id := new.id;
  end if;

  insert into public.events (run_id, task_id, entity_type, entity_id, kind, actor_type, actor_id, data)
  values (
    v_run_id, v_task_id,
    case tg_table_name when 'runs' then 'run' else 'task' end,
    new.id, v_kind, public.current_actor_type(), public.current_actor_id(), v_data
  );
  return new;
end $$;

create function public.log_gate_event() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_data jsonb := '{}';
begin
  if tg_op = 'INSERT' then
    v_kind := 'gate_created';
  else
    v_kind := 'gate_decided';
    v_data := jsonb_build_object('decision', new.decision, 'via', new.decided_via);
  end if;

  insert into public.events (run_id, task_id, entity_type, entity_id, kind, actor_type, actor_id, data)
  values (
    (select run_id from public.tasks where id = new.task_id),
    new.task_id, 'gate', new.task_id, v_kind, public.current_actor_type(), public.current_actor_id(), v_data
  );
  return new;
end $$;

create function public.events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'events are append-only';
end $$;
