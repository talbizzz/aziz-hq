begin;
select plan(129);

-- helper: assert a table exists, has RLS enabled and the exact set of API privileges (M0 finding: no default grants)
create function pg_temp.check_table(t text, authed_privs text[]) returns setof text language plpgsql as $$
begin
  return next has_table('public', t, format('table %s exists', t));
  return next ok(
    (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass),
    format('RLS enabled on %s', t)
  );
  return next table_privs_are('public', t, 'anon', array[]::text[], format('anon has no privileges on %s', t));
  return next table_privs_are('public', t, 'authenticated', authed_privs, format('authenticated privileges on %s', t));
  return next table_privs_are(
    'public', t, 'service_role',
    array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'],
    format('service_role has all privileges on %s', t)
  );
end $$;

-- enums
select enum_has_labels('public', 'task_status', array['pending','running','waiting_human','done','failed','cancelled']);
select enum_has_labels('public', 'task_type', array['agent','gate','system']);
select enum_has_labels('public', 'run_status', array['pending','running','paused','done','failed','cancelled']);
select enum_has_labels('public', 'gate_decision', array['approve','modify','dismiss','answer']);
select enum_has_labels('public', 'actor_type', array['system','worker','agent','human']);

-- per-table structure, RLS and privileges
select * from pg_temp.check_table('app_owner', array['SELECT']);
select * from pg_temp.check_table('modules', array['SELECT']);
select * from pg_temp.check_table('runs', array['SELECT']);
select * from pg_temp.check_table('tasks', array['SELECT']);
select * from pg_temp.check_table('gates', array['SELECT']);
select * from pg_temp.check_table('events', array['SELECT']);
select * from pg_temp.check_table('usage', array['SELECT']);
select * from pg_temp.check_table('worker_heartbeats', array['SELECT']);
select * from pg_temp.check_table('settings', array['SELECT','UPDATE']);

-- app_owner
select col_is_pk('public', 'app_owner', 'user_id', 'app_owner user_id');
select col_type_is('public', 'app_owner', 'user_id', 'uuid', 'app_owner user_id');
select fk_ok('public', 'app_owner', 'user_id', 'auth', 'users', 'id');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'app_owner' and indexname = 'app_owner_single'), 'index app_owner_single exists');

-- modules
select col_is_pk('public', 'modules', 'id', 'modules id');
select col_type_is('public', 'modules', 'id', 'text', 'modules id');
select col_type_is('public', 'modules', 'name', 'text', 'modules name');
select col_type_is('public', 'modules', 'enabled', 'boolean', 'modules enabled');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'modules' and column_name = 'enabled'), 'true', 'modules.enabled default');

-- runs
select col_is_pk('public', 'runs', 'id', 'runs id');
select col_type_is('public', 'runs', 'id', 'uuid', 'runs id');
select fk_ok('public', 'runs', 'module_id', 'public', 'modules', 'id');
select col_type_is('public', 'runs', 'status', 'run_status', 'runs status');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'runs' and column_name = 'status'), '''pending''::run_status', 'runs.status default');
select col_type_is('public', 'runs', 'config', 'jsonb', 'runs config');
select col_type_is('public', 'runs', 'updated_at', 'timestamp with time zone', 'runs updated_at');
select col_type_is('public', 'runs', 'finished_at', 'timestamp with time zone', 'runs finished_at');
select col_not_null('public', 'runs', 'title', 'runs title');

-- tasks
select col_is_pk('public', 'tasks', 'id', 'tasks id');
select fk_ok('public', 'tasks', 'run_id', 'public', 'runs', 'id');
select col_type_is('public', 'tasks', 'type', 'task_type', 'tasks type');
select col_type_is('public', 'tasks', 'status', 'task_status', 'tasks status');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'status'), '''pending''::task_status', 'tasks.status default');
select col_type_is('public', 'tasks', 'depends_on', 'uuid[]', 'tasks depends_on');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'depends_on'), '''{}''::uuid[]', 'tasks.depends_on default');
select col_type_is('public', 'tasks', 'attempts', 'integer', 'tasks attempts');
select col_type_is('public', 'tasks', 'max_attempts', 'integer', 'tasks max_attempts');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'max_attempts'), '3', 'tasks.max_attempts default');
select col_type_is('public', 'tasks', 'lease_until', 'timestamp with time zone', 'tasks lease_until');
select col_type_is('public', 'tasks', 'claimed_by', 'text', 'tasks claimed_by');
select col_type_is('public', 'tasks', 'priority', 'integer', 'tasks priority');
select col_type_is('public', 'tasks', 'lane', 'text', 'tasks lane');
select col_type_is('public', 'tasks', 'payload', 'jsonb', 'tasks payload');
select col_type_is('public', 'tasks', 'result', 'jsonb', 'tasks result');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'tasks' and indexname = 'tasks_run_status_idx'), 'index tasks_run_status_idx exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'tasks' and indexname = 'tasks_pending_queue_idx'), 'index tasks_pending_queue_idx exists');

-- gates
select col_is_pk('public', 'gates', 'task_id', 'gates task_id');
select fk_ok('public', 'gates', 'task_id', 'public', 'tasks', 'id');
select col_type_is('public', 'gates', 'priority', 'smallint', 'gates priority');
select col_type_is('public', 'gates', 'context', 'jsonb', 'gates context');
select col_type_is('public', 'gates', 'options', 'jsonb', 'gates options');
select col_type_is('public', 'gates', 'decision', 'gate_decision', 'gates decision');
select col_type_is('public', 'gates', 'decided_via', 'text', 'gates decided_via');

-- events
select col_is_pk('public', 'events', 'id', 'events id');
select col_type_is('public', 'events', 'id', 'bigint', 'events id');
select col_type_is('public', 'events', 'actor_type', 'actor_type', 'events actor_type');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'actor_type'), '''system''::actor_type', 'events.actor_type default');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'events' and indexname = 'events_run_idx'), 'index events_run_idx exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'events' and indexname = 'events_task_idx'), 'index events_task_idx exists');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.events'::regclass and contype = 'f'),
  0, 'events has no foreign keys'
);

