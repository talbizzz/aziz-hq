-- Milestone 2, contract C3: claim, heartbeat, complete, fail. service_role only (ADR-13).

-- Attributes the events written by the next updates (read by log_status_event). Transaction-local; always cleared after.
create function public.set_event_context(p_actor_type text, p_actor_id text, p_data jsonb default '{}') returns void
language sql
set search_path = ''
as $$
  select set_config('app.actor_type', p_actor_type, true),
         set_config('app.actor_id', coalesce(p_actor_id, ''), true),
         set_config('app.event_data', p_data::text, true);
$$;

create function public.clear_event_context() returns void
language sql
set search_path = ''
as $$
  select set_config('app.actor_type', '', true), set_config('app.actor_id', '', true), set_config('app.event_data', '', true);
$$;

create function public.claim_task(p_worker_id text, p_lease_seconds int default 120) returns setof public.tasks
language plpgsql
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'lease must be positive' using errcode = 'invalid_parameter_value';
  end if;

  select t.* into v_task
  from public.tasks t
  join public.runs r on r.id = t.run_id
  where t.status = 'pending'
    and t.type in ('agent', 'system')
    and r.status in ('pending', 'running')
    and not exists (select 1 from public.tasks d where d.id = any (t.depends_on) and d.status <> 'done')
    -- an active pause override stops claiming (gates still open)
    and not exists (select 1 from public.overrides o where o.kind = 'pause' and o.cleared_at is null and o.expires_at > now())
  order by t.priority desc, t.created_at, t.id
  for update of t skip locked
  limit 1;

  if not found then
    return;
  end if;

  perform public.set_event_context('worker', p_worker_id,
    jsonb_build_object('reason', 'claimed', 'attempt', v_task.attempts + 1, 'worker', p_worker_id));
  update public.tasks
     set status = 'running',
         lease_until = now() + make_interval(secs => p_lease_seconds),
         claimed_by = p_worker_id,
         attempts = attempts + 1
   where id = v_task.id
   returning * into v_task;
  update public.runs set status = 'running' where id = v_task.run_id and status = 'pending';
  perform public.clear_event_context();

  return next v_task;
end $$;

create function public.heartbeat_task(p_task_id uuid, p_worker_id text, p_lease_seconds int default 120) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.tasks
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_task_id and status = 'running' and claimed_by = p_worker_id;
  return found;
end $$;

create function public.complete_task(p_task_id uuid, p_worker_id text, p_result jsonb default '{}') returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  perform public.set_event_context('worker', p_worker_id, jsonb_build_object('reason', 'completed'));
  update public.tasks
     set status = 'done', result = coalesce(p_result, '{}')
   where id = p_task_id and status = 'running' and claimed_by = p_worker_id;
  v_updated := found; -- PERFORM below resets FOUND
  perform public.clear_event_context();
  return v_updated;
end $$;

create function public.fail_task(p_task_id uuid, p_worker_id text, p_error jsonb default '{}', p_retryable boolean default true) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_retry boolean;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.status <> 'running' or v_task.claimed_by is distinct from p_worker_id then
    return 'ignored';
  end if;

  v_retry := p_retryable and v_task.attempts < v_task.max_attempts;
  perform public.set_event_context('worker', p_worker_id, jsonb_build_object(
    'reason', case when v_retry then 'retry' else 'failed' end,
    'attempt', v_task.attempts,
    'error', left(coalesce(p_error ->> 'message', p_error ->> 'kind', ''), 500)
  ));
  if v_retry then
    update public.tasks set status = 'pending' where id = p_task_id;
  else
    update public.tasks set status = 'failed', result = coalesce(p_error, '{}') where id = p_task_id;
  end if;
  perform public.clear_event_context();
  return case when v_retry then 'retried' else 'failed' end;
end $$;

revoke all on function public.set_event_context(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.clear_event_context() from public, anon, authenticated;
revoke all on function public.claim_task(text, int) from public, anon, authenticated;
revoke all on function public.heartbeat_task(uuid, text, int) from public, anon, authenticated;
revoke all on function public.complete_task(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_task(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.set_event_context(text, text, jsonb), public.clear_event_context(),
  public.claim_task(text, int), public.heartbeat_task(uuid, text, int), public.complete_task(uuid, text, jsonb),
  public.fail_task(uuid, text, jsonb, boolean) to service_role;
