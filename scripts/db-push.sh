#!/usr/bin/env bash
# Push migrations to the hosted project. The target is always explicit (never a linked project).
# Dry run unless CONFIRM=1.
set -euo pipefail

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROJECT_REF is not set; refusing to run (the target project must be explicit)." >&2
  exit 1
fi

if [ "${CONFIRM:-}" = "1" ]; then
  exec supabase db push --project-ref "$SUPABASE_PROJECT_REF"
fi

echo "Dry run for project $SUPABASE_PROJECT_REF (set CONFIRM=1 to apply)." >&2
exec supabase db push --project-ref "$SUPABASE_PROJECT_REF" --dry-run
