# Spike Findings (Milestone 0)

Versions: `claude` 2.1.312 (more added per spike).

| Spike | Question | Verdict |
|---|---|---|
| S1 | Headless `claude -p` usage visibility | CONFIRMED WITH CHANGES |
| S5 | Behaviour at plan limit | CONFIRMED WITH CHANGES (doc-based, live limit-hit not run) |
| S2 | Per-task Docker sandbox + `supabase start` | CONFIRMED WITH CHANGES |
| S3 | OpenNext on Workers + Supabase MFA + Access | _pending_ |
| S4 | Telegram buttons → secure webhook | _pending_ |

## S1: Does headless `claude -p` expose usage / rate limits?
- **Verdict:** CONFIRMED WITH CHANGES (the signal exists, but in a different place than assumed)
- **Evidence:** [version](evidence/S1-version.txt), [json output](evidence/S1-a-json.json), [stream output](evidence/S1-a-stream.jsonl), [headless statusLine dump (empty)](evidence/S1-b-statusline-headless.jsonl), [usage vs /usage](evidence/S1-d-usage-compare.md), [calibration](evidence/S1-d-calibration.jsonl), [isolated auth](evidence/S1-e-isolated-auth-status.txt), [isolated headless](evidence/S1-e-isolated-headless.txt)
- **What we learned:**
  - `--output-format json` returns token counts (`usage`, `modelUsage`) and `total_cost_usd`, but **no** rate-limit fields.
  - `--output-format stream-json --verbose` emits a `rate_limit_event` per call: `rate_limit_info.unifiedWindows.{five_hour,seven_day}` each with `utilization` (fraction, 0.02 = 2%), `resetsAt` (unix seconds) and `status` (`allowed`, ...). It also has `overageStatus`/`isUsingOverage`.
  - Matches interactive `/usage`: reset times identical; percentages equal within ±1pp (weekly 0.09 vs 10%).
  - The event reflects state **before** the call; the effect of a call shows in the next call's event.
  - Resolution is 1%. Six calls (~$0.45 list cost) moved 5h from 0.02 to 0.04, so per-call token calibration is too coarse to be useful; the real percentage is available directly.
  - A `statusLine` command is **never** invoked in headless mode (dump file stayed empty), so `rate_limits` via statusLine is not an option headless.
  - `CLAUDE_CONFIG_DIR=<dir>` isolation works after a separate `claude auth login`: `auth status` is logged in, headless calls succeed, sessions are written under `<dir>/projects`, the default config is unaffected. **Quota is per account, not per config dir**: the isolated call showed the same shared 5h/weekly utilization.
  - Each `claude -p` call carries ~38k tokens of baseline context (cache create + read), costing ~$0.06 list even for "Reply with OK".
- **Decision for the plan:** Usage policy (M4) uses the `rate_limit_event` from `stream-json` as the primary source; the worker runs `claude -p --output-format stream-json --verbose`. Fallback if the event is missing: cost-based estimate (`total_cost_usd`) plus limit-error detection (S5). Use `CLAUDE_CONFIG_DIR` to give the worker its own login/session state; it does not give it separate quota. Project-Plan pre-mortem #2 and the M4 stub should say this (applied in T0.7).
- **Open follow-ups:** The event schema is undocumented and may change between versions: pin/record the `claude` version and treat a missing event as a warning (M4). Check whether the event is emitted when the 5h window is near full or blocked (S5, T0.3).

## S5: What does `claude -p` do when a plan limit is hit mid-task?
- **Verdict:** CONFIRMED WITH CHANGES (detection design confirmed against documentation only; the live limit-hit test was declined by Aziz on 2026-11-02 and is **unverified**)
- **Evidence:** [documented fixtures](evidence/) `S5-fixture-*.txt` (all marked DOCUMENTED, none captured live, except `S5-fixture-ok-stream.txt` which has the real S1 event shape); classifier and tests in `spikes/s5/` (10 tests passing).
- **What we learned:**
  - Official docs (code.claude.com headless + errors): exit 0 on success, non-zero on failure, but failures *inside* a run (e.g. missing auth) are printed as the `result` on stdout. A community bug report (claudeissues.com #79500) says rate-limit errors can come back as `subtype:"success"`, `is_error:true`, **exit 0**. So the exit code alone must not be trusted.
  - Documented messages: `You've hit your session limit` / `weekly limit` / `Opus limit` / `Sonnet limit`; `Request rejected (429)`; `Server is temporarily limiting requests`. Auth: `Not logged in · Please run /login`, `Login expired`, `OAuth token revoked/has expired`, account on hold.
  - Streaming exposes `system/api_retry` events (`error` category incl. `rate_limit`, `authentication_failed`, `billing_error`; `error_status`). Temporary 429s are retried internally (up to 10); spend-limit 429s are not.
  - `rate_limit_event.rate_limit_info` has `status` (`allowed` observed in S1) and per-window `status` and `resetsAt`: the reset-time source. The value used for a *blocked* window is assumed (`rejected`); the classifier treats any status other than `allowed` as a limit.
  - SIGTERM exits 143 and records no result for the in-flight turn; started Bash commands are killed. Files already written stay on disk, so a worktree can be left dirty: the runner must assume this.
  - Classifier `classifyClaudeFailure(exitCode, stdout, stderr) -> 'limit' | 'auth' | 'other'` uses: any non-allowed `rate_limit_event` window, else (non-zero exit OR `is_error:true`) AND text matching the pattern lists. Unknown failures return `other`.
- **Decision for the plan:** M4's runner uses `stream-json`, classifies with this function (pattern lists configurable), and on `limit` pauses until `resetsAt` (from the event) or, if absent, 30 min; on repeated unknown failures (N tries) treat as "possible limit" and pause 30 min rather than fail the task. Before pausing/retrying, the runner resets or discards the task worktree to the last commit. **Before M8**, run one live limit-hit capture (Aziz's go-ahead, sleeping hours) and replace the DOCUMENTED fixtures with real ones.
- **Open follow-ups:** Live capture of the real blocked-state event/exit code/message and of the call during and after the blocked period (owner: M4 detailing or M8 start). Mid-task kill behaviour with a real limit.

