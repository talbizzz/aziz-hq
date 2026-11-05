SET check_function_bodies = false;
CREATE OR REPLACE FUNCTION public.set_override(p_kind text, p_minutes integer DEFAULT NULL::integer, p_via text DEFAULT 'dashboard'::text)
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
    begin
      v_expires := public.next_local_midnight(now(), coalesce(v_tz, 'Europe/Berlin'));
    exception when others then
      -- an unusable timezone setting must not make "off today" fail
      v_expires := public.next_local_midnight(now(), 'Europe/Berlin');
    end;
  end if;

  update public.overrides set cleared_at = now() where kind = p_kind and cleared_at is null;
  insert into public.overrides (kind, expires_at, created_by) values (p_kind, v_expires, p_via) returning id into v_id;
  return v_id;
end $function$;
