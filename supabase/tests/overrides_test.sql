begin;
select plan(51);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');

-- next local midnight (off_today expiry), incl. DST changeover days in Europe/Berlin
select is(public.next_local_midnight('2026-11-05 21:30:00+00', 'Europe/Berlin'), '2026-11-05 23:00:00+00'::timestamptz, 'winter: next midnight is 00:00 CET');
select is(public.next_local_midnight('2026-11-05 23:30:00+00', 'Europe/Berlin'), '2026-11-06 23:00:00+00'::timestamptz, 'after local midnight it is the following one');
select is(public.next_local_midnight('2026-03-28 12:00:00+00', 'Europe/Berlin'), '2026-03-28 23:00:00+00'::timestamptz, 'day before DST starts');
select is(public.next_local_midnight('2026-03-29 12:00:00+00', 'Europe/Berlin'), '2026-03-29 22:00:00+00'::timestamptz, 'DST day is 23 hours long');
select is(public.next_local_midnight('2026-10-25 12:00:00+00', 'Europe/Berlin'), '2026-10-25 23:00:00+00'::timestamptz, 'DST ends: 25-hour day');
select is(public.next_local_midnight('2026-06-01 10:00:00+00', 'UTC'), '2026-06-02 00:00:00+00'::timestamptz, 'UTC');

-- who may set and clear
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select throws_ok($$select public.set_override('pause', 60)$$, '42501', 'not authorised', 'a non-owner is refused');
select throws_ok($$select public.clear_override('pause')$$, '42501', 'not authorised', 'a non-owner cannot clear');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select throws_ok($$select public.set_override('pause', 60)$$, '42501', 'not authorised', 'the owner at aal1 is refused');
reset role;
select pg_temp.act_as_anon();
select throws_ok($$select public.set_override('pause', 60)$$, '42501', null, 'anon cannot execute it');
reset role;

