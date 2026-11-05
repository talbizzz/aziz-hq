begin;
select plan(13);

-- The worker runs as service_role, not as the superuser the other tests use: every function the scheduler and its
-- triggers call must be executable by it (regression: current_actor_type() had no grant).
set local role service_role;

select lives_ok(
  $$select public.create_run('factory', 'sr', '{}', '[
    {"key":"a","type":"system","title":"a"},
    {"key":"g","type":"gate","title":"g","depends_on":["a"],"gate":{"kind":"spec","title":"g"}},
    {"key":"b","type":"system","title":"b","depends_on":["g"]}
  ]')$$,
  'service_role can create a run (insert triggers write events)'
);
select lives_ok($$select * from public.claim_task('sr-worker')$$, 'service_role can claim a task');
select lives_ok($$select public.heartbeat_task(id, 'sr-worker', 30) from public.tasks where title = 'a'$$, 'service_role can heartbeat');
select lives_ok($$select public.complete_task(id, 'sr-worker', '{}') from public.tasks where title = 'a'$$, 'service_role can complete');
select lives_ok($$select public.scheduler_tick()$$, 'service_role can run the tick');
select is((select status::text from public.tasks where title = 'g'), 'waiting_human', 'the gate opened');
select lives_ok($$select public.decide_gate(id, 'approve', null, 'telegram') from public.tasks where title = 'g'$$, 'service_role can decide a gate');
select lives_ok($$select * from public.claim_task('sr-worker')$$, 'service_role can claim the next task');
select lives_ok($$select public.fail_task(id, 'sr-worker', '{}', false) from public.tasks where title = 'b'$$, 'service_role can fail a task');
select lives_ok($$select public.scheduler_tick()$$, 'service_role can settle the run');
select lives_ok($$select public.worker_heartbeat('sr-worker', '{}')$$, 'service_role can send a worker heartbeat');
select ok((select count(*) from public.events where entity_type = 'task') >= 8, 'events were written by the triggers');
select is((select status::text from public.runs where title = 'sr'), 'failed', 'the run failed after its task failed');

reset role;
select * from finish();
rollback;
