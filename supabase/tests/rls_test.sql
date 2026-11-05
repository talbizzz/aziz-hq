begin;
select plan(75);
\ir support/helpers.inc

-- fixtures (as superuser)
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0');  -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1');  -- someone else
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');
insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000b0', 'factory', 'run');
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000b0', 'gate', 'gate task');
insert into public.gates (task_id, kind, title) values ('00000000-0000-0000-0000-0000000000c0', 'spec', 'gate');
insert into public.usage (runner) values ('fake');
insert into public.worker_heartbeats (worker_id) values ('w1');
insert into public.settings (key, value) values ('k', '1');

create temp table tables_under_test (t text) on commit drop;
insert into tables_under_test values ('app_owner'),('modules'),('runs'),('tasks'),('gates'),('events'),('usage'),('worker_heartbeats'),('settings');
grant select on tables_under_test to anon, authenticated;

select ok((select min(c) > 0 from (
  select (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::int as c from tables_under_test
) q), 'fixtures: every table has at least one row');

-- (1) anon cannot select any table
select pg_temp.act_as_anon();
select throws_ok(format('select * from public.%I', t), '42501', null, 'anon cannot select ' || t) from tables_under_test;
reset role;

-- (2) authenticated non-owner at aal2 sees nothing
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text, '0', 'non-owner aal2 sees 0 rows in ' || t) from tables_under_test;
reset role;

-- (3) owner at aal1 sees nothing
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select is((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text, '0', 'owner aal1 sees 0 rows in ' || t) from tables_under_test;
reset role;

-- (4) owner at aal2 sees everything
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select cmp_ok((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::int, '>', 0, 'owner aal2 sees rows in ' || t) from tables_under_test;

-- (5) owner cannot write anything except updating settings
select throws_ok(format('insert into public.%I default values', t), '42501', null, 'owner cannot insert into ' || t) from tables_under_test;
select throws_ok(format('delete from public.%I', t), '42501', null, 'owner cannot delete from ' || t) from tables_under_test;
select throws_ok(format('update public.%I set created_at = created_at', t), '42501', null, 'owner cannot update ' || t) from tables_under_test where t <> 'settings';
select lives_ok($$update public.settings set value = '2' where key = 'k'$$, 'owner aal2 can update settings');
reset role;
select is((select value::text from public.settings where key = 'k'), '2', 'the owner update at aal2 took effect');

-- settings update is owner-only at aal2
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select lives_ok($$update public.settings set value = '3' where key = 'k'$$, 'owner aal1 settings update runs but matches no rows');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select lives_ok($$update public.settings set value = '3' where key = 'k'$$, 'non-owner aal2 settings update runs but matches no rows');
reset role;
select is((select value::text from public.settings where key = 'k'), '2', 'settings value only changed by the owner at aal2');

-- (6) is_owner() truth table
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is(public.is_owner(), true, 'owner + aal2 is owner');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select is(public.is_owner(), false, 'owner + aal1 is not owner');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is(public.is_owner(), false, 'other user + aal2 is not owner');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal1');
select is(public.is_owner(), false, 'other user + aal1 is not owner');
reset role;

-- (7) anon: health() yes, is_owner() no
select pg_temp.act_as_anon();
select is(public.health(), 'ok', 'anon can call health()');
select throws_ok('select public.is_owner()', '42501', null, 'anon cannot call is_owner()');
reset role;
select ok(not has_function_privilege('public', 'public.is_owner()', 'execute'), 'PUBLIC cannot execute is_owner()');

select * from finish();
rollback;
