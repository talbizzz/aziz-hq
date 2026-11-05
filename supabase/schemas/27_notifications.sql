-- Milestone 3, contract C2: outbox triggers, delivery queue functions and the worker-offline watchdog logic (no HTTP here).

create function public.enqueue_gate_notification() returns trigger
language plpgsql
set search_path = ''
as $$
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
end $$;

create function public.enqueue_run_notification() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.notifications (kind, priority, run_id, payload)
  values ('run_' || new.status, 0, new.id, jsonb_build_object('title', new.title));
  return new;
end $$;

create function public.due_notifications(p_limit int default 50) returns setof public.notifications
language plpgsql
set search_path = ''
as $$
begin
  return query
    select * from public.notifications
    where status = 'pending' and deliver_after <= now()
    order by created_at, id
    limit p_limit
    for update skip locked;
end $$;

-- sent | skipped | failed (retries with backoff, final on the 5th failure) | deferred (needs p_defer_until)
create function public.mark_notification(
  p_id uuid, p_status text, p_message_id bigint default null, p_error text default null, p_defer_until timestamptz default null
) returns void
language plpgsql
set search_path = ''
as $$
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
end $$;

-- One alert per outage: stale heartbeat -> 'alerted', returning heartbeat -> 'recovered', otherwise 'none'.
-- A worker that was never seen is not an outage.
create function public.check_worker_offline() returns text
language plpgsql
set search_path = ''
as $$
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
end $$;

revoke all on function public.enqueue_gate_notification() from public, anon, authenticated;
revoke all on function public.enqueue_run_notification() from public, anon, authenticated;
revoke all on function public.due_notifications(int) from public, anon, authenticated;
revoke all on function public.mark_notification(uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.check_worker_offline() from public, anon, authenticated;
grant execute on function public.due_notifications(int), public.mark_notification(uuid, text, bigint, text, timestamptz),
  public.check_worker_offline() to service_role;
