begin;
select plan(56);

-- run helper: create a run with the given graph and return its task ids by key
create function pg_temp.run_with(spec text) returns jsonb language sql as $$
  select public.create_run('factory', 'r', '{}', spec::jsonb) -> 'tasks'
$$;
create function pg_temp.tid(ids jsonb, k text) returns uuid language sql as $$ select (ids ->> k)::uuid $$;

-- 1. priority, then age
create temp table r1 on commit drop as select pg_temp.run_with('[
  {"key":"low-late","type":"system","title":"low late"},
  {"key":"high","type":"system","title":"high","priority":5},
  {"key":"low-early","type":"system","title":"low early"}
]') as ids;
update public.tasks set created_at = now() - interval '1 hour' where id = pg_temp.tid((select ids from r1), 'low-early');
select is((select id from public.claim_task('w1')), pg_temp.tid((select ids from r1), 'high'), 'highest priority first');
select is((select id from public.claim_task('w1')), pg_temp.tid((select ids from r1), 'low-early'), 'then the oldest');
select is((select id from public.claim_task('w1')), pg_temp.tid((select ids from r1), 'low-late'), 'then the newest');
select is((select count(*)::int from public.claim_task('w1')), 0, 'nothing left to claim');

-- claim bookkeeping (task 'high')
select is((select status::text from public.tasks where id = pg_temp.tid((select ids from r1), 'high')), 'running', 'claimed task is running');
select is((select claimed_by from public.tasks where id = pg_temp.tid((select ids from r1), 'high')), 'w1', 'claimed_by is the worker');
select is((select attempts from public.tasks where id = pg_temp.tid((select ids from r1), 'high')), 1, 'attempts incremented');
select ok((select lease_until > now() + interval '110 seconds' and lease_until <= now() + interval '120 seconds' from public.tasks where id = pg_temp.tid((select ids from r1), 'high')), 'default lease is 120 seconds');
select is(
  (select data from public.events where task_id = pg_temp.tid((select ids from r1), 'high') and kind = 'status_changed'),
  '{"from":"pending","to":"running","reason":"claimed","attempt":1,"worker":"w1"}'::jsonb, 'claim event carries reason, attempt and worker'
);
select is(
  (select actor_type::text || '/' || actor_id from public.events where task_id = pg_temp.tid((select ids from r1), 'high') and kind = 'status_changed'),
  'worker/w1', 'claim event is attributed to the worker'
);
select is((select status::text from public.runs where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r1), 'high'))), 'running', 'the run moves pending -> running');
-- the event context does not leak into later statements of the same transaction
update public.tasks set status = 'cancelled' where id = pg_temp.tid((select ids from r1), 'low-late');
select is((select actor_type::text from public.events where task_id = pg_temp.tid((select ids from r1), 'low-late') and data ->> 'to' = 'cancelled'), 'system', 'event context is cleared after the claim');

-- 2. dependencies
create temp table r2 on commit drop as select pg_temp.run_with('[
  {"key":"a","type":"system","title":"a"},
  {"key":"b","type":"system","title":"b","depends_on":["a"]}
]') as ids;
select is((select id from public.claim_task('w2')), pg_temp.tid((select ids from r2), 'a'), 'only the task without dependencies is claimable');
select is((select count(*)::int from public.claim_task('w2')), 0, 'dependent waits while its dependency runs');
select ok(public.complete_task(pg_temp.tid((select ids from r2), 'a'), 'w2', '{}'), 'a completes');
select is((select id from public.claim_task('w2')), pg_temp.tid((select ids from r2), 'b'), 'dependent is claimable once the dependency is done');

-- 3. a gate between two tasks (requirement 5)
create temp table r3 on commit drop as select pg_temp.run_with('[
  {"key":"before","type":"system","title":"before"},
  {"key":"gate","type":"gate","title":"gate","depends_on":["before"],"gate":{"kind":"spec","title":"g"}},
  {"key":"after","type":"system","title":"after","depends_on":["gate"]}
]') as ids;
select is((select id from public.claim_task('w3')), pg_temp.tid((select ids from r3), 'before'), 'tasks before the gate run');
select ok(public.complete_task(pg_temp.tid((select ids from r3), 'before'), 'w3', '{}'), 'before completes');
select is((select count(*)::int from public.claim_task('w3')), 0, 'a pending gate task is never claimed and blocks its dependents');
update public.tasks set status = 'waiting_human' where id = pg_temp.tid((select ids from r3), 'gate');
select is((select count(*)::int from public.claim_task('w3')), 0, 'a gate waiting for a human still blocks its dependents');
update public.tasks set status = 'done' where id = pg_temp.tid((select ids from r3), 'gate');
select is((select id from public.claim_task('w3')), pg_temp.tid((select ids from r3), 'after'), 'resolved gate releases its dependents');

-- 4. run status gates claiming
create temp table r4 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t"}]') as ids;
update public.runs set status = 'paused' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r4), 't'));
select is((select count(*)::int from public.claim_task('w4')), 0, 'a paused run is not claimed');
update public.runs set status = 'failed' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r4), 't'));
select is((select count(*)::int from public.claim_task('w4')), 0, 'a failed run is not claimed');
update public.runs set status = 'pending' where id = (select run_id from public.tasks where id = pg_temp.tid((select ids from r4), 't'));
select is((select id from public.claim_task('w4')), pg_temp.tid((select ids from r4), 't'), 'a pending run is claimed again once reopened');

