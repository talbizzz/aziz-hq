-- pg_net and supabase_vault ship enabled; pg_cron is enabled here (milestone 3, ADR-14).
create extension if not exists pg_cron with schema pg_catalog;
