begin;
select plan(18);

-- The hosted platform grants every new function, table and sequence to anon and authenticated by default; the local stack does
-- not, so all earlier tests passed while hosted was wide open. Simulate the hosted defaults here, apply the lockdown migration,
-- and assert the resulting privileges exactly.
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- run the statements of the migration exactly as recorded by the CLI (the test container does not mount migrations/)
do $$
declare
  stmt text;
begin
  for stmt in select unnest(statements) from supabase_migrations.schema_migrations where version = '20261106100000' loop
    execute stmt;
  end loop;
end $$;
select isnt((select count(*)::int from supabase_migrations.schema_migrations where version = '20261106100000'), 0, 'the lockdown migration is recorded');

-- anon: nothing but health()
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')),
  array['health'], 'anon can execute only health()'
);
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  0, 'anon has no table privileges at all'
);
select is(
  (select count(*)::int from information_schema.role_usage_grants where object_schema = 'public' and grantee = 'anon'),
  0, 'anon has no sequence privileges'
);

-- authenticated: exactly the functions the dashboard calls
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['clear_override', 'health', 'is_owner', 'next_local_midnight', 'resolve_gate', 'set_mode_override', 'set_override'],
  'authenticated can execute only the dashboard functions'
);
select is(
  (select coalesce(string_agg(table_name || ':' || privs, ', ' order by table_name), '') from (
     select table_name, string_agg(privilege_type, '+' order by privilege_type) as privs
     from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' group by table_name
   ) t where privs <> 'SELECT'),
  'settings:SELECT+UPDATE', 'authenticated can only SELECT, plus UPDATE on settings'
);
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'),
  13, 'authenticated can read the nine core tables, overrides, notifications, usage_snapshots and active_overrides'
);
select is(
  (select count(*)::int from information_schema.role_usage_grants where object_schema = 'public' and grantee = 'authenticated'),
  0, 'authenticated has no sequence privileges'
);

-- service_role keeps what the worker needs and never the private helpers
select ok(has_function_privilege('service_role', 'public.claim_task(text, integer)', 'execute'), 'service_role can claim_task');
select ok(has_function_privilege('service_role', 'public.decide_gate(uuid, public.gate_decision, text, text)', 'execute'), 'service_role can decide_gate');
select ok(has_function_privilege('service_role', 'public.telegram_config()', 'execute'), 'service_role can telegram_config');
select ok(not has_function_privilege('service_role', 'public.vault_secret(text)', 'execute'), 'nobody can call vault_secret');
select ok(not has_function_privilege('service_role', 'public.http_post_json(text, jsonb, jsonb)', 'execute'), 'nobody can call http_post_json');
select ok(has_table_privilege('service_role', 'public.tasks', 'insert'), 'service_role keeps its table privileges');

-- the secrets function in particular
select ok(not has_function_privilege('anon', 'public.telegram_config()', 'execute'), 'anon cannot read the Telegram configuration');
select ok(not has_function_privilege('authenticated', 'public.telegram_config()', 'execute'), 'authenticated cannot read the Telegram configuration');
select ok(not has_function_privilege('anon', 'public.decide_gate(uuid, public.gate_decision, text, text)', 'execute'), 'anon cannot decide gates');
select ok(not has_function_privilege('authenticated', 'public.create_run(text, text, jsonb, jsonb)', 'execute'), 'authenticated cannot create runs');

select * from finish();
rollback;