-- usage
select col_is_pk('public', 'usage', 'id', 'usage id');
select col_type_is('public', 'usage', 'cost_usd', 'numeric(12,6)', 'usage cost_usd');
select col_type_is('public', 'usage', 'input_tokens', 'bigint', 'usage input_tokens');
select col_type_is('public', 'usage', 'cache_read_tokens', 'bigint', 'usage cache_read_tokens');
select col_not_null('public', 'usage', 'runner', 'usage runner');

-- worker_heartbeats, settings
select col_is_pk('public', 'worker_heartbeats', 'worker_id', 'worker_heartbeats worker_id');
select col_type_is('public', 'worker_heartbeats', 'info', 'jsonb', 'worker_heartbeats info');
select col_is_pk('public', 'settings', 'key', 'settings key');
select col_type_is('public', 'settings', 'value', 'jsonb', 'settings value');

-- realtime publication (manual migration, ADR-4)
select is(
  (select array_agg(tablename::text order by tablename) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'),
  array['events','gates','overrides','runs','tasks','worker_heartbeats'],
  'supabase_realtime publishes the realtime tables'
);

-- seed
select is((select name from public.modules where id = 'factory'), 'SaaS Factory', 'factory module is seeded');

-- constraint behaviour (runs as the postgres superuser inside the test transaction)
insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'factory', 'r1');
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'system', 't-system');

select throws_ok(
  $$insert into public.tasks (run_id, type, title) values ('00000000-0000-0000-0000-0000000000a1', 'agent', 'no role')$$,
  '23514', null, 'agent task without role is rejected'
);
select lives_ok(
  $$insert into public.tasks (run_id, type, role, title) values ('00000000-0000-0000-0000-0000000000a1', 'agent', 'builder', 'with role')$$,
  'agent task with a role is accepted'
);
select throws_ok(
  $$insert into public.tasks (run_id, type, title, lease_until) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'leased pending', now())$$,
  '23514', null, 'lease_until while pending is rejected'
);
select lives_ok(
  $$insert into public.tasks (run_id, type, title, status, lease_until) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'leased running', 'running', now())$$,
  'lease_until while running is accepted'
);
select throws_ok(
  $$insert into public.tasks (run_id, type, title, attempts) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'neg', -1)$$,
  '23514', null, 'negative attempts rejected'
);
select throws_ok(
  $$insert into public.tasks (run_id, type, title, max_attempts) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'zero', 0)$$,
  '23514', null, 'max_attempts below 1 rejected'
);

-- gates
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'gate', 't-gate');
select throws_ok(
  $$insert into public.gates (task_id, kind, title) values ('00000000-0000-0000-0000-0000000000b1', 'spec', 'on a non-gate task')$$,
  '23514', null, 'gate pointing at a non-gate task is rejected'
);
select lives_ok(
  $$insert into public.gates (task_id, kind, title) values ('00000000-0000-0000-0000-0000000000b2', 'spec', 'ok gate')$$,
  'gate on a gate task is accepted'
);
select throws_ok(
  $$update public.gates set decision = 'approve' where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', null, 'decision without decided_at is rejected'
);
select throws_ok(
  $$update public.gates set decided_at = now() where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', null, 'decided_at without decision is rejected'
);
select lives_ok(
  $$update public.gates set decision = 'approve', decided_at = now(), decided_via = 'dashboard' where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  'decision with decided_at is accepted'
);
select throws_ok(
  $$update public.gates set decided_via = 'email' where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', null, 'decided_via outside dashboard/telegram rejected'
);
select throws_ok(
  $$update public.gates set kind = 'nonsense' where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', null, 'unknown gate kind rejected'
);
select throws_ok(
  $$update public.gates set priority = 3 where task_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', null, 'gate priority above 2 rejected'
);

-- cascade: deleting a run deletes its tasks and their gates
delete from public.runs where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.tasks where run_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'tasks cascade with the run');
select is((select count(*)::int from public.gates where task_id = '00000000-0000-0000-0000-0000000000b2'), 0, 'gates cascade with the task');

-- app_owner: single row, restrict on user deletion
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000c2')$$,
  '23505', null, 'a second app_owner row is rejected'
);
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23503', null, 'deleting the owner user is restricted'
);

select * from finish();
rollback;
