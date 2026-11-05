SET check_function_bodies = false;
CREATE FUNCTION public.check_worker_offline()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_last timestamptz;
  v_after int;
  v_active boolean;
  v_stale boolean;
begin
  select max(last_seen_at) into v_last from public.worker_heartbeats;
  if v_last is null then
    return 'none';
  end if;
  select coalesce((select (value #>> '{}')::int from public.settings where key = 'worker_offline_after_seconds'), 180) into v_after;
  select coalesce((select (value ->> 'active')::boolean from public.settings where key = 'worker_alert'), false) into v_active;
  v_stale := now() - v_last > make_interval(secs => v_after);

  if v_stale and not v_active then
    insert into public.settings (key, value) values ('worker_alert', jsonb_build_object('active', true, 'since', now()))
      on conflict (key) do update set value = excluded.value;
    insert into public.notifications (kind, priority, payload)
      values ('worker_offline', 2, jsonb_build_object('last_seen_at', v_last, 'age_seconds', extract(epoch from now() - v_last)::int));
    return 'alerted';
  elsif not v_stale and v_active then
    insert into public.settings (key, value) values ('worker_alert', jsonb_build_object('active', false, 'since', now()))
      on conflict (key) do update set value = excluded.value;
    insert into public.notifications (kind, priority, payload) values ('worker_online', 2, jsonb_build_object('last_seen_at', v_last));
    return 'recovered';
  end if;
  return 'none';
end $function$;
GRANT ALL ON FUNCTION public.check_worker_offline() TO service_role;
CREATE FUNCTION public.enqueue_gate_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_gate public.gates;
  v_run_title text;
  v_simple boolean;
begin
  select * into v_gate from public.gates where task_id = new.id;
  if not found then
    return new;
  end if;
  select title into v_run_title from public.runs where id = new.run_id;

  -- simple = answerable with a button: no options, or only approve/dismiss without a required comment
  v_simple := not exists (
    select 1 from jsonb_array_elements(v_gate.options) o
    where o ->> 'kind' not in ('approve', 'dismiss') or coalesce((o ->> 'requiresComment')::boolean, false)
  );

  insert into public.notifications (kind, priority, gate_task_id, run_id, payload)
  values (
    'gate_open', v_gate.priority, new.id, new.run_id,
    jsonb_build_object('title', v_gate.title, 'gate_kind', v_gate.kind, 'run_title', v_run_title, 'simple', v_simple)
  )
  on conflict (gate_task_id) where kind = 'gate_open' do nothing;
  return new;
end $function$;
CREATE FUNCTION public.enqueue_run_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into public.notifications (kind, priority, run_id, payload)
  values ('run_' || new.status, 0, new.id, jsonb_build_object('title', new.title));
  return new;
end $function$;
CREATE FUNCTION public.mark_notification(p_id uuid, p_status text, p_message_id bigint DEFAULT NULL::bigint, p_error text DEFAULT NULL::text, p_defer_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_status = 'sent' then
    update public.notifications set status = 'sent', sent_at = now(), telegram_message_id = p_message_id, error = null where id = p_id;
  elsif p_status = 'skipped' then
    update public.notifications set status = 'skipped' where id = p_id;
  elsif p_status = 'failed' then
    update public.notifications
       set attempts = attempts + 1,
           error = p_error,
           status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
           deliver_after = case when attempts + 1 >= 5 then deliver_after else now() + (attempts + 1) * interval '1 minute' end
     where id = p_id;
  elsif p_status = 'deferred' then
    if p_defer_until is null then
      raise exception 'deferred needs p_defer_until' using errcode = 'invalid_parameter_value';
    end if;
    update public.notifications set status = 'pending', deliver_after = p_defer_until where id = p_id;
  else
    raise exception 'invalid notification status: %', p_status using errcode = 'invalid_parameter_value';
  end if;
end $function$;
GRANT ALL ON FUNCTION public.mark_notification(uuid, text, bigint, text, timestamp with time zone) TO service_role;
CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid() NOT NULL, kind text NOT NULL, priority smallint NOT NULL, gate_task_id uuid, run_id uuid, payload jsonb DEFAULT '{}'::jsonb NOT NULL, status text DEFAULT 'pending'::text NOT NULL, deliver_after timestamp with time zone DEFAULT now() NOT NULL, attempts integer DEFAULT 0 NOT NULL, sent_at timestamp with time zone, telegram_message_id bigint, error text, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE FUNCTION public.due_notifications(p_limit integer DEFAULT 50)
 RETURNS SETOF public.notifications
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
    select * from public.notifications
    where status = 'pending' and deliver_after <= now()
    order by created_at, id
    limit p_limit
    for update skip locked;
end $function$;
GRANT ALL ON FUNCTION public.due_notifications(integer) TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (ARRAY['gate_open'::text, 'run_done'::text, 'run_failed'::text, 'worker_offline'::text, 'worker_online'::text]));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_priority_check CHECK (priority >= 0 AND priority <= 2);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text]));
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
CREATE UNIQUE INDEX notifications_gate_open_once ON public.notifications (gate_task_id) WHERE kind = 'gate_open'::text;
CREATE INDEX notifications_pending_idx ON public.notifications (status, deliver_after) WHERE status = 'pending'::text;
CREATE POLICY owner_select ON public.notifications FOR SELECT TO authenticated USING (public.is_owner());
CREATE TRIGGER runs_enqueue_notification AFTER UPDATE OF status ON public.runs FOR EACH ROW WHEN ((new.status = ANY (ARRAY['done'::public.run_status, 'failed'::public.run_status])) AND old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.enqueue_run_notification();
CREATE TRIGGER tasks_enqueue_gate_notification AFTER UPDATE OF status ON public.tasks FOR EACH ROW WHEN (new.type = 'gate'::public.task_type AND new.status = 'waiting_human'::public.task_status AND old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.enqueue_gate_notification();
