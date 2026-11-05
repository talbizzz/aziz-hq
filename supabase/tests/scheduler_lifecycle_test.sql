begin;
select plan(63);

create function pg_temp.run_with(spec text, p_title text default 'r') returns jsonb language sql as $$
  select public.create_run('factory', p_title, '{}', spec::jsonb) -> 'tasks'
$$;
create function pg_temp.tid(ids jsonb, k text) returns uuid language sql as $$ select (ids ->> k)::uuid $$;
create function pg_temp.status(ids jsonb, k text) returns text language sql as $$
  select status::text from public.tasks where id = (ids ->> k)::uuid
$$;
create function pg_temp.run_status(ids jsonb, k text) returns text language sql as $$
  select r.status::text from public.runs r join public.tasks t on t.run_id = r.id where t.id = (ids ->> k)::uuid
$$;

-- ===== reaper (requirement 6) =====
create temp table r1 on commit drop as select pg_temp.run_with('[
  {"key":"expired","type":"system","title":"expired","priority":3},
  {"key":"alive","type":"system","title":"alive","priority":2},
  {"key":"last","type":"system","title":"last","priority":1,"max_attempts":1}
]') as ids;
select public.claim_task('w1');
select public.claim_task('w1');
select public.claim_task('w1');
update public.tasks set lease_until = now() - interval '1 second' where id in (pg_temp.tid((select ids from r1), 'expired'), pg_temp.tid((select ids from r1), 'last'));
select is(public.reap_expired_leases(), 2, 'two expired leases reaped');
select is(pg_temp.status((select ids from r1), 'expired'), 'pending', 'expired lease with attempts left returns to pending');
select is((select claimed_by from public.tasks where id = pg_temp.tid((select ids from r1), 'expired')), null, 'claim released');
select is(pg_temp.status((select ids from r1), 'alive'), 'running', 'a live lease is untouched');
select is(pg_temp.status((select ids from r1), 'last'), 'failed', 'expired lease without attempts left fails the task');
select is((select result ->> 'kind' from public.tasks where id = pg_temp.tid((select ids from r1), 'last')), 'lease_expired', 'failure result records the reason');
select is(
  (select actor_type::text || '/' || actor_id || '/' || (data ->> 'reason') from public.events
   where task_id = pg_temp.tid((select ids from r1), 'expired') and data ->> 'to' = 'pending'),
  'system/reaper/lease_expired', 'reaper event is attributed to the system'
);
select is(public.reap_expired_leases(), 0, 'reaping is idempotent');
select is((select id from public.claim_task('w2')), pg_temp.tid((select ids from r1), 'expired'), 'the reaped task is claimable by another worker');

-- ===== gate promotion =====
create temp table r2 on commit drop as select pg_temp.run_with('[
  {"key":"a","type":"system","title":"a"},
  {"key":"g","type":"gate","title":"g","depends_on":["a"],"gate":{"kind":"spec","title":"g"}},
  {"key":"free","type":"gate","title":"free gate","gate":{"kind":"plan","title":"free"}},
  {"key":"after","type":"system","title":"after","depends_on":["g"]}
]', 'r2') as ids;
select is(public.promote_ready_gates(), 1, 'only the gate without pending dependencies opens');
select is(pg_temp.status((select ids from r2), 'free'), 'waiting_human', 'dependency-free gate waits for a human');
select is(pg_temp.status((select ids from r2), 'g'), 'pending', 'gate behind an unfinished task stays pending');
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w' where id = pg_temp.tid((select ids from r2), 'a');
select public.complete_task(pg_temp.tid((select ids from r2), 'a'), 'w', '{}');
select is(public.promote_ready_gates(), 1, 'gate opens once its dependency is done');
select is(pg_temp.status((select ids from r2), 'g'), 'waiting_human', 'gate is waiting_human');
select is(public.promote_ready_gates(), 0, 'promotion is idempotent');
update public.runs set status = 'paused' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r2), 'a'));
create temp table r2b on commit drop as select pg_temp.run_with('[{"key":"pg","type":"gate","title":"paused gate","gate":{"kind":"spec","title":"p"}}]', 'r2b') as ids;
update public.runs set status = 'paused' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r2b), 'pg'));
select is(public.promote_ready_gates(), 0, 'a gate in a paused run does not open');

