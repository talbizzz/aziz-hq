-- Milestone 4, T4.8: private bucket for redacted agent transcripts. Storage objects are not tracked by the diff tool
-- (listed in docs/MANUAL_MIGRATIONS.md). Layout: <run_id>/<task_id>/attempt-<n>.txt.
-- The worker writes with service_role (bypasses RLS); the only policy lets the owner at aal2 read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcripts', 'transcripts', false, 10485760, array['text/plain'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists transcripts_owner_read on storage.objects;
create policy transcripts_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'transcripts' and public.is_owner());
