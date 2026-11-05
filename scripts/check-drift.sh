#!/usr/bin/env bash
# Fails (and prints the diff) when supabase/schemas/ and the applied migrations disagree.
# Run against a local database that has just been reset (migrations applied).
set -uo pipefail

out="$(supabase db diff 2>&1)"
status=$?
if [ $status -ne 0 ]; then
  echo "$out" >&2
  echo "check-drift: 'supabase db diff' failed" >&2
  exit 2
fi

if echo "$out" | grep -q "No schema changes found"; then
  echo "check-drift: OK (schemas match migrations)"
  exit 0
fi

echo "$out" >&2
echo "check-drift: schemas differ from migrations. Generate a migration with 'pnpm db:diff <name>' (or mirror a manual migration in supabase/schemas/)." >&2
exit 1
