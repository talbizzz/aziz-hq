SET check_function_bodies = false;
CREATE OR REPLACE FUNCTION public.log_status_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
CREATE FUNCTION public.tasks_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = new.status then
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('running', 'cancelled'))
    or (old.status = 'pending' and new.status = 'waiting_human' and new.type = 'gate')
    or (old.status = 'running' and new.status in ('done', 'failed', 'pending', 'cancelled'))
    or (old.status = 'waiting_human' and new.status in ('done', 'cancelled'))
  ) then
    raise exception 'invalid task status transition: % -> %', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status <> 'running' then
    new.lease_until := null;
  end if;
  if new.status = 'pending' then
    new.claimed_by := null;
  end if;
  return new;
end $function$;
CREATE FUNCTION public.tasks_validate_deps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  dep uuid;
begin
  if tg_op = 'UPDATE' then
    if new.depends_on is distinct from old.depends_on then
      raise exception 'depends_on is immutable' using errcode = 'invalid_parameter_value';
    end if;
    return new;
  end if;

  foreach dep in array new.depends_on loop
    if dep = new.id then
      raise exception 'task cannot depend on itself' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.tasks where id = dep) then
      raise exception 'unknown dependency %', dep using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.tasks where id = dep and run_id = new.run_id) then
      raise exception 'dependency in another run %', dep using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return new;
end $function$;
CREATE TRIGGER tasks_status_transition BEFORE UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_status_transition();
CREATE TRIGGER tasks_validate_deps BEFORE INSERT OR UPDATE OF depends_on ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_validate_deps();
