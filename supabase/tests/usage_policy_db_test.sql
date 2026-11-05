begin;
select plan(58);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');
delete from public.overrides;

-- ===== settings seed =====
select is((select value -> 'sleeping_hours' from public.settings where key = 'usage_policy'), '{"start": "00:00", "end": "08:00"}'::jsonb, 'usage_policy defaults are seeded');
select is((select (value ->> 'cap_work_pct')::int || '/' || (value ->> 'cap_sleeping_pct') || '/' || (value ->> 'weekly_margin_pct') || '/' || (value ->> 'weekly_ceiling_pct') from public.settings where key = 'usage_policy'), '50/100/10/90', 'default caps, margin and ceiling');

-- ===== usage_snapshots =====
select pg_temp.act_as_service();
select isnt(public.record_usage_snapshot('rate_limit_event', 12.5, now() + interval '3 hours', 40, now() + interval '4 days', null, null), null, 'service_role records a snapshot');
select throws_ok($$select public.record_usage_snapshot('guess', 1, now(), 1, now(), null, null)$$, '23514', null, 'an unknown source is rejected');
select throws_ok($$select public.record_usage_snapshot('estimate', 101, now(), 1, now(), null, null)$$, '23514', null, 'a percentage above 100 is rejected');
select throws_ok($$select public.record_usage_snapshot('estimate', -1, now(), 1, now(), null, null)$$, '23514', null, 'a negative percentage is rejected');
reset role;
select is((select five_hour_pct::text || '/' || seven_day_pct::text from public.usage_snapshots where source = 'rate_limit_event'), '12.50/40.00', 'the values are stored');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is((select count(*)::int from public.usage_snapshots), 1, 'the owner at aal2 reads snapshots');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is((select count(*)::int from public.usage_snapshots), 0, 'a non-owner reads nothing');
select throws_ok($$insert into public.usage_snapshots (source, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) values ('estimate', 1, now(), 1, now())$$, '42501', null, 'no direct writes for authenticated');
reset role;
select pg_temp.act_as_anon();
select throws_ok($$select * from public.usage_snapshots$$, '42501', null, 'anon cannot read snapshots');
reset role;

-- ===== set_mode_override =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select isnt(public.set_mode_override('working'), null, 'the owner switches to "I am working"');
select ok((select expires_at between now() + interval '299 minutes' and now() + interval '301 minutes' from public.active_overrides where kind = 'working'), 'a mode lasts five hours');
select is((select cap_pct from public.active_overrides where kind = 'working'), null, 'the cap comes from settings, not the row');
select isnt(public.set_mode_override('stop'), null, 'stop');
select isnt(public.set_mode_override('sleeping'), null, 'sleeping');
select is((select count(*)::int from public.active_overrides where kind in ('working', 'stop', 'sleeping')), 3, 'different modes coexist (the newest one wins in the policy engine)');
select isnt(public.set_mode_override('working'), null, 'setting a mode again replaces it');
select is((select count(*)::int from public.active_overrides where kind = 'working'), 1, 'still one active "working"');
select isnt(public.set_mode_override('custom', 120, 70), null, 'a custom mode with minutes and a cap');
select is((select cap_pct from public.active_overrides where kind = 'custom'), 70::smallint, 'custom stores its cap');
select ok((select expires_at between now() + interval '119 minutes' and now() + interval '121 minutes' from public.active_overrides where kind = 'custom'), 'custom lasts the given minutes');
select throws_ok($$select public.set_mode_override('custom', 120, null)$$, '22023', 'custom needs minutes (1-1440) and cap_pct (0-100)', 'custom needs a cap');
select throws_ok($$select public.set_mode_override('custom', 0, 50)$$, '22023', 'custom needs minutes (1-1440) and cap_pct (0-100)', 'custom minutes lower bound');
select throws_ok($$select public.set_mode_override('custom', 1441, 50)$$, '22023', 'custom needs minutes (1-1440) and cap_pct (0-100)', 'custom minutes upper bound');
select throws_ok($$select public.set_mode_override('custom', 60, 101)$$, '22023', 'custom needs minutes (1-1440) and cap_pct (0-100)', 'custom cap upper bound');
select throws_ok($$select public.set_mode_override('limit')$$, '22023', 'unknown mode: limit', 'limits are created by the system only');
select throws_ok($$select public.set_mode_override('party')$$, '22023', 'unknown mode: party', 'unknown mode');
select is(public.clear_override('working'), 1, 'clear_override works for the new kinds');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select throws_ok($$select public.set_mode_override('stop')$$, '42501', 'not authorised', 'a non-owner is refused');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select throws_ok($$select public.set_mode_override('stop')$$, '42501', 'not authorised', 'the owner at aal1 is refused');
reset role;
select pg_temp.act_as_service();
select isnt(public.set_mode_override('working', null, null, 'telegram'), null, 'service_role (Telegram) can set a mode');
select is((select created_by from public.overrides where kind = 'working' and cleared_at is null), 'telegram', 'created via telegram');
reset role;

