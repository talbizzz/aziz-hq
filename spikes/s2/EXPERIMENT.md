# S2 — Per-task Docker sandbox running `supabase start`

Written before running. Time-box: one session. macOS leg only (Linux/VPS leg repeated at M8 start).

## Environment
Dedicated Colima profile `s2` (4 CPU / 5 GiB / 40 GiB disk), selected only via `DOCKER_HOST=unix://$HOME/.colima/s2/docker.sock`. The user's default Colima profile (GigAway) is never touched.

## Topologies
- **A, sibling containers:** sandbox mounts the VM's `/var/run/docker.sock`; `supabase start` creates Supabase containers on the same daemon.
- **B, Docker-in-Docker:** `docker:dind` (privileged) per sandbox; sandbox uses `DOCKER_HOST=tcp://...`.

## Measurements per topology
success?; cold start (empty image cache) and warm start; peak RAM (`docker stats`); disk; teardown completeness (`supabase stop --no-backup`, `docker rm`, then `docker ps -a` / `docker volume ls` must show nothing from the sandbox).

## Other questions
1. Concurrency: 3 parallel sandboxes, distinct `project_id`, ports = base + 100*slot. Failure mode on collision.
2. Worktree path: bind mounts resolved by the daemon -> mount at identical absolute path.
3. `supabase db reset`, `supabase test db` (trivial pgTAP), `git push` (to a local bare remote) inside the sandbox.
4. Do `--cpus/--memory/--pids-limit` on the sandbox also bound the Supabase containers? (A: expected NO.)
5. Network allowlist: internal Docker network + allowlisting proxy sidecar; what works.

## Decision rule
Pick the topology that passes `check.sh` with the lowest RAM/start cost; if neither works, fall back to pre-mortem #7 (shared local Supabase per project on the worker host).
