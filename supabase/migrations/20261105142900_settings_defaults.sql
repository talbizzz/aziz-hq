-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md): default platform settings are DML, which the diff tool
-- does not track. Idempotent; never overwrites a value the owner changed.
insert into public.settings (key, value) values
  ('timezone', '"Europe/Berlin"'),
  ('quiet_hours', '{"start": "22:00", "end": "07:00"}'),
  ('digest_time', '"08:00"'),
  ('worker_offline_after_seconds', '180')
on conflict (key) do nothing;