-- ===== release_for_limit =====
delete from public.overrides;
create temp table r on commit drop as select public.create_run('factory', 'limit run', '{}', '[{"key":"t","type":"system","title":"t"}]') -> 'tasks' as ids;
create function pg_temp.tid() returns uuid language sql as $$ select ((select ids from r) ->> 't')::uuid $$;
grant select on r to public;
grant execute on function pg_temp.tid() to public;
select pg_temp.act_as_service();
select is((select id from public.claim_task('lw')), pg_temp.tid(), 'a worker claims the task');
select is(public.release_for_limit(pg_temp.tid(), 'someone-else', now() + interval '2 hours'), false, 'a non-owner cannot release it');
select is((select count(*)::int from public.overrides), 0, 'and no limit override is created');
select is(public.release_for_limit(pg_temp.tid(), 'lw', now() + interval '2 hours'), true, 'the owner releases the task for a limit');
reset role;
select is((select status::text || '/' || attempts from public.tasks where id = pg_temp.tid()), 'pending/0', 'back to pending without consuming the attempt');
select is((select claimed_by from public.tasks where id = pg_temp.tid()), null, 'the claim is released');
select is((select data ->> 'reason' from public.events where task_id = pg_temp.tid() and data ->> 'to' = 'pending'), 'limit_hit', 'the event records limit_hit');
select is((select kind || '/' || created_by from public.overrides where cleared_at is null), 'limit/system', 'a limit override is recorded by the system');
select ok((select expires_at between now() + interval '119 minutes' and now() + interval '121 minutes' from public.overrides where kind = 'limit' and cleared_at is null), 'it expires at the reset time');
select pg_temp.act_as_service();
select is(public.release_for_limit(pg_temp.tid(), 'lw', now() + interval '2 hours'), false, 'a task that is not running cannot be released again');
select is((select id from public.claim_task('lw2')), pg_temp.tid(), 'it can be claimed again (the policy, not claim_task, holds the worker back)');
select is(public.release_for_limit(pg_temp.tid(), 'lw2', null), true, 'a missing reset time falls back to 30 minutes');
select is(public.release_for_limit(pg_temp.tid(), 'lw2', null), false, 'again not running');
reset role;
select ok((select expires_at between now() + interval '29 minutes' and now() + interval '31 minutes' from public.overrides where kind = 'limit' and cleared_at is null), 'the 30 minute fallback replaced the earlier limit');
select is((select count(*)::int from public.overrides where kind = 'limit' and cleared_at is null), 1, 'only one active limit');
select pg_temp.act_as_service();
select is((select id from public.claim_task('lw3')), pg_temp.tid(), 'claimed a third time');
select is(public.release_for_limit(pg_temp.tid(), 'lw3', now() - interval '1 hour'), true, 'a reset time in the past');
reset role;
select ok((select expires_at > now() + interval '29 minutes' from public.overrides where kind = 'limit' and cleared_at is null), 'a past reset time also falls back to 30 minutes');

-- ===== privileges =====
select ok(has_function_privilege('service_role', 'public.release_for_limit(uuid, text, timestamptz)', 'execute'), 'service_role can release_for_limit');
select ok(not has_function_privilege('authenticated', 'public.release_for_limit(uuid, text, timestamptz)', 'execute'), 'authenticated cannot');
select ok(not has_function_privilege('anon', 'public.release_for_limit(uuid, text, timestamptz)', 'execute'), 'anon cannot');
select ok(has_function_privilege('service_role', 'public.record_usage_snapshot(text, numeric, timestamptz, numeric, timestamptz, uuid, uuid)', 'execute'), 'service_role can record snapshots');
select ok(not has_function_privilege('authenticated', 'public.record_usage_snapshot(text, numeric, timestamptz, numeric, timestamptz, uuid, uuid)', 'execute'), 'authenticated cannot');
select ok(has_function_privilege('authenticated', 'public.set_mode_override(text, integer, integer, text)', 'execute'), 'authenticated can call set_mode_override (checked inside)');
select ok(not has_function_privilege('anon', 'public.set_mode_override(text, integer, integer, text)', 'execute'), 'anon cannot');

select * from finish();
rollback;
