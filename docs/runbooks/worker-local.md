# Runbook: the worker in local Docker

The worker runs next to the local Supabase stack and joins its Docker network (`supabase_network_aziz-hq`), so it needs no published ports.

## Prerequisites

- A right-sized Docker VM with the Colima profile you use for Supabase (the default 2 GiB profile cannot run Supabase; see Project-Plan risk 9) and more than 10 GiB free disk.
- Local Supabase running: `pnpm db:start`.
- `docker compose` or the standalone `docker-compose` (Homebrew). The commands below use `docker-compose`.

## Start

```
bash scripts/local-worker-env.sh                      # writes .env.worker (gitignored) from the local stack
docker-compose -f docker-compose.worker.yml up -d --build
docker-compose -f docker-compose.worker.yml logs -f   # JSON lines: worker starting, task finished, ...
```

Check it is alive: `select worker_id, last_seen_at from worker_heartbeats;` (refreshes every minute) or the worker dot in the dashboard run view.

## Try it

`pnpm fake-run` creates the scripted run (add `--crash` for a task whose worker you can kill with `docker kill aziz-hq-worker-1`). The gate waits for a decision: from M3 use the dashboard inbox; until then call `decide_gate` as `service_role`.

## Stop

`docker-compose -f docker-compose.worker.yml down`. A stopped worker leaves its leased tasks `running` until the lease expires; the next worker that starts reaps them.

## Notes

- `restart: always` brings the worker back after a Docker restart or crash. SIGTERM stops claiming, waits `SHUTDOWN_GRACE_MS`, then releases running tasks for retry.
- For the real VPS (M8) the same image runs with `SUPABASE_URL` pointing at the hosted project and the secret from Infisical (M8), not from `.env.worker`.
