begin;
select plan(44);
\ir support/helpers.inc

insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'factory', 'r1');
insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000a2', 'factory', 'r2');

-- Every ordered pair of statuses: allowed exactly when it is in the state machine (C1 of milestone 2).
create function pg_temp.transition_matrix() returns setof text language plpgsql as $$
declare
  s text;
  t text;
  allowed boolean;
  ok_result boolean;
  task_id uuid;
begin
  foreach s in array array['pending','running','waiting_human','done','failed','cancelled'] loop
    foreach t in array array['pending','running','waiting_human','done','failed','cancelled'] loop
      continue when s = t;
      allowed := (s, t) in (
        ('pending','running'), ('pending','waiting_human'), ('pending','cancelled'),
        ('running','done'), ('running','failed'), ('running','pending'), ('running','cancelled'),
        ('waiting_human','done'), ('waiting_human','cancelled')
      );
      task_id := gen_random_uuid();
      insert into public.tasks (id, run_id, type, title, status)
      values (task_id, '00000000-0000-0000-0000-0000000000a1', 'gate', format('%s->%s', s, t), s::public.task_status);
      begin
        update public.tasks set status = t::public.task_status where id = task_id;
        ok_result := allowed;
      exception when check_violation then
        ok_result := not allowed;
      end;
      return next ok(ok_result, format('transition %s -> %s is %s', s, t, case when allowed then 'allowed' else 'rejected' end));
    end loop;
  end loop;
end $$;
select * from pg_temp.transition_matrix();

-- the error message
insert into public.tasks (id, run_id, type, title, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'system', 'done task', 'done');
select throws_ok(
  $$update public.tasks set status = 'running' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '23514', 'invalid task status transition: done -> running', 'terminal state cannot be left'
);

-- only gate tasks may wait for a human
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'system', 'sys');
select throws_ok(
  $$update public.tasks set status = 'waiting_human' where id = '00000000-0000-0000-0000-0000000000b2'$$,
  '23514', 'invalid task status transition: pending -> waiting_human', 'a non-gate task cannot wait for a human'
);

-- lease and claimed_by bookkeeping
insert into public.tasks (id, run_id, type, title, status, lease_until, claimed_by)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'system', 'leased', 'running', now() + interval '1 minute', 'w1');
update public.tasks set status = 'done' where id = '00000000-0000-0000-0000-0000000000b3';
select is((select lease_until from public.tasks where id = '00000000-0000-0000-0000-0000000000b3'), null, 'lease cleared when leaving running (done)');
select is((select claimed_by from public.tasks where id = '00000000-0000-0000-0000-0000000000b3'), 'w1', 'claimed_by kept on done');

insert into public.tasks (id, run_id, type, title, status, lease_until, claimed_by)
values ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a1', 'system', 'retry', 'running', now() + interval '1 minute', 'w1');
update public.tasks set status = 'pending' where id = '00000000-0000-0000-0000-0000000000b4';
select is((select lease_until from public.tasks where id = '00000000-0000-0000-0000-0000000000b4'), null, 'lease cleared on retry');
select is((select claimed_by from public.tasks where id = '00000000-0000-0000-0000-0000000000b4'), null, 'claimed_by cleared on retry');

-- dependency validation
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'system', 'dep');
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a2', 'system', 'other run');
select lives_ok(
  $$insert into public.tasks (run_id, type, title, depends_on) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'ok', array['00000000-0000-0000-0000-0000000000c1']::uuid[])$$,
  'a dependency on an existing task of the same run is accepted'
);
select throws_ok(
  $$insert into public.tasks (run_id, type, title, depends_on) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'bad', array['00000000-0000-0000-0000-0000000000ff']::uuid[])$$,
  '22023', 'unknown dependency 00000000-0000-0000-0000-0000000000ff', 'unknown dependency rejected'
);
select throws_ok(
  $$insert into public.tasks (run_id, type, title, depends_on) values ('00000000-0000-0000-0000-0000000000a1', 'system', 'bad', array['00000000-0000-0000-0000-0000000000c9']::uuid[])$$,
  '22023', 'dependency in another run 00000000-0000-0000-0000-0000000000c9', 'dependency in another run rejected'
);
select throws_ok(
  $$insert into public.tasks (id, run_id, type, title, depends_on) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'system', 'self', array['00000000-0000-0000-0000-0000000000d1']::uuid[])$$,
  '22023', 'task cannot depend on itself', 'self dependency rejected'
);
select throws_ok(
  $$update public.tasks set depends_on = array['00000000-0000-0000-0000-0000000000c1']::uuid[] where id = '00000000-0000-0000-0000-0000000000b2'$$,
  '22023', 'depends_on is immutable', 'depends_on cannot be updated'
);
select lives_ok(
  $$update public.tasks set title = 'renamed' where id = '00000000-0000-0000-0000-0000000000c1'$$,
  'other columns can still be updated'
);

-- event data hook: app.event_data is merged into status_changed data; unchanged when unset
insert into public.tasks (id, run_id, type, title) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'system', 'evt');
select set_config('app.event_data', '{"reason":"claimed","attempt":1}', true);
update public.tasks set status = 'running' where id = '00000000-0000-0000-0000-0000000000e1';
select is(
  (select data from public.events where task_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'status_changed'),
  '{"from":"pending","to":"running","reason":"claimed","attempt":1}'::jsonb, 'app.event_data is merged into the status event'
);
select set_config('app.event_data', '', true);
update public.tasks set status = 'done' where id = '00000000-0000-0000-0000-0000000000e1';
select is(
  (select data from public.events where task_id = '00000000-0000-0000-0000-0000000000e1' and data ->> 'to' = 'done'),
  '{"from":"running","to":"done"}'::jsonb, 'status event data is unchanged when app.event_data is empty'
);

select * from finish();
rollback;
