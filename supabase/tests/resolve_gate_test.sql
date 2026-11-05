begin;
select plan(26);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner; -- e2e runs leave an owner behind; this rolls back with the test
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');

create temp table g on commit drop as select public.create_run('factory', 'r', '{}', '[
  {"key":"plain","type":"gate","title":"plain","gate":{"kind":"spec","title":"plain","options":[{"id":"a","label":"Approve","kind":"approve"},{"id":"d","label":"Dismiss","kind":"dismiss"}]}},
  {"key":"modify","type":"gate","title":"modify","gate":{"kind":"plan","title":"modify","options":[{"id":"a","label":"Approve","kind":"approve"},{"id":"m","label":"Modify","kind":"modify"}]}},
  {"key":"needs-comment","type":"gate","title":"nc","gate":{"kind":"plan","title":"nc","options":[{"id":"a","label":"Approve","kind":"approve","requiresComment":true}]}},
  {"key":"answer","type":"gate","title":"answer","gate":{"kind":"other","title":"answer","options":[{"id":"x","label":"Answer","kind":"answer"}]}},
  {"key":"empty","type":"gate","title":"empty","gate":{"kind":"other","title":"empty"}},
  {"key":"dismissable","type":"gate","title":"dismissable","gate":{"kind":"spec","title":"d","options":[{"id":"d","label":"Dismiss","kind":"dismiss"}]}},
  {"key":"sys","type":"system","title":"not a gate"}
]') -> 'tasks' as ids;
create function pg_temp.gid(k text) returns uuid language sql as $$ select ((select ids from g) ->> k)::uuid $$;
-- the default ACL revokes EXECUTE from PUBLIC, also for these temp objects; the tests call them as other roles
grant select on g to public;
grant execute on function pg_temp.gid(text) to public;
select public.promote_ready_gates();

-- who may resolve
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select throws_ok(format($f$select public.resolve_gate(%L, 'approve', null)$f$, pg_temp.gid('plain')), '42501', 'not authorised', 'the owner at aal1 is refused');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select throws_ok(format($f$select public.resolve_gate(%L, 'approve', null)$f$, pg_temp.gid('plain')), '42501', 'not authorised', 'a non-owner at aal2 is refused');
reset role;
select pg_temp.act_as_anon();
select throws_ok(format($f$select public.resolve_gate(%L, 'approve', null)$f$, pg_temp.gid('plain')), '42501', null, 'anon cannot execute it');
reset role;
select is((select status::text from public.tasks where id = pg_temp.gid('plain')), 'waiting_human', 'refused attempts changed nothing');

-- the owner at aal2
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is(public.resolve_gate(pg_temp.gid('plain'), 'approve', 'looks good'), '{"first": true, "decision": "approve"}'::jsonb, 'the owner approves');
reset role;
select is((select status::text from public.tasks where id = pg_temp.gid('plain')), 'done', 'approved gate task is done');
select is((select decided_via from public.gates where task_id = pg_temp.gid('plain')), 'dashboard', 'decided via the dashboard');
select is((select count(*)::int from public.events where kind = 'gate_decided' and task_id = pg_temp.gid('plain')), 1, 'one gate_decided event');
select is((select actor_type::text from public.events where kind = 'gate_decided' and task_id = pg_temp.gid('plain')), 'human', 'attributed to a human');

-- idempotency, including a conflicting later decision
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is(public.resolve_gate(pg_temp.gid('plain'), 'approve', null), '{"first": false, "decision": "approve"}'::jsonb, 'repeating is a no-op');
select is(public.resolve_gate(pg_temp.gid('plain'), 'dismiss', null), '{"first": false, "decision": "approve"}'::jsonb, 'a conflicting later decision is ignored, not an error');

-- the decision must be one of the gate options
select throws_ok(format($f$select public.resolve_gate(%L, 'dismiss', null)$f$, pg_temp.gid('modify')), '22023', 'decision not allowed for this gate', 'dismiss is not an option of this gate');
select is(public.resolve_gate(pg_temp.gid('empty'), 'approve', null), '{"first": true, "decision": "approve"}'::jsonb, 'a gate without options allows approve');
select throws_ok(format($f$select public.resolve_gate(%L, 'modify', 'c')$f$, pg_temp.gid('answer')), '22023', 'decision not allowed for this gate', 'modify is not an option of an answer-only gate');

-- comments
select throws_ok(format($f$select public.resolve_gate(%L, 'modify', ' ')$f$, pg_temp.gid('modify')), '22023', 'comment required', 'modify needs a comment');
select throws_ok(format($f$select public.resolve_gate(%L, 'answer', null)$f$, pg_temp.gid('answer')), '22023', 'comment required', 'answer needs a comment');
select throws_ok(format($f$select public.resolve_gate(%L, 'approve', '')$f$, pg_temp.gid('needs-comment')), '22023', 'comment required', 'an option with requiresComment needs one');
select is(public.resolve_gate(pg_temp.gid('needs-comment'), 'approve', 'because'), '{"first": true, "decision": "approve"}'::jsonb, 'approve with the required comment');
select is(public.resolve_gate(pg_temp.gid('modify'), 'modify', 'change X'), '{"first": true, "decision": "modify"}'::jsonb, 'modify with a comment');
select is(public.resolve_gate(pg_temp.gid('answer'), 'answer', 'blue'), '{"first": true, "decision": "answer"}'::jsonb, 'answer with a comment');

-- dismiss cancels, a non-gate is rejected
select is(public.resolve_gate(pg_temp.gid('dismissable'), 'dismiss', null), '{"first": true, "decision": "dismiss"}'::jsonb, 'dismiss');
reset role;
select is((select status::text from public.tasks where id = pg_temp.gid('dismissable')), 'cancelled', 'a dismissed gate task is cancelled');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select throws_ok(format($f$select public.resolve_gate(%L, 'approve', null)$f$, pg_temp.gid('sys')), '22023', 'not a gate', 'a non-gate task is rejected');
reset role;

select ok(not has_function_privilege('anon', 'public.resolve_gate(uuid, public.gate_decision, text)', 'execute'), 'anon has no execute');
select ok(has_function_privilege('authenticated', 'public.resolve_gate(uuid, public.gate_decision, text)', 'execute'), 'authenticated has execute');
select ok(not has_function_privilege('public', 'public.resolve_gate(uuid, public.gate_decision, text)', 'execute'), 'PUBLIC has no execute');

select * from finish();
rollback;
