begin;
select plan(60);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');

-- settings defaults come from a manual migration
select is((select count(*)::int from public.settings where key in ('timezone', 'quiet_hours', 'digest_time', 'worker_offline_after_seconds')), 4, 'the four default settings exist');
select is((select value from public.settings where key = 'quiet_hours'), '{"start": "22:00", "end": "07:00"}'::jsonb, 'quiet hours default');

-- ===== gate notifications =====
create temp table r1 on commit drop as select public.create_run('factory', 'notify run', '{}', '[
  {"key":"empty","type":"gate","title":"empty options","gate":{"kind":"spec","title":"Empty options gate","priority":2}},
  {"key":"simple","type":"gate","title":"simple","gate":{"kind":"plan","title":"Simple gate","priority":1,"options":[{"id":"a","label":"A","kind":"approve"},{"id":"d","label":"D","kind":"dismiss"}]}},
  {"key":"modify","type":"gate","title":"modify","gate":{"kind":"plan","title":"Modify gate","priority":1,"options":[{"id":"a","label":"A","kind":"approve"},{"id":"m","label":"M","kind":"modify"}]}},
  {"key":"comment","type":"gate","title":"comment","gate":{"kind":"plan","title":"Comment gate","priority":0,"options":[{"id":"a","label":"A","kind":"approve","requiresComment":true}]}},
  {"key":"work","type":"system","title":"work"}
]') -> 'tasks' as ids;
create function pg_temp.gid(k text) returns uuid language sql as $$ select ((select ids from r1) ->> k)::uuid $$;
select is((select count(*)::int from public.notifications), 0, 'nothing is enqueued before gates open');
select is(public.promote_ready_gates(), 4, 'four gates open');
select is((select count(*)::int from public.notifications where kind = 'gate_open'), 4, 'one gate_open notification per gate');
select is((select priority from public.notifications where gate_task_id = pg_temp.gid('empty')), 2::smallint, 'priority follows the gate priority (blocking)');
select is((select priority from public.notifications where gate_task_id = pg_temp.gid('comment')), 0::smallint, 'priority follows the gate priority (info)');
select is((select payload ->> 'title' from public.notifications where gate_task_id = pg_temp.gid('simple')), 'Simple gate', 'payload carries the title');
select is((select payload ->> 'run_title' from public.notifications where gate_task_id = pg_temp.gid('simple')), 'notify run', 'payload carries the run title');
select is((select payload ->> 'gate_kind' from public.notifications where gate_task_id = pg_temp.gid('simple')), 'plan', 'payload carries the gate kind');
select is((select (payload ->> 'simple')::boolean from public.notifications where gate_task_id = pg_temp.gid('empty')), true, 'no options: simple');
select is((select (payload ->> 'simple')::boolean from public.notifications where gate_task_id = pg_temp.gid('simple')), true, 'approve and dismiss: simple');
select is((select (payload ->> 'simple')::boolean from public.notifications where gate_task_id = pg_temp.gid('modify')), false, 'a modify option makes it complex');
select is((select (payload ->> 'simple')::boolean from public.notifications where gate_task_id = pg_temp.gid('comment')), false, 'requiresComment makes it complex');
select is((select status from public.notifications where gate_task_id = pg_temp.gid('simple')), 'pending', 'new notifications are pending');
select is(public.promote_ready_gates(), 0, 'no second opening');
select throws_ok(
  format($f$insert into public.notifications (kind, priority, gate_task_id) values ('gate_open', 1, %L)$f$, pg_temp.gid('simple')),
  '23505', null, 'at most one gate_open per gate'
);
select is((select count(*)::int from public.notifications where gate_task_id = pg_temp.gid('simple')), 1, 'still one for the gate');

