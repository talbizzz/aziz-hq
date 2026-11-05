SET check_function_bodies = false;
CREATE OR REPLACE FUNCTION public.claim_task(p_worker_id text, p_lease_seconds integer DEFAULT 120)
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
end $function$;
CREATE FUNCTION public.clear_override(p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_active int;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_active from public.overrides where kind = p_kind and cleared_at is null and expires_at > now();
  update public.overrides set cleared_at = now() where kind = p_kind and cleared_at is null;
  return v_active;
end $function$;
GRANT ALL ON FUNCTION public.clear_override(text) TO authenticated;
GRANT ALL ON FUNCTION public.clear_override(text) TO service_role;
CREATE FUNCTION public.next_local_midnight(p_now timestamp with time zone, p_tz text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select (date_trunc('day', p_now at time zone p_tz) + interval '1 day') at time zone p_tz $function$;
GRANT ALL ON FUNCTION public.next_local_midnight(timestamp with time zone, text) TO authenticated;
GRANT ALL ON FUNCTION public.next_local_midnight(timestamp with time zone, text) TO service_role;
CREATE FUNCTION public.set_override(p_kind text, p_minutes integer DEFAULT NULL::integer, p_via text DEFAULT 'dashboard'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_expires timestamptz;
  v_tz text;
  v_id uuid;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('pause', 'off_today') then
    raise exception 'unknown override kind: %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if p_via not in ('dashboard', 'telegram') then
    raise exception 'invalid created_by: %', p_via using errcode = 'invalid_parameter_value';
  end if;

  if p_kind = 'pause' then
    if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
      raise exception 'pause minutes must be between 1 and 1440' using errcode = 'invalid_parameter_value';
    end if;
    v_expires := now() + make_interval(mins => p_minutes);
  else
    select coalesce(value #>> '{}', 'Europe/Berlin') into v_tz from public.settings where key = 'timezone';
    v_expires := public.next_local_midnight(now(), coalesce(v_tz, 'Europe/Berlin'));
  end if;

  update public.overrides set cleared_at = now() where kind = p_kind and cleared_at is null;
  insert into public.overrides (kind, expires_at, created_by) values (p_kind, v_expires, p_via) returning id into v_id;
  return v_id;
end $function$;
GRANT ALL ON FUNCTION public.set_override(text, integer, text) TO authenticated;
GRANT ALL ON FUNCTION public.set_override(text, integer, text) TO service_role;
CREATE TABLE public.overrides (id uuid DEFAULT gen_random_uuid() NOT NULL, kind text NOT NULL, expires_at timestamp with time zone NOT NULL, created_by text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, cleared_at timestamp with time zone);
ALTER PUBLICATION supabase_realtime ADD TABLE public.overrides;
ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overrides ADD CONSTRAINT overrides_created_by_check CHECK (created_by = ANY (ARRAY['dashboard'::text, 'telegram'::text]));
ALTER TABLE public.overrides ADD CONSTRAINT overrides_kind_check CHECK (kind = ANY (ARRAY['pause'::text, 'off_today'::text]));
ALTER TABLE public.overrides ADD CONSTRAINT overrides_pkey PRIMARY KEY (id);
GRANT SELECT ON public.overrides TO authenticated;
GRANT ALL ON public.overrides TO service_role;
CREATE UNIQUE INDEX overrides_one_open_per_kind ON public.overrides (kind) WHERE cleared_at IS NULL;
CREATE POLICY owner_select ON public.overrides FOR SELECT TO authenticated USING (public.is_owner());
CREATE VIEW public.active_overrides WITH (security_invoker=true) AS SELECT id,
    kind,
    expires_at,
    created_by,
    created_at
   FROM public.overrides
  WHERE ((cleared_at IS NULL) AND (expires_at > now()));
GRANT SELECT ON public.active_overrides TO authenticated;
GRANT ALL ON public.active_overrides TO service_role;
