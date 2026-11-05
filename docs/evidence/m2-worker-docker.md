# M2 T2.10: the worker in local Docker (2026-11-05)

Setup: `bash scripts/local-worker-env.sh` (local keys only), `docker-compose -f docker-compose.worker.yml up -d --build`, local Supabase running (`pnpm db:start`), Colima profile `s2`. `.env.worker` had `LEASE_SECONDS=10` for the crash demo.

| Check                                                               | Result                                                                                                                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image                                                               | `aziz-hq-worker` 718 MB, runs as user `node`, joins `supabase_network_aziz-hq` (no published ports)                                                                                    |
| Heartbeat                                                           | `worker_heartbeats` row `local-worker` fresh (< 30 s) 10 s after start                                                                                                                 |
| `pnpm fake-run`                                                     | gate opened (`waiting_human`); `decide_gate` approve -> `{"first":true,"decision":"approve"}`; run `done`; `Build part B` attempts 2 (retry), every other task attempts 1, gate task 0 |
| `pnpm fake-run --crash`, then `docker kill` while the long task ran | task stays `running` while the worker is down, also after the 10 s lease window (nothing reaps without a worker)                                                                       |
| `docker-compose up -d` again                                        | the new worker's tick reaped the lease (`system/reaper lease_expired`), re-ran the task: `done`, attempts 2                                                                            |

Notes: the Docker CLI plugin symlink (`~/.docker/cli-plugins/docker-compose`) pointed at a missing Docker Desktop, so the standalone `docker-compose` (Homebrew) is used; `docker compose` works wherever the plugin exists.
