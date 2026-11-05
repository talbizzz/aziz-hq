SET check_function_bodies = false;
CREATE FUNCTION public.claim_task(p_worker_id text, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.claim_task(text, integer) TO service_role;
CREATE FUNCTION public.clear_event_context()
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select set_config('app.actor_type', '', true), set_config('app.actor_id', '', true), set_config('app.event_data', '', true);
$function$;
GRANT ALL ON FUNCTION public.clear_event_context() TO service_role;
CREATE FUNCTION public.complete_task(p_task_id uuid, p_worker_id text, p_result jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.complete_task(uuid, text, jsonb) TO service_role;
CREATE FUNCTION public.fail_task(p_task_id uuid, p_worker_id text, p_error jsonb DEFAULT '{}'::jsonb, p_retryable boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
GRANT ALL ON FUNCTION public.fail_task(uuid, text, jsonb, boolean) TO service_role;
CREATE FUNCTION public.heartbeat_task(p_task_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  update public.tasks
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_task_id and status = 'running' and claimed_by = p_worker_id;
  return found;
end $function$;
GRANT ALL ON FUNCTION public.heartbeat_task(uuid, text, integer) TO service_role;
CREATE FUNCTION public.set_event_context(p_actor_type text, p_actor_id text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select set_config('app.actor_type', p_actor_type, true),
         set_config('app.actor_id', coalesce(p_actor_id, ''), true),
         set_config('app.event_data', p_data::text, true);
$function$;
GRANT ALL ON FUNCTION public.set_event_context(text, text, jsonb) TO service_role;
