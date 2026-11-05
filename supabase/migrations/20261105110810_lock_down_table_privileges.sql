-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md). Supabase's default privileges grant TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on every new public table to anon and authenticated, and the diff tool emits no REVOKEs.
-- Existing tables:
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
-- Future tables: no implicit privileges; every table must carry explicit grants (see 15_grants.sql).
alter default privileges in schema public revoke all on tables from anon, authenticated;