-- ===== decide_gate =====
update public.runs set status = 'running' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r2), 'a'));
select is(public.decide_gate(pg_temp.tid((select ids from r2), 'g'), 'approve', 'looks good', 'dashboard'), '{"first": true, "decision": "approve"}'::jsonb, 'first decision wins');
select is(pg_temp.status((select ids from r2), 'g'), 'done', 'approved gate task is done');
select is((select result from public.tasks where id = pg_temp.tid((select ids from r2), 'g')), '{"comment": "looks good", "decision": "approve"}'::jsonb, 'decision recorded on the task result');
select is(
  (select row(decision::text, comment, decided_via, decided_at is not null)::text from public.gates where task_id = pg_temp.tid((select ids from r2), 'g')),
  row('approve', 'looks good', 'dashboard', true)::text, 'gate row filled'
);
select is((select count(*)::int from public.events where kind = 'gate_decided' and task_id = pg_temp.tid((select ids from r2), 'g')), 1, 'one gate_decided event');
select is((select data from public.events where kind = 'gate_decided' and task_id = pg_temp.tid((select ids from r2), 'g')), '{"via": "dashboard", "decision": "approve"}'::jsonb, 'gate_decided event data');
select is(public.decide_gate(pg_temp.tid((select ids from r2), 'g'), 'approve', null, 'dashboard'), '{"first": false, "decision": "approve"}'::jsonb, 'repeat is a no-op');
select is(public.decide_gate(pg_temp.tid((select ids from r2), 'g'), 'dismiss', null, 'telegram'), '{"first": false, "decision": "approve"}'::jsonb, 'a conflicting later decision changes nothing');
select is((select count(*)::int from public.events where kind = 'gate_decided' and task_id = pg_temp.tid((select ids from r2), 'g')), 1, 'still one gate_decided event');
select throws_ok(
  format($f$select public.decide_gate(%L, 'modify', '  ', 'dashboard')$f$, pg_temp.tid((select ids from r2), 'free')),
  '22023', 'comment required', 'modify needs a comment'
);
select throws_ok(
  format($f$select public.decide_gate(%L, 'answer', null, 'dashboard')$f$, pg_temp.tid((select ids from r2), 'free')),
  '22023', 'comment required', 'answer needs a comment'
);
select throws_ok(
  format($f$select public.decide_gate(%L, 'approve', null, 'email')$f$, pg_temp.tid((select ids from r2), 'free')),
  '22023', 'invalid decided_via: email', 'only dashboard or telegram'
);
select is(public.decide_gate(pg_temp.tid((select ids from r2), 'free'), 'modify', 'change X', 'telegram'), '{"first": true, "decision": "modify"}'::jsonb, 'modify with a comment');
select is(pg_temp.status((select ids from r2), 'free'), 'done', 'modified gate task is done');
select throws_ok(
  format($f$select public.decide_gate(%L, 'approve', null, 'dashboard')$f$, pg_temp.tid((select ids from r2), 'a')),
  '22023', 'not a gate', 'a non-gate task is rejected'
);
select throws_ok(
  format($f$select public.decide_gate(%L, 'approve', null, 'dashboard')$f$, pg_temp.tid((select ids from r2b), 'pg')),
  '22023', 'gate is not open', 'a gate that has not opened is rejected'
);

-- ===== dismiss cascades =====
create temp table r3 on commit drop as select pg_temp.run_with('[
  {"key":"g","type":"gate","title":"g","gate":{"kind":"spec","title":"g"}},
  {"key":"c1","type":"system","title":"c1","depends_on":["g"]},
  {"key":"c2","type":"system","title":"c2","depends_on":["c1"]},
  {"key":"other","type":"system","title":"other"}
]', 'r3') as ids;
select public.promote_ready_gates();
select is(public.decide_gate(pg_temp.tid((select ids from r3), 'g'), 'dismiss', null, 'dashboard'), '{"first": true, "decision": "dismiss"}'::jsonb, 'dismiss recorded');
select is(pg_temp.status((select ids from r3), 'g'), 'cancelled', 'a dismissed gate task is cancelled');
select is(public.cancel_blocked_tasks(), 2, 'dependents are cancelled to a fixed point');
select is(pg_temp.status((select ids from r3), 'c2'), 'cancelled', 'transitive dependent cancelled');
select is(pg_temp.status((select ids from r3), 'other'), 'pending', 'an independent task is untouched');
select is((select data ->> 'reason' from public.events where task_id = pg_temp.tid((select ids from r3), 'c1') and data ->> 'to' = 'cancelled'), 'dependency_cancelled', 'cancel event records the reason');
select is(public.cancel_blocked_tasks(), 0, 'cancel cascade is idempotent');

create temp table r3b on commit drop as select pg_temp.run_with('[
  {"key":"f","type":"system","title":"f","max_attempts":1},
  {"key":"d","type":"system","title":"d","depends_on":["f"]}
]', 'r3b') as ids;
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w', attempts = 1 where id = pg_temp.tid((select ids from r3b), 'f');
select public.fail_task(pg_temp.tid((select ids from r3b), 'f'), 'w', '{}', true);
select is(public.cancel_blocked_tasks(), 0, 'a failed dependency does not cascade');
select is(pg_temp.status((select ids from r3b), 'd'), 'pending', 'dependent of a failed task stays pending');

-- ===== settle_runs =====
create temp table r4 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t"}]', 'r4') as ids;
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w' where id = pg_temp.tid((select ids from r4), 't');
update public.runs set status = 'running' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r4), 't'));
select public.complete_task(pg_temp.tid((select ids from r4), 't'), 'w', '{}');
select is(public.settle_runs() >= 1, true, 'a finished run is settled');
select is(pg_temp.run_status((select ids from r4), 't'), 'done', 'all tasks done -> run done');
select ok((select finished_at is not null from public.runs r join public.tasks t on t.run_id = r.id where t.id = pg_temp.tid((select ids from r4), 't')), 'finished_at set');
select is((select data ->> 'reason' from public.events where entity_type = 'run' and entity_id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r4), 't')) and data ->> 'to' = 'done'), 'settled', 'run event records the reason');

