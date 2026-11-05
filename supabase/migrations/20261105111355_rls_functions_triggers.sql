SET check_function_bodies = false;
CREATE FUNCTION public.current_actor_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select nullif(current_setting('app.actor_id', true), '') $function$;
CREATE FUNCTION public.current_actor_type()
 RETURNS public.actor_type
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select coalesce(nullif(current_setting('app.actor_type', true), ''), 'system')::public.actor_type $function$;
CREATE FUNCTION public.events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'events are append-only';
end $function$;
CREATE FUNCTION public.health()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select 'ok' $function$;
GRANT ALL ON FUNCTION public.health() TO anon;
GRANT ALL ON FUNCTION public.health() TO authenticated;
CREATE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.app_owner where user_id = (select auth.uid()))
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
$function$;
GRANT ALL ON FUNCTION public.is_owner() TO authenticated;
CREATE FUNCTION public.log_gate_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;
CREATE FUNCTION public.log_status_event()
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
CREATE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;
CREATE POLICY owner_select ON public.app_owner FOR SELECT TO authenticated USING (public.is_owner());
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON public.events FOR EACH STATEMENT EXECUTE FUNCTION public.events_append_only();
CREATE TRIGGER events_no_update BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_append_only();
CREATE POLICY owner_select ON public.events FOR SELECT TO authenticated USING (public.is_owner());
CREATE TRIGGER gates_log_created AFTER INSERT ON public.gates FOR EACH ROW EXECUTE FUNCTION public.log_gate_event();
CREATE TRIGGER gates_log_decided AFTER UPDATE OF decision ON public.gates FOR EACH ROW WHEN (old.decision IS NULL AND new.decision IS NOT NULL) EXECUTE FUNCTION public.log_gate_event();
CREATE POLICY owner_select ON public.gates FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY owner_select ON public.modules FOR SELECT TO authenticated USING (public.is_owner());
CREATE TRIGGER runs_log_created AFTER INSERT ON public.runs FOR EACH ROW EXECUTE FUNCTION public.log_status_event();
CREATE TRIGGER runs_log_status AFTER UPDATE OF status ON public.runs FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.log_status_event();
CREATE TRIGGER runs_set_updated_at BEFORE UPDATE ON public.runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY owner_select ON public.runs FOR SELECT TO authenticated USING (public.is_owner());
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY owner_select ON public.settings FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY owner_update ON public.settings FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER tasks_log_created AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.log_status_event();
CREATE TRIGGER tasks_log_status AFTER UPDATE OF status ON public.tasks FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.log_status_event();
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY owner_select ON public.tasks FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY owner_select ON public.usage FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY owner_select ON public.worker_heartbeats FOR SELECT TO authenticated USING (public.is_owner());
