begin;
select plan(16);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');
delete from public.overrides;
delete from public.usage_snapshots;
update public.settings set value = '"Europe/Berlin"'::jsonb where key = 'timezone';

-- ===== "today": until the next local midnight =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select isnt(public.set_override('pacing_bypass_day'), null, 'the owner bypasses the weekly pacing for today');
select is((select expires_at from public.active_overrides where kind = 'pacing_bypass_day'), public.next_local_midnight(now(), 'Europe/Berlin'), 'the day bypass ends at the next local midnight');
select isnt(public.set_override('pacing_bypass_day'), null, 'setting it again replaces it');
select is((select count(*)::int from public.active_overrides where kind = 'pacing_bypass_day'), 1, 'still one active day bypass');

-- ===== "this week": until the weekly window resets =====
select is(public.set_override('pacing_bypass_week') is not null, true, 'without a usage snapshot the week bypass lasts seven days');
select ok((select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from public.active_overrides where kind = 'pacing_bypass_week'), 'seven days from now when there is no snapshot');
reset role;
insert into public.usage_snapshots (source, at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at)
values ('rate_limit_event', now() - interval '10 minutes', 10, now() + interval '2 hours', 70, now() + interval '2 days');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select isnt(public.set_override('pacing_bypass_week'), null, 'the owner bypasses the weekly pacing for the week');
select is((select expires_at from public.active_overrides where kind = 'pacing_bypass_week'), (select seven_day_resets_at from public.usage_snapshots order by at desc limit 1), 'the week bypass ends when the weekly window resets');
reset role;
-- a snapshot whose window already reset must not produce an expired (useless) bypass
insert into public.usage_snapshots (source, at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at)
values ('rate_limit_event', now(), 0, now() - interval '1 hour', 0, now() - interval '1 hour');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select isnt(public.set_override('pacing_bypass_week'), null, 'a stale snapshot still gives a bypass');
select ok((select expires_at > now() + interval '6 days' from public.active_overrides where kind = 'pacing_bypass_week'), 'a stale snapshot falls back to seven days');

-- ===== clearing and the other kinds are unaffected =====
select is(public.clear_override('pacing_bypass_week'), 1, 'clear_override removes the week bypass');
select is((select count(*)::int from public.active_overrides where kind = 'pacing_bypass_day'), 1, 'the day bypass is untouched');
select throws_ok($$select public.set_override('pacing_bypass_month')$$, '22023', 'unknown override kind: pacing_bypass_month', 'unknown kind rejected');
reset role;

-- ===== who may do it =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select throws_ok($$select public.set_override('pacing_bypass_week')$$, '42501', 'not authorised', 'a non-owner is refused');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select throws_ok($$select public.set_override('pacing_bypass_day')$$, '42501', 'not authorised', 'the owner at aal1 is refused');
reset role;
select pg_temp.act_as_service();
select isnt(public.set_override('pacing_bypass_day', null, 'telegram'), null, 'service_role (Telegram) can set it');
reset role;

select * from finish();
rollback;
