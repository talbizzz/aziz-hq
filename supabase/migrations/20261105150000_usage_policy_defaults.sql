-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md): the default usage policy (Project-Raw "Usage policy") is DML,
-- which the diff tool does not track. Idempotent; never overwrites a value the owner changed.
insert into public.settings (key, value) values
  ('usage_policy', '{"sleeping_hours": {"start": "00:00", "end": "08:00"}, "cap_work_pct": 50, "cap_sleeping_pct": 100, "weekly_margin_pct": 10, "weekly_ceiling_pct": 90}')
on conflict (key) do nothing;
