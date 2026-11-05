SET check_function_bodies = false;
ALTER TABLE public.overrides DROP CONSTRAINT overrides_created_by_check;
ALTER TABLE public.overrides DROP CONSTRAINT overrides_kind_check;
DROP VIEW public.active_overrides;
CREATE FUNCTION public.record_usage_snapshot(p_source text, p_five_pct numeric, p_five_resets timestamp with time zone, p_seven_pct numeric, p_seven_resets timestamp with time zone, p_run_id uuid DEFAULT NULL::uuid, p_task_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  insert into public.usage_snapshots (source, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at, run_id, task_id)
  values (p_source, p_five_pct, p_five_resets, p_seven_pct, p_seven_resets, p_run_id, p_task_id)
  returning id
$function$;
GRANT ALL ON FUNCTION public.record_usage_snapshot(text, numeric, timestamp with time zone, numeric, timestamp with time zone, uuid, uuid) TO service_role;
CREATE FUNCTION public.release_for_limit(p_task_id uuid, p_worker_id text, p_resets_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_attempts int;
  v_expires timestamptz;
begin
  select attempts into v_attempts from public.tasks
   where id = p_task_id and status = 'running' and claimed_by = p_worker_id
   for update;
  if not found then
    return false;
  end if;

  perform public.set_event_context('worker', p_worker_id, jsonb_build_object('reason', 'limit_hit', 'attempt', v_attempts));
  update public.tasks set status = 'pending', attempts = greatest(attempts - 1, 0) where id = p_task_id;
  perform public.clear_event_context();

  v_expires := case when p_resets_at is null or p_resets_at <= now() then now() + interval '30 minutes' else p_resets_at end;
  update public.overrides set cleared_at = now() where kind = 'limit' and cleared_at is null;
  insert into public.overrides (kind, expires_at, created_by) values ('limit', v_expires, 'system');
  return true;
end $function$;
GRANT ALL ON FUNCTION public.release_for_limit(uuid, text, timestamp with time zone) TO service_role;
CREATE FUNCTION public.set_mode_override(p_kind text, p_minutes integer DEFAULT NULL::integer, p_cap_pct integer DEFAULT NULL::integer, p_via text DEFAULT 'dashboard'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_minutes int;
  v_id uuid;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;
  if p_via not in ('dashboard', 'telegram') then
    raise exception 'invalid created_by: %', p_via using errcode = 'invalid_parameter_value';
  end if;

  if p_kind in ('working', 'stop', 'sleeping') then
    v_minutes := 300;
  elsif p_kind = 'custom' then
    if p_minutes is null or p_minutes < 1 or p_minutes > 1440 or p_cap_pct is null or p_cap_pct < 0 or p_cap_pct > 100 then
      raise exception 'custom needs minutes (1-1440) and cap_pct (0-100)' using errcode = 'invalid_parameter_value';
    end if;
    v_minutes := p_minutes;
  else
    raise exception 'unknown mode: %', p_kind using errcode = 'invalid_parameter_value';
  end if;

  update public.overrides set cleared_at = now() where kind = p_kind and cleared_at is null;
  insert into public.overrides (kind, expires_at, created_by, cap_pct)
  values (p_kind, now() + make_interval(mins => v_minutes), p_via, case when p_kind = 'custom' then p_cap_pct end)
  returning id into v_id;
  return v_id;
end $function$;
GRANT ALL ON FUNCTION public.set_mode_override(text, integer, integer, text) TO authenticated;
GRANT ALL ON FUNCTION public.set_mode_override(text, integer, integer, text) TO service_role;
ALTER TABLE public.overrides ADD CONSTRAINT overrides_created_by_check CHECK (created_by = ANY (ARRAY['dashboard'::text, 'telegram'::text, 'system'::text]));
ALTER TABLE public.overrides ADD CONSTRAINT overrides_kind_check CHECK (kind = ANY (ARRAY['pause'::text, 'off_today'::text, 'working'::text, 'stop'::text, 'sleeping'::text, 'custom'::text, 'limit'::text]));
ALTER TABLE public.overrides ADD COLUMN cap_pct smallint;
ALTER TABLE public.overrides ADD CONSTRAINT overrides_cap_pct_check CHECK (cap_pct >= 0 AND cap_pct <= 100);
CREATE TABLE public.usage_snapshots (id uuid DEFAULT gen_random_uuid() NOT NULL, at timestamp with time zone DEFAULT now() NOT NULL, source text NOT NULL, five_hour_pct numeric(5,2) NOT NULL, five_hour_resets_at timestamp with time zone NOT NULL, seven_day_pct numeric(5,2) NOT NULL, seven_day_resets_at timestamp with time zone NOT NULL, run_id uuid, task_id uuid);
ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_snapshots;
ALTER TABLE public.usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_snapshots ADD CONSTRAINT usage_snapshots_five_hour_pct_check CHECK (five_hour_pct >= 0::numeric AND five_hour_pct <= 100::numeric);
ALTER TABLE public.usage_snapshots ADD CONSTRAINT usage_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.usage_snapshots ADD CONSTRAINT usage_snapshots_seven_day_pct_check CHECK (seven_day_pct >= 0::numeric AND seven_day_pct <= 100::numeric);
ALTER TABLE public.usage_snapshots ADD CONSTRAINT usage_snapshots_source_check CHECK (source = ANY (ARRAY['rate_limit_event'::text, 'estimate'::text]));
GRANT SELECT ON public.usage_snapshots TO authenticated;
GRANT ALL ON public.usage_snapshots TO service_role;
CREATE INDEX usage_snapshots_at_idx ON public.usage_snapshots (at DESC);
CREATE POLICY owner_select ON public.usage_snapshots FOR SELECT TO authenticated USING (public.is_owner());
CREATE VIEW public.active_overrides WITH (security_invoker=true) AS SELECT id,
    kind,
    expires_at,
    created_by,
    created_at,
    cap_pct
   FROM public.overrides
  WHERE ((cleared_at IS NULL) AND (expires_at > now()));
