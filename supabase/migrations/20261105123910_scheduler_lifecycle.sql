SET check_function_bodies = false;
CREATE FUNCTION public.cancel_blocked_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_round int;
  v_total int := 0;
begin
  perform public.set_event_context('system', 'scheduler', jsonb_build_object('reason', 'dependency_cancelled'));
  loop
    update public.tasks t
       set status = 'cancelled'
     where t.status in ('pending', 'waiting_human')
       and exists (select 1 from public.tasks d where d.id = any (t.depends_on) and d.status = 'cancelled');
    get diagnostics v_round = row_count;
    exit when v_round = 0;
    v_total := v_total + v_round;
  end loop;
  perform public.clear_event_context();
  return v_total;
end $function$;
GRANT ALL ON FUNCTION public.cancel_blocked_tasks() TO service_role;
CREATE FUNCTION public.decide_gate(p_task_id uuid, p_decision public.gate_decision, p_comment text DEFAULT NULL::text, p_via text DEFAULT 'dashboard'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_status public.task_status;
  v_decision public.gate_decision;
begin
  select t.status, g.decision into v_status, v_decision
    from public.tasks t join public.gates g on g.task_id = t.id
   where t.id = p_task_id and t.type = 'gate'
   for update of t, g;
  if not found then
    raise exception 'not a gate' using errcode = 'invalid_parameter_value';
  end if;

  if v_decision is not null then
    return jsonb_build_object('first', false, 'decision', v_decision);
  end if;
  if v_status <> 'waiting_human' then
    raise exception 'gate is not open' using errcode = 'invalid_parameter_value';
  end if;
  if p_via not in ('dashboard', 'telegram') then
    raise exception 'invalid decided_via: %', p_via using errcode = 'invalid_parameter_value';
  end if;
  if p_decision in ('modify', 'answer') and btrim(coalesce(p_comment, '')) = '' then
    raise exception 'comment required' using errcode = 'invalid_parameter_value';
  end if;

  perform public.set_event_context('human', p_via, '{}');
  update public.gates
     set decision = p_decision, comment = p_comment, decided_at = now(), decided_via = p_via
   where task_id = p_task_id;
  update public.tasks
     set status = case when p_decision = 'dismiss' then 'cancelled'::public.task_status else 'done'::public.task_status end,
         result = jsonb_build_object('decision', p_decision, 'comment', p_comment)
   where id = p_task_id;
  perform public.clear_event_context();

  return jsonb_build_object('first', true, 'decision', p_decision);
end $function$;
GRANT ALL ON FUNCTION public.decide_gate(uuid, public.gate_decision, text, text) TO service_role;
CREATE FUNCTION public.promote_ready_gates()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_count int;
begin
  perform public.set_event_context('system', 'scheduler', jsonb_build_object('reason', 'gate_open'));
  update public.tasks t
     set status = 'waiting_human'
   where t.type = 'gate'
     and t.status = 'pending'
     and exists (select 1 from public.runs r where r.id = t.run_id and r.status in ('pending', 'running'))
     and not exists (select 1 from public.tasks d where d.id = any (t.depends_on) and d.status <> 'done');
  get diagnostics v_count = row_count;
  perform public.clear_event_context();
  return v_count;
end $function$;
GRANT ALL ON FUNCTION public.promote_ready_gates() TO service_role;
CREATE FUNCTION public.reap_expired_leases()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_task public.tasks;
  v_count int := 0;
begin
  for v_task in
    select * from public.tasks where status = 'running' and lease_until < now() order by lease_until for update skip locked
  loop
    perform public.set_event_context('system', 'reaper',
      jsonb_build_object('reason', 'lease_expired', 'attempt', v_task.attempts, 'worker', v_task.claimed_by));
    if v_task.attempts < v_task.max_attempts then
      update public.tasks set status = 'pending' where id = v_task.id;
    else
      update public.tasks set status = 'failed', result = jsonb_build_object('kind', 'lease_expired') where id = v_task.id;
    end if;
    perform public.clear_event_context();
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;
GRANT ALL ON FUNCTION public.reap_expired_leases() TO service_role;
CREATE FUNCTION public.scheduler_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_reaped int;
  v_gates int;
  v_cancelled int;
  v_settled int;
begin
  v_reaped := public.reap_expired_leases();
  v_gates := public.promote_ready_gates();
  v_cancelled := public.cancel_blocked_tasks();
  v_settled := public.settle_runs();
  return jsonb_build_object('reaped', v_reaped, 'gates_opened', v_gates, 'cancelled', v_cancelled, 'runs_settled', v_settled);
end $function$;
GRANT ALL ON FUNCTION public.scheduler_tick() TO service_role;
CREATE FUNCTION public.settle_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_run public.runs;
  v_new public.run_status;
  v_total int := 0;
begin
  perform public.set_event_context('system', 'scheduler', jsonb_build_object('reason', 'settled'));
  for v_run in select * from public.runs where status in ('pending', 'running') for update skip locked loop
    select case
      when count(*) = 0 then null
      when bool_and(t.status = 'cancelled') then 'cancelled'
      when bool_and(t.status in ('done', 'cancelled')) then 'done'
      when bool_or(t.status = 'failed') and not bool_or(t.status = 'running') then 'failed'
      else null
    end::public.run_status
    into v_new
    from public.tasks t where t.run_id = v_run.id;

    if v_new is not null then
      update public.runs set status = v_new, finished_at = now() where id = v_run.id;
      v_total := v_total + 1;
    end if;
  end loop;
  perform public.clear_event_context();
  return v_total;
end $function$;
GRANT ALL ON FUNCTION public.settle_runs() TO service_role;
CREATE FUNCTION public.worker_heartbeat(p_worker_id text, p_info jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  insert into public.worker_heartbeats (worker_id, last_seen_at, info)
  values (p_worker_id, now(), coalesce(p_info, '{}'))
  on conflict (worker_id) do update set last_seen_at = now(), info = excluded.info;
$function$;
GRANT ALL ON FUNCTION public.worker_heartbeat(text, jsonb) TO service_role;
