-- Contract C4. Reads only for the owner (at aal2); no insert/update/delete policies except settings update.
create policy owner_select on public.app_owner for select to authenticated using (public.is_owner());
create policy owner_select on public.modules for select to authenticated using (public.is_owner());
create policy owner_select on public.runs for select to authenticated using (public.is_owner());
create policy owner_select on public.tasks for select to authenticated using (public.is_owner());
create policy owner_select on public.gates for select to authenticated using (public.is_owner());
create policy owner_select on public.events for select to authenticated using (public.is_owner());
create policy owner_select on public.usage for select to authenticated using (public.is_owner());
create policy owner_select on public.worker_heartbeats for select to authenticated using (public.is_owner());
create policy owner_select on public.settings for select to authenticated using (public.is_owner());

create policy owner_update on public.settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy owner_select on public.overrides for select to authenticated using (public.is_owner());
create policy owner_select on public.notifications for select to authenticated using (public.is_owner());
create policy owner_select on public.usage_snapshots for select to authenticated using (public.is_owner());
