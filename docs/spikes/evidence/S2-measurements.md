# S2 measurements (2026-11-02, Colima 0.10.3 profile s2: 4 CPU / 5 GiB / 40 GiB; Docker server 29.5.2; host supabase CLI 2.109.1, sandbox image supabase CLI 3.0.0, Node 22.23.4)

Slim stack = `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor` (db, auth, rest, realtime, storage, kong, pg_meta).

| item | topology A (sibling, docker.sock) | topology B (DinD) |
|---|---|---|
| cold start (empty image cache) | 14m44s (5.7 GB pulled) | 8m08s (4.6 GB pulled *into* the sandbox's own daemon) |
| warm start | 20 s | n/a: each dind daemon has an empty cache (cold every time) unless images are pre-baked |
| RAM idle, slim stack | db 109, auth 12, rest 18, realtime 193, storage 151, kong 94, pg_meta 163, sandbox 11 MiB = ~750 MiB | dind container 1.30 GiB (includes dockerd + page cache), sandbox 1.3 MiB |
| 3 stacks in parallel | ~2.0 GiB total; 2 extra stacks started in 80 s | not run |
| disk | 5.7 GB images shared by all sandboxes | ~4.6 GB per sandbox |
| teardown | `supabase stop --no-backup` + `docker rm` leaves no containers/volumes/networks | `docker rm` of dind removes everything inside; **anonymous volumes of the dind container leak unless `docker rm -v`** (2 leaked in the test, cleaned) |
| resource limits on sandbox | do **not** cover sibling Supabase containers (`mem=0`); covered via `docker update` by the worker | `--memory 4g` on dind covers everything |
| docker.sock in the agent's container | **yes: root-equivalent on the daemon, defeats the sandbox** | no socket, but `--privileged` dind |

Other facts:
- Port collision error: `Bind for 0.0.0.0:54322 failed: port is already allocated` (container creation fails, partial stack cleaned up).
- Scheme that worked: `project_id = s2slot<N>`, every `543xx` port +100*N (api 54321+, db 54322+, shadow 54320+, pooler 54329+, studio 54323+, inbucket 54324+, analytics 54327+). `inspector_port = 8083` is NOT in that range; collides if edge-runtime is enabled in two slots.
- Worktree must be mounted at the identical absolute path (Colima mounts $HOME into the VM at the same path; worked).
- Variant A-prime: the worker starts the stack with the socket, then the agent container has NO socket, joins `supabase_network_<project_id>`, reaches `supabase_db_<id>:5432` (psql OK) and `supabase_kong_<id>:8000` (HTTP 200). `docker update --memory --cpus` on the sibling containers works while running.
- `docker context` gotcha: `colima start <profile>` switches your current docker context; it was restored with `docker context use colima`.
- `supabase test db` pulls an extra image (pg_prove) on first use.
