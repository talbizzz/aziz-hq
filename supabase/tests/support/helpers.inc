-- Included with \ir from the test files. Everything is created in pg_temp so nothing persists in the database.
create function pg_temp.create_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, aud, role, email) values (uid, 'authenticated', 'authenticated', uid || '@test.local');
$$;

-- Switches to the authenticated role with a JWT carrying sub and aal. Call while still superuser; undo with `reset role`.
create function pg_temp.act_as(uid uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  set local role authenticated;
end $$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $$;
