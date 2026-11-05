begin;
select plan(49);

insert into public.runs (id, module_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'factory', 'open run');
insert into public.runs (id, module_id, title, status) values ('00000000-0000-0000-0000-0000000000a2', 'factory', 'closed run', 'done');

-- diamond, listed in reverse order: insertion order must not matter
select is(
  (select jsonb_object_keys_count from (select count(*)::int as jsonb_object_keys_count from jsonb_object_keys(
    public.create_task_graph('00000000-0000-0000-0000-0000000000a1', $j$[
      {"key":"d","type":"system","title":"D","depends_on":["b","c"]},
      {"key":"b","type":"agent","role":"builder","title":"B","depends_on":["a"]},
      {"key":"c","type":"agent","role":"builder","title":"C","depends_on":["a"]},
      {"key":"a","type":"system","title":"A"}
    ]$j$))) q),
  4, 'returns one id per key'
);

create temp table ids on commit drop as
  select t.title, t.id, t.depends_on, t.priority, t.max_attempts, t.payload, t.role, t.type
  from public.tasks t where t.run_id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from ids), 4, 'four tasks inserted');
select is((select depends_on from ids where title = 'A'), '{}'::uuid[], 'A has no dependencies');
select is((select depends_on from ids where title = 'B'), array[(select id from ids where title = 'A')], 'B depends on A (real id)');
select is(
  (select array_agg(x order by x) from unnest((select depends_on from ids where title = 'D')) x),
  (select array_agg(id order by id) from ids where title in ('B', 'C')), 'D depends on B and C'
);
select is((select priority from ids where title = 'A'), 0, 'default priority');
select is((select max_attempts from ids where title = 'A'), 3, 'default max_attempts');
select is((select payload from ids where title = 'A'), '{}'::jsonb, 'default payload');
select is((select role from ids where title = 'B'), 'builder', 'role stored');
select is(
  (select count(*)::int from public.events where kind = 'created' and entity_type = 'task' and run_id = '00000000-0000-0000-0000-0000000000a1'),
  4, 'one created event per task'
);

-- explicit values and a gate
select lives_ok($$
  select public.create_task_graph('00000000-0000-0000-0000-0000000000a1', $j$[
    {"key":"g","type":"gate","title":"Approve plan","priority":5,"max_attempts":1,"payload":{"x":1},
     "gate":{"kind":"plan","title":"Approve the plan","priority":2,"context":{"why":"because"},"options":[{"id":"ok","label":"OK","kind":"approve"}]}}
  ]$j$)
$$, 'a gate task is accepted');
select is(
  (select row(g.kind, g.priority, g.title, g.context, g.options)::text from public.gates g join public.tasks t on t.id = g.task_id where t.title = 'Approve plan'),
  row('plan', 2, 'Approve the plan', '{"why": "because"}'::jsonb, '[{"id": "ok", "kind": "approve", "label": "OK"}]'::jsonb)::text,
  'gate row created with kind, priority, title, context and options'
);
select is(
  (select row(priority, max_attempts, payload)::text from public.tasks where title = 'Approve plan'),
  row(5, 1, '{"x": 1}'::jsonb)::text, 'explicit priority, max_attempts and payload kept'
);
select is((select type::text from public.tasks where title = 'Approve plan'), 'gate', 'gate task has type gate');
select is((select count(*)::int from public.events where kind = 'gate_created'), 1, 'gate_created event written');

-- validation errors (all 22023)
create function pg_temp.graph(spec text) returns text language sql as $$
  select 'select public.create_task_graph(''00000000-0000-0000-0000-0000000000a1'', ''' || replace(spec, '''', '''''') || '''::jsonb)'