select is(pg_temp.run_status((select ids from r3b), 'f'), 'failed', 'a failed task and nothing running -> run failed');

create temp table r5 on commit drop as select pg_temp.run_with('[{"key":"bad","type":"system","title":"bad","max_attempts":1},{"key":"busy","type":"system","title":"busy"}]', 'r5') as ids;
update public.runs set status = 'running' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r5), 'bad'));
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'w', attempts = 1 where id in (pg_temp.tid((select ids from r5), 'bad'), pg_temp.tid((select ids from r5), 'busy'));
select public.fail_task(pg_temp.tid((select ids from r5), 'bad'), 'w', '{}', true);
select public.settle_runs();
select is(pg_temp.run_status((select ids from r5), 'bad'), 'running', 'a failure with another task still running keeps the run running');

create temp table r6 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t"}]', 'r6') as ids;
update public.tasks set status = 'cancelled' where id = pg_temp.tid((select ids from r6), 't');
update public.runs set status = 'running' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r6), 't'));
select public.settle_runs();
select is(pg_temp.run_status((select ids from r6), 't'), 'cancelled', 'only cancelled tasks -> run cancelled');

create temp table r7 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t"}]', 'r7') as ids;
update public.tasks set status = 'cancelled' where id = pg_temp.tid((select ids from r7), 't');
update public.runs set status = 'paused' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r7), 't'));
select public.settle_runs();
select is(pg_temp.run_status((select ids from r7), 't'), 'paused', 'a paused run is left alone');

select public.create_run('factory', 'empty', '{}', '[]');
select public.settle_runs();
select is((select status::text from public.runs where title = 'empty'), 'pending', 'a run without tasks is left alone');

-- ===== tick =====
create temp table r8 on commit drop as select pg_temp.run_with('[
  {"key":"a","type":"system","title":"a"},
  {"key":"g","type":"gate","title":"g","depends_on":["a"],"gate":{"kind":"spec","title":"g"}}
]', 'r8') as ids;
update public.tasks set status = 'running', lease_until = now() - interval '1 second', claimed_by = 'wt', attempts = 1 where id = pg_temp.tid((select ids from r8), 'a');
select is(public.scheduler_tick() ->> 'reaped', '1', 'tick reaps the expired lease');
update public.tasks set status = 'running', lease_until = now() + interval '1 minute', claimed_by = 'wt', attempts = 2 where id = pg_temp.tid((select ids from r8), 'a');
select public.complete_task(pg_temp.tid((select ids from r8), 'a'), 'wt', '{}');
select is(public.scheduler_tick() ->> 'gates_opened', '1', 'tick opens the gate');
select is(public.scheduler_tick(), '{"reaped": 0, "gates_opened": 0, "cancelled": 0, "runs_settled": 0}'::jsonb, 'a quiet tick changes nothing');

-- ===== worker heartbeat =====
select public.worker_heartbeat('hb1', '{"v":1}');
select is((select info from public.worker_heartbeats where worker_id = 'hb1'), '{"v": 1}'::jsonb, 'heartbeat inserts');
update public.worker_heartbeats set last_seen_at = now() - interval '1 hour' where worker_id = 'hb1';
select public.worker_heartbeat('hb1', '{"v":2}');
select ok((select last_seen_at > now() - interval '1 minute' and info = '{"v": 2}'::jsonb from public.worker_heartbeats where worker_id = 'hb1'), 'heartbeat updates last_seen_at and info');

-- ===== privileges =====
select ok(not has_function_privilege('authenticated', 'public.decide_gate(uuid, public.gate_decision, text, text)', 'execute'), 'authenticated cannot decide_gate (M3 adds resolve_gate)');
select ok(not has_function_privilege('anon', 'public.scheduler_tick()', 'execute'), 'anon cannot scheduler_tick');
select ok(not has_function_privilege('authenticated', 'public.scheduler_tick()', 'execute'), 'authenticated cannot scheduler_tick');
select ok(not has_function_privilege('authenticated', 'public.worker_heartbeat(text, jsonb)', 'execute'), 'authenticated cannot worker_heartbeat');
select ok(not has_function_privilege('authenticated', 'public.reap_expired_leases()', 'execute'), 'authenticated cannot reap');
select ok(not has_function_privilege('authenticated', 'public.settle_runs()', 'execute'), 'authenticated cannot settle_runs');
select ok(has_function_privilege('service_role', 'public.scheduler_tick()', 'execute'), 'service_role can scheduler_tick');
select ok(has_function_privilege('service_role', 'public.decide_gate(uuid, public.gate_decision, text, text)', 'execute'), 'service_role can decide_gate');

select * from finish();
rollback;
