#!/usr/bin/env bash
# Push migrations to the hosted project. `supabase db push` has no --project-ref flag, so the target is an explicit
# connection string (the pooler, session mode: CI runners have no IPv6) that must belong to SUPABASE_PROJECT_REF.
# The project is never linked globally. Dry run unless CONFIRM=1.
set -euo pipefail

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROJECT_REF is not set; refusing to run (the target project must be explicit)." >&2
  exit 1
fi
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set (session-pooler connection string, percent-encoded); refusing to run." >&2
  exit 1
fi
case "$SUPABASE_DB_URL" in
  *"postgres.${SUPABASE_PROJECT_REF}:"*) ;;
  *)
    echo "SUPABASE_DB_URL does not belong to project $SUPABASE_PROJECT_REF; refusing to run." >&2
    exit 1
    ;;
esac

if [ "${CONFIRM:-}" = "1" ]; then
  exec supabase db push --db-url "$SUPABASE_DB_URL"
fi

echo "Dry run for project $SUPABASE_PROJECT_REF (set CONFIRM=1 to apply)." >&2
exec supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