-- 5. heartbeat
create temp table r5 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t"}]') as ids;
select is((select id from public.claim_task('w5', 30)), pg_temp.tid((select ids from r5), 't'), 'claim with a 30 second lease');
update public.tasks set lease_until = now() + interval '5 seconds' where id = pg_temp.tid((select ids from r5), 't');
select is(public.heartbeat_task(pg_temp.tid((select ids from r5), 't'), 'someone-else', 60), false, 'heartbeat from a non-owner is refused');
select ok((select lease_until < now() + interval '10 seconds' from public.tasks where id = pg_temp.tid((select ids from r5), 't')), 'lease untouched by a non-owner');
select is(public.heartbeat_task(pg_temp.tid((select ids from r5), 't'), 'w5', 60), true, 'heartbeat from the owner extends the lease');
select ok((select lease_until > now() + interval '50 seconds' from public.tasks where id = pg_temp.tid((select ids from r5), 't')), 'lease is now ~60 seconds');

-- 6. complete
select is(public.complete_task(pg_temp.tid((select ids from r5), 't'), 'someone-else', '{}'), false, 'a non-owner cannot complete');
select is(public.complete_task(pg_temp.tid((select ids from r5), 't'), 'w5', '{"summary":"ok"}'), true, 'the owner completes');
select is((select result from public.tasks where id = pg_temp.tid((select ids from r5), 't')), '{"summary": "ok"}'::jsonb, 'result stored');
select is((select status::text from public.tasks where id = pg_temp.tid((select ids from r5), 't')), 'done', 'task is done');
select is(public.complete_task(pg_temp.tid((select ids from r5), 't'), 'w5', '{}'), false, 'completing twice is a harmless no-op');
select is(public.heartbeat_task(pg_temp.tid((select ids from r5), 't'), 'w5', 60), false, 'heartbeat on a finished task is refused');

-- 7. fail and retry
create temp table r7 on commit drop as select pg_temp.run_with('[{"key":"t","type":"system","title":"t","max_attempts":2},{"key":"u","type":"system","title":"u","max_attempts":3}]') as ids;
update public.tasks set priority = 9 where id = pg_temp.tid((select ids from r7), 't');
select is((select id from public.claim_task('w7')), pg_temp.tid((select ids from r7), 't'), 'claim attempt 1');
select is(public.fail_task(pg_temp.tid((select ids from r7), 't'), 'someone-else', '{}', true), 'ignored', 'a non-owner failure is ignored');
select is(public.fail_task(pg_temp.tid((select ids from r7), 't'), 'w7', '{"message":"boom"}', true), 'retried', 'first failure is retried');
select is((select status::text from public.tasks where id = pg_temp.tid((select ids from r7), 't')), 'pending', 'retried task is pending again');
select is((select claimed_by from public.tasks where id = pg_temp.tid((select ids from r7), 't')), null, 'claim cleared on retry');
select is(
  (select data ->> 'reason' || '/' || (data ->> 'attempt') from public.events where task_id = pg_temp.tid((select ids from r7), 't') and data ->> 'to' = 'pending'),
  'retry/1', 'retry event carries reason and attempt'
);
select is((select id from public.claim_task('w7')), pg_temp.tid((select ids from r7), 't'), 'claim attempt 2');
select is((select attempts from public.tasks where id = pg_temp.tid((select ids from r7), 't')), 2, 'attempts is 2');
select is(public.fail_task(pg_temp.tid((select ids from r7), 't'), 'w7', '{"message":"boom again"}', true), 'failed', 'out of attempts: the task fails');
select is((select result from public.tasks where id = pg_temp.tid((select ids from r7), 't')), '{"message": "boom again"}'::jsonb, 'error stored as result');
select is(public.fail_task(pg_temp.tid((select ids from r7), 't'), 'w7', '{}', true), 'ignored', 'failing a finished task is ignored');
select is((select id from public.claim_task('w7')), pg_temp.tid((select ids from r7), 'u'), 'claim the other task');
select is(public.fail_task(pg_temp.tid((select ids from r7), 'u'), 'w7', '{"kind":"needs_human"}', false), 'failed', 'non-retryable fails immediately despite attempts left');

-- 8. validation and privileges
select throws_ok($$select * from public.claim_task('w', 0)$$, '22023', 'lease must be positive', 'lease must be positive');
select ok(has_function_privilege('service_role', 'public.claim_task(text, integer)', 'execute'), 'service_role can claim_task');
select ok(not has_function_privilege('authenticated', 'public.claim_task(text, integer)', 'execute'), 'authenticated cannot claim_task');
select ok(not has_function_privilege('anon', 'public.claim_task(text, integer)', 'execute'), 'anon cannot claim_task');
select ok(not has_function_privilege('authenticated', 'public.complete_task(uuid, text, jsonb)', 'execute'), 'authenticated cannot complete_task');
select ok(not has_function_privilege('authenticated', 'public.fail_task(uuid, text, jsonb, boolean)', 'execute'), 'authenticated cannot fail_task');
select ok(not has_function_privilege('authenticated', 'public.heartbeat_task(uuid, text, integer)', 'execute'), 'authenticated cannot heartbeat_task');
select ok(has_function_privilege('service_role', 'public.heartbeat_task(uuid, text, integer)', 'execute'), 'service_role can heartbeat_task');

select * from finish();
rollback;