$$;
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","title":"A"},{"key":"a","type":"system","title":"A2"}]'), '22023', 'duplicate task key: a', 'duplicate key');
select throws_ok(pg_temp.graph('[{"key":"Bad Key","type":"system","title":"A"}]'), '22023', 'invalid task key: Bad Key', 'invalid key');
select throws_ok(pg_temp.graph('[{"type":"system","title":"A"}]'), '22023', 'invalid task key: <null>', 'missing key');
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","title":"A","depends_on":["zz"]}]'), '22023', 'unknown dependency: a -> zz', 'unknown dependency');
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","title":"A","depends_on":["b"]},{"key":"b","type":"system","title":"B","depends_on":["a"]}]'), '22023', 'dependency cycle: a -> b -> a', 'two-node cycle');
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","title":"A","depends_on":["a"]}]'), '22023', 'dependency cycle: a -> a', 'self cycle');
select throws_ok(pg_temp.graph('[{"key":"x","type":"system","title":"X"},{"key":"a","type":"system","title":"A","depends_on":["c"]},{"key":"b","type":"system","title":"B","depends_on":["a"]},{"key":"c","type":"system","title":"C","depends_on":["b"]}]'), '22023', 'dependency cycle: a -> c -> b -> a', 'three-node cycle next to a valid node');
select throws_ok(pg_temp.graph('[{"key":"a","type":"agent","title":"A"}]'), '22023', 'agent task needs a role: a', 'agent without role');
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","role":"builder","title":"A"}]'), '22023', 'role not allowed on system task: a', 'role on a system task');
select throws_ok(pg_temp.graph('[{"key":"a","type":"gate","title":"A"}]'), '22023', 'gate task needs a gate spec: a', 'gate without spec');
select throws_ok(pg_temp.graph('[{"key":"a","type":"system","title":"A","gate":{"kind":"spec","title":"x"}}]'), '22023', 'gate spec on a non-gate task: a', 'gate spec on a non-gate task');
select throws_ok(pg_temp.graph('[{"key":"a","type":"gate","title":"A","gate":{"kind":"nonsense","title":"x"}}]'), '22023', 'invalid gate kind: nonsense (a)', 'invalid gate kind');
select throws_ok(pg_temp.graph('[{"key":"a","type":"weird","title":"A"}]'), '22023', 'invalid task type: weird (a)', 'invalid task type');
select throws_ok(pg_temp.graph('{"not":"an array"}'), '22023', 'tasks must be a json array', 'non-array spec');
select throws_ok(
  format('select public.create_task_graph(%L, (select jsonb_agg(jsonb_build_object(''key'', ''k'' || i, ''type'', ''system'', ''title'', ''t'')) from generate_series(1, 501) i))', '00000000-0000-0000-0000-0000000000a1'),
  '22023', 'too many tasks (max 500)', '501 tasks rejected'
);
select lives_ok(
  format('select public.create_task_graph(%L, (select jsonb_agg(jsonb_build_object(''key'', ''m'' || i, ''type'', ''system'', ''title'', ''t'')) from generate_series(1, 500) i))', '00000000-0000-0000-0000-0000000000a1'),
  '500 tasks accepted'
);
select throws_ok(
  $$select public.create_task_graph('00000000-0000-0000-0000-0000000000a2', '[{"key":"a","type":"system","title":"A"}]')$$,
  '22023', 'run is not open', 'closed run rejected'
);
select throws_ok(
  $$select public.create_task_graph('00000000-0000-0000-0000-0000000000ff', '[]')$$,
  '22023', 'unknown run: 00000000-0000-0000-0000-0000000000ff', 'unknown run rejected'
);
select is(
  (select count(*)::int from public.tasks where run_id = '00000000-0000-0000-0000-0000000000a1' and title = 'A2'), 0,
  'a rejected graph inserts nothing'
);

-- create_run
select is(
  (select jsonb_typeof(public.create_run('factory', 'fresh run', '{"k":1}', '[{"key":"a","type":"system","title":"A"}]') -> 'tasks' -> 'a')),
  'string', 'create_run returns the task ids by key'
);
select is((select config from public.runs where title = 'fresh run'), '{"k": 1}'::jsonb, 'create_run stores config');
select is((select status::text from public.runs where title = 'fresh run'), 'pending', 'create_run starts pending');
select is((select count(*)::int from public.tasks t join public.runs r on r.id = t.run_id where r.title = 'fresh run'), 1, 'create_run creates its tasks');
select throws_ok(
  $$select public.create_run('factory', 'broken run', '{}', '[{"key":"a","type":"agent","title":"A"}]')$$,
  '22023', 'agent task needs a role: a', 'create_run validates the graph'
);
select is((select count(*)::int from public.runs where title = 'broken run'), 0, 'create_run is atomic: no run left behind');
select throws_ok(
  $$select public.create_run('nope', 'x', '{}', '[]')$$,
  '22023', 'unknown module: nope', 'unknown module'
);
select lives_ok($$select public.create_run('factory', 'empty run')$$, 'a run without tasks is allowed');

-- privileges: service_role only
select ok(has_function_privilege('service_role', 'public.create_task_graph(uuid, jsonb)', 'execute'), 'service_role can create_task_graph');
select ok(has_function_privilege('service_role', 'public.create_run(text, text, jsonb, jsonb)', 'execute'), 'service_role can create_run');
select ok(not has_function_privilege('anon', 'public.create_task_graph(uuid, jsonb)', 'execute'), 'anon cannot create_task_graph');
select ok(not has_function_privilege('authenticated', 'public.create_task_graph(uuid, jsonb)', 'execute'), 'authenticated cannot create_task_graph');
select ok(not has_function_privilege('anon', 'public.create_run(text, text, jsonb, jsonb)', 'execute'), 'anon cannot create_run');
select ok(not has_function_privilege('authenticated', 'public.create_run(text, text, jsonb, jsonb)', 'execute'), 'authenticated cannot create_run');
select ok(not has_function_privilege('public', 'public.create_run(text, text, jsonb, jsonb)', 'execute'), 'PUBLIC cannot create_run');

select * from finish();
rollback;
