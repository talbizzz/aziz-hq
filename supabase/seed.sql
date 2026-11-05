-- Local development only. Hosted gets the same row from a manual migration (docs/MANUAL_MIGRATIONS.md).
insert into public.modules (id, name) values ('factory', 'SaaS Factory') on conflict do nothing;
