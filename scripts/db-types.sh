#!/usr/bin/env bash
# Regenerate the DB types from the local database. Writes atomically so a failure never leaves a broken file.
set -euo pipefail
out="packages/core/src/db/types.ts"
mkdir -p "$(dirname "$out")"
tmp="$(mktemp)"
supabase gen types typescript --local > "$tmp"
mv "$tmp" "$out"
