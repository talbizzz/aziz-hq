-- Milestone 3, contract C2: override functions (M4 adds the two weekly-pacing bypasses). Callable by the owner (aal2, dashboard) and by service_role (Telegram).

-- The next local midnight after p_now in time zone p_tz (DST-safe: wall-clock arithmetic, then back to an instant).
create function public.next_local_midnight(p_now timestamptz, p_tz text) returns timestamptz
language sql
immutable
set search_path = ''
as $$ select (date_trunc('day', p_now at time zone p_tz) + interval '1 day') at time zone p_tz $$;

create function public.set_override(p_kind text, p_minutes int default null, p_via text default 'dashboard') returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
  v_tz text;
  v_id uuid;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('pause', 'off_today', 'pacing_bypass_day', 'pacing_bypass_week') then
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
  elsif p_kind = 'pacing_bypass_week' then
    -- until the weekly usage window resets; without a live snapshot, seven days
    select seven_day_resets_at into v_expires from public.usage_snapshots order by at desc limit 1;
    if v_expires is null or v_expires <= now() then
      v_expires := now() + interval '7 days';
    end if;
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
end $$;

create function public.clear_override(p_kind text) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active int;
begin
  if not (auth.role() = 'service_role' or public.is_owner()) then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_active from public.overrides where kind = p_kind and cleared_at is null and expires_at > now();
  update public.overrides set cleared_at = now() where kind = p_kind and cleared_at is null;
  return v_active;
end $$;

revoke all on function public.next_local_midnight(timestamptz, text) from public, anon;
revoke all on function public.set_override(text, int, text) from public, anon;
revoke all on function public.clear_override(text) from public, anon;
grant execute on function public.next_local_midnight(timestamptz, text) to authenticated, service_role;
grant execute on function public.set_override(text, int, text) to authenticated, service_role;
grant execute on function public.clear_override(text) to authenticated, service_role;
