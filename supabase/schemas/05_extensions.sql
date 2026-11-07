-- supabase_vault ships enabled on both the local stack and hosted. pg_net ships enabled locally but NOT on hosted (found
-- by the T3.11 live check: every notification flush failed with "schema net does not exist"), so it is declared here.
-- pg_cron is enabled here (milestone 3, ADR-14).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