-- ===== run notifications =====
update public.tasks set status = 'cancelled' where run_id = (select run_id from public.tasks where id = pg_temp.gid('work')) and type = 'gate';
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w', attempts = 1 where id = pg_temp.gid('work');
select public.complete_task(pg_temp.gid('work'), 'w', '{}');
update public.runs set status = 'running' where title = 'notify run';
select public.settle_runs();
select is((select kind from public.notifications where kind like 'run_%'), 'run_done', 'a settled run enqueues run_done');
select is((select priority from public.notifications where kind = 'run_done'), 0::smallint, 'run notifications are info');
select is((select payload ->> 'title' from public.notifications where kind = 'run_done'), 'notify run', 'run payload carries the title');

create temp table r2 on commit drop as select public.create_run('factory', 'failing run', '{}', '[{"key":"t","type":"system","title":"t","max_attempts":1}]') -> 'tasks' as ids;
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w', attempts = 1 where title = 't';
update public.runs set status = 'running' where title = 'failing run';
select public.fail_task((select ((ids ->> 't')::uuid) from r2), 'w', '{}', true);
select public.settle_runs();
select is((select count(*)::int from public.notifications where kind = 'run_failed'), 1, 'a failed run enqueues run_failed');

-- ===== the flow as service_role (the worker's role) =====
create temp table r3 on commit drop as select public.create_run('factory', 'sr run', '{}', '[{"key":"g","type":"gate","title":"g","gate":{"kind":"spec","title":"SR gate"}}]') -> 'tasks' as ids;
select pg_temp.act_as_service();
select lives_ok($$select public.scheduler_tick()$$, 'the tick (gate opens, notification enqueued) works as service_role');
select lives_ok($$select count(*) from public.due_notifications(10)$$, 'service_role can read due notifications');
reset role;
select is((select count(*)::int from public.notifications where payload ->> 'title' = 'SR gate'), 1, 'the notification was written by the trigger as service_role');

-- ===== due_notifications and mark_notification =====
delete from public.notifications;
insert into public.notifications (id, kind, priority, deliver_after, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'worker_offline', 2, now() - interval '3 minutes', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-0000000000d2', 'worker_offline', 2, now() - interval '2 minutes', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-0000000000d3', 'worker_offline', 2, now() + interval '1 hour', now() - interval '1 minute');
insert into public.notifications (id, kind, priority, status, created_at) values ('00000000-0000-0000-0000-0000000000d4', 'worker_online', 2, 'sent', now() - interval '4 minutes');
select pg_temp.act_as_service();
select is((select array_agg(id order by created_at) from public.due_notifications(10)), array['00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2']::uuid[], 'due: pending, deliver_after reached, oldest first');
select is((select count(*)::int from public.due_notifications(1)), 1, 'due respects the limit');
select public.mark_notification('00000000-0000-0000-0000-0000000000d1', 'sent', 4242);
select public.mark_notification('00000000-0000-0000-0000-0000000000d2', 'skipped');
reset role;
select is((select status || '/' || telegram_message_id from public.notifications where id = '00000000-0000-0000-0000-0000000000d1'), 'sent/4242', 'sent stores the Telegram message id');
select ok((select sent_at is not null from public.notifications where id = '00000000-0000-0000-0000-0000000000d1'), 'sent_at set');
select is((select status from public.notifications where id = '00000000-0000-0000-0000-0000000000d2'), 'skipped', 'skipped');

select pg_temp.act_as_service();
select public.mark_notification('00000000-0000-0000-0000-0000000000d3', 'deferred', null, null, now() + interval '2 hours');
select public.mark_notification('00000000-0000-0000-0000-0000000000d3', 'failed', null, 'boom');
reset role;
select is((select status || '/' || attempts from public.notifications where id = '00000000-0000-0000-0000-0000000000d3'), 'pending/1', 'a first failure re-queues with attempts 1');
select ok((select deliver_after between now() + interval '30 seconds' and now() + interval '90 seconds' from public.notifications where id = '00000000-0000-0000-0000-0000000000d3'), 'retry backs off by attempts x 1 minute');
select is((select error from public.notifications where id = '00000000-0000-0000-0000-0000000000d3'), 'boom', 'the error is kept');
update public.notifications set attempts = 4 where id = '00000000-0000-0000-0000-0000000000d3';
select pg_temp.act_as_service();
select public.mark_notification('00000000-0000-0000-0000-0000000000d3', 'failed', null, 'still boom');
reset role;
select is((select status || '/' || attempts from public.notifications where id = '00000000-0000-0000-0000-0000000000d3'), 'failed/5', 'the fifth failure is final');
select throws_ok(
  $$select public.mark_notification('00000000-0000-0000-0000-0000000000d3', 'deferred')$$,
  '22023', 'deferred needs p_defer_until', 'deferral needs a time'
);
select throws_ok(
  $$select public.mark_notification('00000000-0000-0000-0000-0000000000d3', 'nonsense')$$,
  '22023', 'invalid notification status: nonsense', 'unknown status rejected'
);

-- ===== RLS =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select ok((select count(*) from public.notifications) > 0, 'the owner at aal2 reads notifications');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is((select count(*)::int from public.notifications), 0, 'a non-owner reads nothing');
reset role;
select pg_temp.act_as_anon();
select throws_ok($$select * from public.notifications$$, '42501', null, 'anon has no access');
reset role;

-- ===== worker offline watchdog =====
delete from public.notifications;
delete from public.worker_heartbeats;
delete from public.settings where key = 'worker_alert';
select is(public.check_worker_offline(), 'none', 'no worker ever seen: not an outage');
insert into public.worker_heartbeats (worker_id, last_seen_at) values ('w', now());
select is(public.check_worker_offline(), 'none', 'a fresh heartbeat: nothing to report');
update public.worker_heartbeats set last_seen_at = now() - interval '10 minutes';
select is(public.check_worker_offline(), 'alerted', 'a stale heartbeat raises the alert');
select is((select count(*)::int from public.notifications where kind = 'worker_offline' and priority = 2), 1, 'one critical worker_offline notification');
select is((select (payload ->> 'age_seconds')::int >= 600 from public.notifications where kind = 'worker_offline'), true, 'payload carries the age');
select is(public.check_worker_offline(), 'none', 'the same outage alerts only once');
select is(public.check_worker_offline(), 'none', 'and again');
select is((select (value ->> 'active')::boolean from public.settings where key = 'worker_alert'), true, 'the alert state is recorded');
update public.worker_heartbeats set last_seen_at = now();
select is(public.check_worker_offline(), 'recovered', 'a returning heartbeat recovers');
select is((select count(*)::int from public.notifications where kind = 'worker_online' and priority = 2), 1, 'one worker_online notification');
select is(public.check_worker_offline(), 'none', 'recovery is reported once');
update public.worker_heartbeats set last_seen_at = now() - interval '10 minutes';
select is(public.check_worker_offline(), 'alerted', 'a second outage alerts again');
select is((select count(*)::int from public.notifications where kind = 'worker_offline'), 2, 'two outages, two alerts');
update public.settings set value = '900' where key = 'worker_offline_after_seconds';
update public.worker_heartbeats set last_seen_at = now() - interval '10 minutes';
select public.check_worker_offline(); -- recovers (10 min < 15 min threshold)
select is((select (value ->> 'active')::boolean from public.settings where key = 'worker_alert'), false, 'the threshold comes from settings');

-- ===== privileges =====
select ok(not has_function_privilege('authenticated', 'public.due_notifications(integer)', 'execute'), 'authenticated cannot read due notifications');
select ok(not has_function_privilege('authenticated', 'public.mark_notification(uuid, text, bigint, text, timestamptz)', 'execute'), 'authenticated cannot mark');
select ok(not has_function_privilege('authenticated', 'public.check_worker_offline()', 'execute'), 'authenticated cannot run the watchdog');
select ok(not has_function_privilege('anon', 'public.check_worker_offline()', 'execute'), 'anon cannot run the watchdog');
select ok(has_function_privilege('service_role', 'public.check_worker_offline()', 'execute'), 'service_role can');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'insert'), 'authenticated cannot insert');
select ok(not has_table_privilege('anon', 'public.notifications', 'select'), 'anon cannot select');

select * from finish();
rollback;
