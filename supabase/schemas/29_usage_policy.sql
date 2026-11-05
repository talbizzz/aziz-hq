-- Milestone 4, contracts C1 and C4: usage snapshots, mode overrides and limit handling (ADR-15).

create function public.record_usage_snapshot(
  p_source text, p_five_pct numeric, p_five_resets timestamptz, p_seven_pct numeric, p_seven_resets timestamptz,
  p_run_id uuid default null, p_task_id uuid default null
) returns uuid
language sql
set search_path = ''
as $$
  insert into public.usage_snapshots (source, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at, run_id, task_id)
  values (p_source, p_five_pct, p_five_resets, p_seven_pct, p_seven_resets, p_run_id, p_task_id)
  returning id
$$;

-- "I'm working" / "Stop" / "I'm sleeping" last five hours; "custom" has its own cap and duration. The owner (aal2) or
-- service_role (Telegram). The caps of working/sleeping come from the usage_policy setting, applied by the worker.
create function public.set_mode_override(p_kind text, p_minutes int default null, p_cap_pct int default null, p_via text default 'dashboard') returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
end $$;

-- Hitting the plan limit is a pause, not a failure: the task goes back to pending without consuming an attempt and a
-- `limit` override holds claims until the window resets (the worker's policy check treats it as a deny).
create function public.release_for_limit(p_task_id uuid, p_worker_id text, p_resets_at timestamptz) returns boolean
language plpgsql
set search_path = ''
as $$
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
end $$;

revoke all on function public.record_usage_snapshot(text, numeric, timestamptz, numeric, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_mode_override(text, int, int, text) from public, anon;
revoke all on function public.release_for_limit(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_usage_snapshot(text, numeric, timestamptz, numeric, timestamptz, uuid, uuid) to service_role;
grant execute on function public.set_mode_override(text, int, int, text) to authenticated, service_role;
grant execute on function public.release_for_limit(uuid, text, timestamptz) to service_role;
