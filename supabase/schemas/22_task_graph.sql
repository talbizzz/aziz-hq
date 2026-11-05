-- Milestone 2, contracts C2 and C3 (creation): validated, atomic task graph creation. service_role only.

create function public.create_task_graph(p_run_id uuid, p_tasks jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status public.run_status;
  v_keys text[] := '{}';
  v_specs jsonb := '{}';
  v_spec jsonb;
  v_key text;
  v_type text;
  v_dep text;
  v_order text[] := '{}';
  v_remaining text[];
  v_next text[];
  v_path text[];
  v_cur text;
  v_ids jsonb := '{}';
  v_dep_ids uuid[];
  v_task_id uuid;
  v_gate jsonb;
begin
  select status into v_status from public.runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown run: %', p_run_id using errcode = 'invalid_parameter_value';
  end if;
  if v_status not in ('pending', 'running', 'paused') then
    raise exception 'run is not open' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_tasks) is distinct from 'array' then
    raise exception 'tasks must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_tasks) > 500 then
    raise exception 'too many tasks (max 500)' using errcode = 'invalid_parameter_value';
  end if;

  -- per-task validation
  for v_spec in select value from jsonb_array_elements(p_tasks) loop
    v_key := v_spec ->> 'key';
    if v_key is null or v_key !~ '^[a-z0-9_-]{1,64}$' then
      raise exception 'invalid task key: %', coalesce(v_key, '<null>') using errcode = 'invalid_parameter_value';
    end if;
    if v_key = any (v_keys) then
      raise exception 'duplicate task key: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    v_type := v_spec ->> 'type';
    if v_type is null or v_type not in ('agent', 'gate', 'system') then
      raise exception 'invalid task type: % (%)', coalesce(v_type, '<null>'), v_key using errcode = 'invalid_parameter_value';
    end if;
    if coalesce(v_spec ->> 'title', '') = '' then
      raise exception 'task needs a title: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    if v_type = 'agent' and coalesce(v_spec ->> 'role', '') = '' then
      raise exception 'agent task needs a role: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    if v_type <> 'agent' and v_spec ? 'role' and v_spec ->> 'role' is not null then
      raise exception 'role not allowed on % task: %', v_type, v_key using errcode = 'invalid_parameter_value';
    end if;
    if v_type = 'gate' and jsonb_typeof(v_spec -> 'gate') is distinct from 'object' then
      raise exception 'gate task needs a gate spec: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    if v_type <> 'gate' and v_spec ? 'gate' and jsonb_typeof(v_spec -> 'gate') <> 'null' then
      raise exception 'gate spec on a non-gate task: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    if v_type = 'gate' and coalesce(v_spec -> 'gate' ->> 'kind', '') not in
      ('spec', 'plan', 'milestone_review', 'release', 'checklist', 'budget', 'usage_extension', 'secret_request', 'escalation', 'other') then
      raise exception 'invalid gate kind: % (%)', coalesce(v_spec -> 'gate' ->> 'kind', '<null>'), v_key using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(coalesce(v_spec -> 'depends_on', '[]')) <> 'array' then
      raise exception 'depends_on must be an array: %', v_key using errcode = 'invalid_parameter_value';
    end if;
    v_keys := v_keys || v_key;
    v_specs := v_specs || jsonb_build_object(v_key, v_spec);
  end loop;

  -- dependencies refer to keys in this call
  foreach v_key in array v_keys loop
    for v_dep in select jsonb_array_elements_text(coalesce(v_specs -> v_key -> 'depends_on', '[]')) loop
      if v_dep <> all (v_keys) then
        raise exception 'unknown dependency: % -> %', v_key, v_dep using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end loop;

  -- topological order (Kahn); what is left over contains a cycle
  v_remaining := v_keys;
  loop
    v_next := '{}';
    foreach v_key in array v_remaining loop
      if not exists (
        select 1 from jsonb_array_elements_text(coalesce(v_specs -> v_key -> 'depends_on', '[]')) d where d <> all (v_order)
      ) then
        v_next := v_next || v_key;
      end if;
    end loop;
    exit when coalesce(array_length(v_next, 1), 0) = 0;
    v_order := v_order || v_next;
    v_remaining := array(select k from unnest(v_remaining) with ordinality as u(k, n) where k <> all (v_next) order by n);
  end loop;

  if coalesce(array_length(v_remaining, 1), 0) > 0 then
    v_cur := v_remaining[1];
    v_path := array[v_cur];
    loop
      select d into v_dep
      from jsonb_array_elements_text(coalesce(v_specs -> v_cur -> 'depends_on', '[]')) with ordinality as e(d, n)
      where d = any (v_remaining)
      order by n limit 1;
      if v_dep = any (v_path) then
        v_path := v_path[array_position(v_path, v_dep):] || v_dep;
        raise exception 'dependency cycle: %', array_to_string(v_path, ' -> ') using errcode = 'invalid_parameter_value';
      end if;
      v_path := v_path || v_dep;
      v_cur := v_dep;
    end loop;
  end if;

  -- insert in topological order so depends_on holds real ids
  foreach v_key in array v_order loop
    v_spec := v_specs -> v_key;
    select coalesce(array_agg((v_ids ->> d)::uuid order by n), '{}')
      into v_dep_ids
      from jsonb_array_elements_text(coalesce(v_spec -> 'depends_on', '[]')) with ordinality as e(d, n);

    insert into public.tasks (run_id, type, role, title, depends_on, priority, max_attempts, payload)
    values (
      p_run_id,
      (v_spec ->> 'type')::public.task_type,
      v_spec ->> 'role',
      v_spec ->> 'title',
      v_dep_ids,
      coalesce((v_spec ->> 'priority')::int, 0),
      coalesce((v_spec ->> 'max_attempts')::int, 3),
      coalesce(v_spec -> 'payload', '{}')
    )
    returning id into v_task_id;

    if v_spec ->> 'type' = 'gate' then
      v_gate := v_spec -> 'gate';
      insert into public.gates (task_id, kind, priority, title, context, options)
      values (
        v_task_id,
        v_gate ->> 'kind',
        coalesce((v_gate ->> 'priority')::smallint, 1),
        coalesce(v_gate ->> 'title', v_spec ->> 'title'),
        coalesce(v_gate -> 'context', '{}'),
        coalesce(v_gate -> 'options', '[]')
      );
    end if;

    v_ids := v_ids || jsonb_build_object(v_key, v_task_id);
  end loop;

  return v_ids;
end $$;

create function public.create_run(p_module_id text, p_title text, p_config jsonb default '{}', p_tasks jsonb default '[]') returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if not exists (select 1 from public.modules where id = p_module_id) then
    raise exception 'unknown module: %', p_module_id using errcode = 'invalid_parameter_value';
  end if;
  insert into public.runs (module_id, title, config) values (p_module_id, p_title, coalesce(p_config, '{}')) returning id into v_run_id;
  return jsonb_build_object('run_id', v_run_id, 'tasks', public.create_task_graph(v_run_id, p_tasks));
end $$;

revoke all on function public.create_task_graph(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_run(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_task_graph(uuid, jsonb) to service_role;
grant execute on function public.create_run(text, text, jsonb, jsonb) to service_role;
