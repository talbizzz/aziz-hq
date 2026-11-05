begin;
select plan(16);
\ir support/helpers.inc

insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000b0', 'factory', 'run');
select is(
  (select count(*)::int from public.events where kind = 'created' and entity_type = 'run' and entity_id = '00000000-0000-0000-0000-0000000000b0' and run_id = '00000000-0000-0000-0000-0000000000b0' and task_id is null),
  1, 'inserting a run writes a created event'
);

insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000b0', 'system', 't');
select is(
  (select count(*)::int from public.events where kind = 'created' and entity_type = 'task' and entity_id = '00000000-0000-0000-0000-0000000000c0' and task_id = '00000000-0000-0000-0000-0000000000c0' and run_id = '00000000-0000-0000-0000-0000000000b0'),
  1, 'inserting a task writes a created event with task_id and run_id'
);

update public.tasks set status = 'running' where id = '00000000-0000-0000-0000-0000000000c0';
select is(
  (select data from public.events where kind = 'status_changed' and task_id = '00000000-0000-0000-0000-0000000000c0'),
  '{"from": "pending", "to": "running"}'::jsonb, 'a status change writes status_changed with from and to'
);
select is(
  (select actor_type::text from public.events where kind = 'status_changed' and task_id = '00000000-0000-0000-0000-0000000000c0'),
  'system', 'actor defaults to system'
);

update public.tasks set title = 'renamed' where id = '00000000-0000-0000-0000-0000000000c0';
select is((select count(*)::int from public.events where task_id = '00000000-0000-0000-0000-0000000000c0'), 2, 'updating a non-status column writes nothing');

update public.tasks set status = 'running', priority = 5 where id = '00000000-0000-0000-0000-0000000000c0';
select is((select count(*)::int from public.events where kind = 'status_changed' and task_id = '00000000-0000-0000-0000-0000000000c0'), 1, 'setting status to its current value writes nothing');

select set_config('app.actor_type', 'worker', true);
select set_config('app.actor_id', 'worker-1', true);
update public.tasks set status = 'done' where id = '00000000-0000-0000-0000-0000000000c0';
select is(
  (select actor_type::text || '/' || actor_id from public.events where kind = 'status_changed' and data ->> 'to' = 'done'),
  'worker/worker-1', 'the actor override via set_config is respected'
);
select set_config('app.actor_type', '', true);
select set_config('app.actor_id', '', true);

update public.runs set status = 'running' where id = '00000000-0000-0000-0000-0000000000b0';
select is(
  (select data from public.events where kind = 'status_changed' and entity_type = 'run'),
  '{"from": "pending", "to": "running"}'::jsonb, 'a run status change writes status_changed'
);

-- gates
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b0', 'gate', 'g');
insert into public.gates (task_id, kind, title) values ('00000000-0000-0000-0000-0000000000c1', 'spec', 'gate');
select is(
  (select count(*)::int from public.events where kind = 'gate_created' and entity_type = 'gate' and task_id = '00000000-0000-0000-0000-0000000000c1' and run_id = '00000000-0000-0000-0000-0000000000b0'),
  1, 'inserting a gate writes gate_created'
);
update public.gates set comment = 'note' where task_id = '00000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.events where entity_type = 'gate'), 1, 'editing a gate comment writes nothing');
update public.gates set decision = 'approve', decided_at = now(), decided_via = 'dashboard' where task_id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select data from public.events where kind = 'gate_decided' and task_id = '00000000-0000-0000-0000-0000000000c1'),
  '{"decision": "approve", "via": "dashboard"}'::jsonb, 'deciding a gate writes gate_decided'
);

-- updated_at
select ok(
  (select updated_at > created_at or updated_at = created_at from public.tasks where id = '00000000-0000-0000-0000-0000000000c0'),
  'tasks.updated_at is maintained'
);

-- append-only (applies to superuser)
select throws_ok('update public.events set kind = ''x''', 'P0001', 'events are append-only', 'events cannot be updated');
select throws_ok('delete from public.events', 'P0001', 'events are append-only', 'events cannot be deleted');
select throws_ok('truncate public.events', 'P0001', 'events are append-only', 'events cannot be truncated');

-- events survive deleting what they describe
delete from public.runs where id = '00000000-0000-0000-0000-0000000000b0';
select ok((select count(*) from public.events where run_id = '00000000-0000-0000-0000-0000000000b0') > 0, 'events survive deleting the run');

select * from finish();
rollback;