-- the owner at aal2
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select isnt(public.set_override('pause', 60), null, 'the owner sets a pause');
select is((select count(*)::int from public.active_overrides where kind = 'pause'), 1, 'it is active and visible to the owner');
select is((select created_by from public.active_overrides where kind = 'pause'), 'dashboard', 'created via the dashboard by default');
select ok((select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes' from public.active_overrides where kind = 'pause'), 'it expires in an hour');
select isnt(public.set_override('pause', 120), null, 'setting again replaces the previous pause');
select is((select count(*)::int from public.active_overrides where kind = 'pause'), 1, 'still exactly one active pause');
select is((select count(*)::int from public.overrides where kind = 'pause'), 2, 'the replaced row is kept, cleared');
select isnt(public.set_override('off_today'), null, 'the owner switches "off today" on');
select is((select count(*)::int from public.active_overrides), 2, 'two kinds can be active together');
select is(public.clear_override('pause'), 1, 'clearing reports one cleared');
select is(public.clear_override('pause'), 0, 'clearing again clears nothing');
select is((select count(*)::int from public.active_overrides where kind = 'pause'), 0, 'the pause is gone');
reset role;

-- validation
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select throws_ok($$select public.set_override('pause', 0)$$, '22023', 'pause minutes must be between 1 and 1440', 'zero minutes rejected');
select throws_ok($$select public.set_override('pause', 1441)$$, '22023', 'pause minutes must be between 1 and 1440', 'more than a day rejected');
select throws_ok($$select public.set_override('pause', null)$$, '22023', 'pause minutes must be between 1 and 1440', 'minutes are required for a pause');
select throws_ok($$select public.set_override('party', 5)$$, '22023', 'unknown override kind: party', 'unknown kind rejected');
select throws_ok($$select public.set_override('pause', 5, 'email')$$, '22023', 'invalid created_by: email', 'unknown source rejected');
reset role;

-- service role (Telegram) can set and clear; off_today ends at the next local midnight
select pg_temp.act_as_service();
select isnt(public.set_override('off_today', null, 'telegram'), null, 'service_role sets "off today" for Telegram');
select is((select created_by from public.overrides where kind = 'off_today' and cleared_at is null), 'telegram', 'created via telegram');
select ok((select expires_at = public.next_local_midnight(created_at, coalesce((select value #>> '{}' from public.settings where key = 'timezone'), 'Europe/Berlin')) from public.overrides where kind = 'off_today' and cleared_at is null), 'off_today expires at the next local midnight');
select is(public.clear_override('off_today'), 1, 'service_role clears it');
reset role;

-- an unusable timezone setting must not break "off today": it falls back to Europe/Berlin
select pg_temp.act_as_service();
update public.settings set value = '"Not/AZone"' where key = 'timezone';
select lives_ok($$select public.set_override('off_today', null, 'telegram')$$, 'an invalid timezone setting falls back instead of failing');
select is(public.clear_override('off_today'), 1, 'and the override is active and clearable');
reset role;

-- expired rows are not active
insert into public.overrides (kind, expires_at, created_by) values ('pause', now() - interval '1 minute', 'dashboard');
select is((select count(*)::int from public.active_overrides), 0, 'an expired override is not active');

-- RLS: only the owner at aal2 reads
delete from public.overrides;
insert into public.overrides (kind, expires_at, created_by) values ('pause', now() + interval '1 hour', 'dashboard');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is((select count(*)::int from public.overrides), 1, 'the owner at aal2 reads overrides');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select is((select count(*)::int from public.overrides), 0, 'the owner at aal1 reads nothing');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is((select count(*)::int from public.overrides), 0, 'a non-owner reads nothing');
select throws_ok($$insert into public.overrides (kind, expires_at, created_by) values ('pause', now(), 'dashboard')$$, '42501', null, 'no direct writes for authenticated');
reset role;
select pg_temp.act_as_anon();
select throws_ok($$select * from public.overrides$$, '42501', null, 'anon has no access to the table');
reset role;

-- a pause stops claiming but not gates (milestone 2 functions)
delete from public.overrides;
create temp table r on commit drop as select public.create_run('factory', 'paused', '{}', '[
  {"key":"work","type":"system","title":"work"},
  {"key":"gate","type":"gate","title":"gate","gate":{"kind":"spec","title":"g"}}
]') -> 'tasks' as ids;
select pg_temp.act_as_service();
select public.set_override('pause', 30, 'telegram');
select is((select count(*)::int from public.claim_task('w')), 0, 'no task is claimed while paused');
select is(public.promote_ready_gates(), 1, 'gates still open while paused');
select is(public.clear_override('pause'), 1, 'resume');
select is((select title from public.claim_task('w')), 'work', 'claiming works again after resume');
reset role;
update public.tasks set status = 'pending', lease_until = null, claimed_by = null where title = 'work';
insert into public.overrides (kind, expires_at, created_by) values ('pause', now() - interval '1 second', 'dashboard');
select pg_temp.act_as_service();
select is((select title from public.claim_task('w')), 'work', 'an expired pause no longer blocks claiming (auto-expiry)');
reset role;

-- privileges
select ok(has_function_privilege('service_role', 'public.set_override(text, integer, text)', 'execute'), 'service_role can set_override');
select ok(has_function_privilege('authenticated', 'public.set_override(text, integer, text)', 'execute'), 'authenticated can call set_override (checked inside)');
select ok(not has_function_privilege('anon', 'public.set_override(text, integer, text)', 'execute'), 'anon cannot set_override');
select ok(not has_function_privilege('public', 'public.clear_override(text)', 'execute'), 'PUBLIC cannot clear_override');
select ok(not has_table_privilege('authenticated', 'public.overrides', 'insert'), 'authenticated cannot insert directly');
select ok(has_table_privilege('authenticated', 'public.overrides', 'select'), 'authenticated can select (RLS applies)');
select ok(not has_table_privilege('anon', 'public.overrides', 'select'), 'anon cannot select');

select * from finish();
rollback;