## S2: Can a per-task Docker sandbox run `supabase start`, tests and `git push`?
- **Verdict:** CONFIRMED WITH CHANGES (macOS/Colima leg only; Linux/VPS leg re-run at M8 start)
- **Evidence:** [measurements](evidence/S2-measurements.md), [check.sh result (A, 3 parallel)](evidence/S2-check-A.txt), [topology B run](evidence/S2-topology-B.txt), [allowlist proxy](evidence/S2-allowlist-proxy.txt); code in `spikes/s2/` (`Dockerfile`, `sandbox.sh`, `sandbox-b.sh`, `check.sh`, `proxy/`).
- **What we learned:**
  - Both topologies work. A (sibling containers via `docker.sock`): cold 14m44s, warm **20 s**, ~750 MiB RAM per slim stack, 3 parallel stacks ~2.0 GiB, shared 5.7 GB image cache. B (DinD): cold 8m08s *every time* (no shared cache), 1.3 GiB per sandbox, 4.6 GB disk per sandbox.
  - Slim stack (`-x studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor`) is enough for `db reset`, `supabase test db` (pgTAP) and auth/rest/realtime/storage. `check.sh` passes 12/12 for 3 parallel A sandboxes; each runs status, pgTAP and `git push` (to a local bare remote; push to GitHub with real credentials is untested).
  - **Security:** A as written puts `docker.sock` inside the agent's container = root on the daemon, defeating the sandbox. B needs `--privileged`. Neither is acceptable for untrusted agent code as-is.
  - **Variant A-prime works:** the *worker* starts the stack (it holds the socket); the agent container has no socket, joins `supabase_network_<project_id>`, and reaches Postgres (`supabase_db_<id>:5432`) and Kong (`:8000`). `docker update --memory/--cpus` caps the Supabase containers (limits on the agent container alone do not cover siblings).
  - Port scheme: `project_id = s2slot<N>`, every `543xx` port + 100*N. Collision failure: `Bind for 0.0.0.0:54322 failed: port is already allocated`. `inspector_port` (8083) must also be shifted if edge-runtime is enabled.
  - Worktree is mounted at the identical absolute path on host, VM and container.
  - Teardown (`supabase stop --no-backup`, `docker rm`) leaves nothing for A. For B, `docker rm -v` is required or anonymous volumes leak.
  - Allowlist: `--internal` Docker network + tinyproxy sidecar with domain allowlist works (github/npm/anthropic reachable, others blocked, direct egress fails). It governs only the agent container; the Supabase stack pulls images through the host daemon, so registry access is the host's concern.
  - Environment gotcha: the Colima default VM here is 2 CPU / 2 GiB, too small; S2 used a separate profile `s2` (4 CPU / 5 GiB), stopped but kept (images cached). `colima start` switches the docker context.
- **Decision for the plan:** M4 uses **A-prime**: worker-managed slim Supabase stack per task (ports base + 100*slot, unique `project_id`), agent container without `docker.sock`, on the stack network, with the egress proxy; worker applies `docker update` limits to the stack and tears it down (`supabase stop --no-backup`, `docker rm -v`, network removal). Pre-pull images on the worker host. Budget for netcup (4 vCore / 8 GB): about 0.75 GiB idle per stack plus the agent, so **2 parallel tasks, 3 at most**, leaving room for the worker and OS (peak RAM during `db reset` / test load was not measured). Add this to the M4 stub, and a repeat of `spikes/s2/check.sh` on the VPS at the start of M8.
- **Fallback (pre-mortem #7):** not needed. If A-prime fails on Linux, use B with a pre-baked dind image or a registry pull-through cache.
- **Open follow-ups:** (1) Peak RAM under load and minimum `--memory/--cpus` that still pass (M4). (2) A-prime agent-container egress when it must also reach the Supabase network and the proxy (M4). (3) Real `git push` to GitHub with a deploy credential (M4). (4) Linux verification (M8). (5) Supabase CLI version skew: host 2.109.1 vs sandbox npm `supabase` 3.0.0; pin a version in the worker image (M4).
