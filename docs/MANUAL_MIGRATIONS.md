# Manual migrations

Declarative schemas in `supabase/schemas/` are the source of truth, but the diff tool does not track DML, publication membership, or grants on some objects. Every hand-written migration in `supabase/migrations/` must be listed here, or the drift check fails.

| Migration | Reason |
| --------- | ------ |
