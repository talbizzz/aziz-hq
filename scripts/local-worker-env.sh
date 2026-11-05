#!/usr/bin/env bash
# Writes .env.worker for the local Supabase stack (local development keys only; the file is gitignored).
set -euo pipefail
key="$(supabase status -o env 2>/dev/null | sed -n 's/^SECRET_KEY=//p' | tr -d '"')"
[ -n "$key" ] || { echo "local Supabase is not running (pnpm db:start)" >&2; exit 1; }
cat > .env.worker <<ENV
SUPABASE_URL=http://supabase_kong_aziz-hq:8000
SUPABASE_SECRET_KEY=$key
WORKER_ID=local-worker
WORKER_CONCURRENCY=2
LEASE_SECONDS=120
ENV
echo "Wrote .env.worker"
