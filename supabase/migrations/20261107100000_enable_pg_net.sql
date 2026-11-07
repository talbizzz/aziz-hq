-- pg_net is already enabled on the local stack, so the diff tool never emits it; the hosted project did not have it
-- (T3.11 live check). Idempotent. Mirrored in supabase/schemas/05_extensions.sql.
create extension if not exists pg_net with schema extensions;
