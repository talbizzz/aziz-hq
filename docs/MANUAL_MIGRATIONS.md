# Manual migrations

Declarative schemas in `supabase/schemas/` are the source of truth, but the diff tool does not track DML, publication membership, or grants on some objects. Every hand-written migration in `supabase/migrations/` must be listed here, or the drift check fails.

| Migration                                       | Reason                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261105110800_realtime_publication.sql`       | Publication membership (`supabase_realtime`: runs, tasks, gates, events, worker_heartbeats) and the `factory` module row are not tracked by the diff tool (ADR-4).                                                                    |
| `20261105110810_lock_down_table_privileges.sql` | Default privileges give `anon`/`authenticated` TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new public tables, and the diff tool does not emit REVOKEs. Revokes them on existing tables and removes the default ACL for future ones. |
