begin;
select plan(11);
\ir support/helpers.inc

select pg_temp.create_user('00000000-0000-0000-0000-0000000000a0'); -- owner
select pg_temp.create_user('00000000-0000-0000-0000-0000000000a1'); -- someone else
delete from public.app_owner;
insert into public.app_owner (user_id) values ('00000000-0000-0000-0000-0000000000a0');

-- ===== the bucket =====
select is((select public from storage.buckets where id = 'transcripts'), false, 'the transcripts bucket exists and is private');
select ok((select file_size_limit between 1 and 52428800 from storage.buckets where id = 'transcripts'), 'the bucket has a size limit');

-- a transcript as the worker (service_role) stores it
select pg_temp.act_as_service();
insert into storage.objects (bucket_id, name, owner_id) values ('transcripts', 'run-1/task-1/attempt-1.txt', null);
select is((select count(*)::int from storage.objects where bucket_id = 'transcripts'), 1, 'service_role writes a transcript object');
reset role;

-- ===== who can read =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select is((select count(*)::int from storage.objects where bucket_id = 'transcripts'), 1, 'the owner at aal2 reads transcripts');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal1');
select is((select count(*)::int from storage.objects where bucket_id = 'transcripts'), 0, 'the owner at aal1 reads nothing');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is((select count(*)::int from storage.objects where bucket_id = 'transcripts'), 0, 'a non-owner reads nothing');
reset role;
select pg_temp.act_as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'transcripts'), 0, 'anon reads nothing');
reset role;

-- ===== nobody but service_role writes =====
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a0', 'aal2');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('transcripts', 'run-1/task-1/forged.txt')$$, '42501', null, 'the owner cannot upload (row-level security)');
do $$ begin
  begin update storage.objects set name = 'x' where bucket_id = 'transcripts'; exception when insufficient_privilege then null; end;
  begin delete from storage.objects where bucket_id = 'transcripts'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select is((select name from storage.objects where bucket_id = 'transcripts'), 'run-1/task-1/attempt-1.txt', 'the owner can neither rename nor delete a transcript');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('transcripts', 'run-1/task-1/forged.txt')$$, '42501', null, 'a non-owner cannot upload');
reset role;
select pg_temp.act_as_anon();
select throws_ok($$insert into storage.objects (bucket_id, name) values ('transcripts', 'run-1/task-1/forged.txt')$$, '42501', null, 'anon cannot upload');
reset role;

select * from finish();
rollback;
