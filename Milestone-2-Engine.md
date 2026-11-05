# Milestone 2: Engine

## Goal

A scripted fake run (parallel tasks, a failing-then-retried task, a gate, a crashed worker whose lease expires) flows end to end through the scheduler and worker, and is visible live in the dashboard.

## Context

- Milestone 1 is built and CI is green on `main`; the owner-only M1 steps (hosted Supabase project, Access, domain, branch protection) are still open and **do not block M2**: everything here runs on local Supabase. Migrations reach the hosted project through `deploy.yml` once `DEPLOY_ENABLED` is set.
- Read `CLAUDE.md` first. Conventions that bind this milestone:
  - Schema changes only in `supabase/schemas/` (numeric prefixes: `00` types, `10` tables, `15` grants, `20` functions, `30` triggers, `40` policies, `50` realtime), then `pnpm db:diff <name>`; `pnpm db:reset && pnpm db:test && supabase db diff` must end with "No schema changes found". The diff tool emits no REVOKEs: every new function needs explicit `revoke ... from public, anon, authenticated` **in the schema file and in a listed manual migration** if the default ACL change from M1 (`alter default privileges ... revoke execute on functions from public`) does not already cover it (it does for functions created after `20261105110810`; still assert it in pgTAP).
  - Every new table needs explicit grants in `15_grants.sql`; pgTAP calls with four text args need a description (overload gotcha).
  - Existing M1 objects used here: tables `runs`, `tasks`, `gates`, `events`, `worker_heartbeats`, `settings`; triggers `log_status_event` (events `created`/`status_changed`), `log_gate_event`, `set_updated_at`; `public.is_owner()`; `Database` types in `packages/core/src/db/types.ts`; enums mirrored by Zod in `packages/core/src/domain/enums.ts`.
  - Service role: scripts and the worker use the new `sb_secret_...` key as the `apikey` header only (never `Authorization: Bearer`). **Verify early (T2.8) that supabase-js with an `sb_secret_` key behaves**; if it sends the key as a Bearer, use a small `fetch` wrapper that strips the Authorization header, or the legacy service-role JWT locally.
- Project-Plan decisions: ADR-2 (dashboard writes via RPC, worker via service role), ADR-3 (schema shape; **superseded in part by ADR-13**), ADR-4 (Realtime + refetch-after-subscribe), ADR-9 (TanStack Query invalidation), ADR-13 (scheduler as SQL functions).
- `apps/worker` and `packages/agents-sdk` are stubs exporting only `packageName`/`main()`.

## Scope

### In Scope

- Scheduler as SQL functions (ADR-13): task-graph creation with validation, claim (`FOR UPDATE SKIP LOCKED`), dependency resolution, leases, heartbeats, retries, expired-lease reaper, gate promotion/decision primitive, cancel cascade, run settling, worker heartbeat.
- Task state machine enforced in the database.
- `Runner` interface + `FakeRunner` (scripted per task through `payload.fake`) in `packages/agents-sdk`.
- `apps/worker`: poll loop, concurrency, lease renewal, heartbeat every minute, graceful shutdown; runs locally in Docker (`restart: always`).
- Typed engine actions in `packages/core` (thin wrappers over the RPCs).
- Dashboard: runs list and run view (live task graph, statuses, roles, event timeline, worker-online indicator) via Realtime.
- A fake-run scenario script and the full scripted-run integration test; integration tests run in CI.

### Out of Scope

- Real agents, sandboxes, usage policy, loop guards, transcripts, `usage` rows (M4). A runner `needs_human` result is recorded as a non-retryable failure with `error.kind = 'needs_human'`; mapping it to an escalation gate is M4.
- Gate inbox UI, `resolve_gate`, Telegram, overrides, digest, watchdog (M3). In M2 gates are decided with the service-role primitive `decide_gate` (tests, scenario script).
- Lane exclusion, retry backoff (`not_before`), a GIN index on `depends_on`, run cancellation UI: parked in `docs/parking-lot.md` (add the entries in T2.1).
- Orchestrator-agent invocation on failure (M4); a failed task just leaves its run `failed`.

## Contracts (build these first)

### C1 — Task state machine (database, enforced by trigger `tasks_status_transition`)

```
pending        -> running | waiting_human (gate tasks only) | cancelled
running        -> done | failed | pending (retry or lease expiry) | cancelled
waiting_human  -> done | cancelled
done | failed | cancelled   terminal (no transitions out)
```

- Any other change of `tasks.status` raises `check_violation` with message `invalid task status transition: <from> -> <to>`.
- The same trigger clears `lease_until` whenever the new status is not `running`, and clears `claimed_by` as well when the new status is `pending` (so a re-claim starts clean). `claimed_by` is kept on `done`/`failed` for audit.
- `log_status_event` change (additive): `data = {"from","to"} || coalesce(nullif(current_setting('app.event_data', true), '')::jsonb, '{}')`. RPCs set `app.event_data` (transaction-local, e.g. `{"reason":"retry","attempt":2}`) and `app.actor_type` / `app.actor_id` before updating, as the C3 contract of M1 already allows.
- `depends_on` is **immutable after insert** and validated at insert by trigger `tasks_validate_deps`: every id exists, belongs to the same run, is not the task itself. Because a task can only depend on tasks that already exist, cycles are impossible by construction. Errors: `22023` (`invalid_parameter_value`) with messages `unknown dependency <id>`, `dependency in another run <id>`, `task cannot depend on itself`, `depends_on is immutable`.

### C2 — Task graph spec (jsonb array passed to `create_task_graph` / `create_run`)

```json
[
  {
    "key": "b1", // /^[a-z0-9_-]{1,64}$/, unique within the call
    "type": "agent", // agent | gate | system
    "role": "builder", // required for type agent, forbidden otherwise
    "title": "Build the thing",
    "depends_on": ["a"], // keys in this call only (default [])
    "priority": 0, // optional int, default 0
    "max_attempts": 3, // optional, default 3
    "payload": {}, // optional jsonb
    "gate": { "kind": "spec", "title": "Approve spec", "priority": 1, "context": {}, "options": [] } // required for type gate, forbidden otherwise
  }
]
```

Validation errors (all `22023`): `duplicate task key: <k>`, `invalid task key: <k>`, `unknown dependency: <k> -> <d>`, `dependency cycle: <a> -> <b> -> <a>`, `agent task needs a role: <k>`, `role not allowed on <type> task: <k>`, `gate task needs a gate spec: <k>`, `gate spec on a non-gate task: <k>`, `invalid gate kind: <kind> (<k>)`, `invalid task type: <type> (<k>)`, `task needs a title: <k>`, `depends_on must be an array: <k>`, `tasks must be a json array`, `too many tasks (max 500)`. Tasks are inserted in topological order so `depends_on` holds real ids. A Zod mirror (`taskGraphSpecSchema` + `validateTaskGraph`) lives in `packages/core` with the same messages for client-side checks.

### C3 — Scheduler RPCs (all in `public`, **execute only for `service_role`**; anon/authenticated/PUBLIC revoked)

| Function                                                                                                                           | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_run(p_module_id text, p_title text, p_config jsonb default '{}', p_tasks jsonb default '[]') returns jsonb`                | One transaction: insert run (`pending`) + `create_task_graph`. Returns `{"run_id": uuid, "tasks": {key: uuid}}`. Unknown module → `22023 unknown module: <id>`.                                                                                                                                                                                                                                                                                                                                |
| `create_task_graph(p_run_id uuid, p_tasks jsonb) returns jsonb`                                                                    | Validates per C2, inserts tasks (and `gates` rows for gate tasks), returns `{key: uuid}`. Run must be `pending`/`running`/`paused`, else `22023 run is not open` (`unknown run: <id>` when missing).                                                                                                                                                                                                                                                                                           |
| `claim_task(p_worker_id text, p_lease_seconds int default 120) returns setof public.tasks`                                         | Returns 0 or 1 row. Candidate: `status='pending'`, `type in ('agent','system')`, run `status in ('pending','running')`, **every** id in `depends_on` has task `status='done'`. Order `priority desc, created_at, id`. `for update skip locked limit 1`. Sets `status='running'`, `lease_until=now()+lease`, `claimed_by`, `attempts+1`; moves the run `pending -> running`. Event data `{"reason":"claimed","attempt":n,"worker":id}`, actor `worker`/`worker_id`.                             |
| `heartbeat_task(p_task_id uuid, p_worker_id text, p_lease_seconds int default 120) returns boolean`                                | Extends `lease_until` iff the task is `running` and `claimed_by = p_worker_id`; false otherwise (lease lost).                                                                                                                                                                                                                                                                                                                                                                                  |
| `complete_task(p_task_id uuid, p_worker_id text, p_result jsonb default '{}') returns boolean`                                     | `running -> done`, stores `result`, iff `claimed_by = p_worker_id`; false otherwise (idempotent, never throws for a lost lease).                                                                                                                                                                                                                                                                                                                                                               |
| `fail_task(p_task_id uuid, p_worker_id text, p_error jsonb default '{}', p_retryable boolean default true) returns text`           | If not owner/not running: `'ignored'`. Else if `p_retryable and attempts < max_attempts`: `running -> pending`, `'retried'` (event reason `retry`); otherwise `running -> failed`, `result = p_error`, `'failed'`.                                                                                                                                                                                                                                                                             |
| `reap_expired_leases() returns int`                                                                                                | Every `running` task with `lease_until < now()` is treated like `fail_task(..., retryable true)` with actor `system`/`reaper`, reason `lease_expired`. Returns the count.                                                                                                                                                                                                                                                                                                                      |
| `promote_ready_gates() returns int`                                                                                                | Gate tasks `pending` whose dependencies are all `done` (run `pending`/`running`) become `waiting_human` (event reason `gate_open`).                                                                                                                                                                                                                                                                                                                                                            |
| `decide_gate(p_task_id uuid, p_decision gate_decision, p_comment text default null, p_via text default 'dashboard') returns jsonb` | Gate must exist (`22023 not a gate`) and be `waiting_human` (`22023 gate is not open`). First call: sets `decision`, `comment`, `decided_at`, `decided_via`; task `waiting_human -> done` for approve/modify/answer or `-> cancelled` for dismiss; returns `{"first": true, "decision": d}`. Later calls change nothing and return `{"first": false, "decision": <stored>}`. `modify`/`answer` need a non-blank comment (`22023 comment required`). `p_via` must be `dashboard` or `telegram`. |
| `settle_runs() returns int`                                                                                                        | For runs `pending`/`running`: all tasks `cancelled` -> run `cancelled`; all `done`/`cancelled` with at least one `done` -> run `done`; else any task `failed` and none `running` -> run `failed` (fail fast: other pending tasks are not run); sets `finished_at`. Paused runs untouched. Returns the number of runs changed.                                                                                                                                                                  |
| `cancel_blocked_tasks() returns int`                                                                                               | `pending`/`waiting_human` tasks with a dependency in `cancelled` become `cancelled` (event reason `dependency_cancelled`), repeated to a fixed point. Failed dependencies do **not** cascade (a failed run waits for M4's orchestrator).                                                                                                                                                                                                                                                       |
| `scheduler_tick() returns jsonb`                                                                                                   | Calls, in order, `reap_expired_leases`, `promote_ready_gates`, `cancel_blocked_tasks`, `settle_runs`; returns `{"reaped":n,"gates_opened":n,"cancelled":n,"runs_settled":n}`.                                                                                                                                                                                                                                                                                                                  |
| `worker_heartbeat(p_worker_id text, p_info jsonb default '{}') returns void`                                                       | Upsert into `worker_heartbeats` (`last_seen_at = now()`).                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Run-level semantics: `runs.status = 'paused'` blocks `claim_task` and `promote_ready_gates` for that run (used by M4's usage policy).

### C4 — Runner interface (`packages/agents-sdk/src`)

```ts
export interface RunnerInput {
  role: string;
  task: {
    id: string;
    runId: string;
    title: string;
    payload: Record<string, unknown>;
    attempt: number;
  };
  context: Record<string, unknown>;
  workdir: string;
  budget: { timeoutMs: number; maxCostUsd?: number };
  signal: AbortSignal; // aborted on timeout, lease loss or shutdown
}
export const runnerResultSchema = z.object({
  status: z.enum(['done', 'failed', 'needs_human']),
  summary: z.string(),
  costUsd: z.number().nonnegative(),
  events: z.array(
    z.object({ kind: z.string().min(1), data: z.record(z.string(), z.unknown()).default({}) }),
  ),
});
export type RunnerResult = z.infer<typeof runnerResultSchema>;
export interface Runner {
  readonly name: string;
  run(input: RunnerInput): Promise<RunnerResult>;
}
```

`FakeRunner` reads `task.payload.fake` (`fakePayloadSchema`): `{ outcomes?: Outcome[]; delayMs?: number }`, `Outcome = { status: 'done'|'failed'|'needs_human'; summary?: string; hang?: boolean }`. Attempt `n` uses `outcomes[n-1]`, the last entry repeats; default `[{status:'done'}]`. `hang: true` waits until `signal` aborts (then rejects with the abort reason). `costUsd` is always 0; it emits events `fake.started` and `fake.finished`.

### C5 — Worker configuration (`apps/worker`)

| Env                     | Default            | Meaning                                                        |
| ----------------------- | ------------------ | -------------------------------------------------------------- |
| `SUPABASE_URL`          | required           | API URL                                                        |
| `SUPABASE_SECRET_KEY`   | required           | `sb_secret_...` key (apikey only)                              |
| `WORKER_ID`             | `<hostname>-<pid>` | stable id used in leases and heartbeats                        |
| `WORKER_CONCURRENCY`    | `2`                | parallel tasks (the S2 design allows 2, max 3)                 |
| `POLL_INTERVAL_MS`      | `2000`             | idle poll interval                                             |
| `LEASE_SECONDS`         | `120`              | lease length; renewed every `LEASE_SECONDS/3`                  |
| `HEARTBEAT_INTERVAL_MS` | `60000`            | `worker_heartbeat` interval                                    |
| `TASK_TIMEOUT_MS`       | `2700000`          | per-task wall clock (45 min, Project-Raw loop guard)           |
| `SHUTDOWN_GRACE_MS`     | `30000`            | wait for running tasks on SIGTERM, then abort and release them |

`apps/worker/runners.config.json` (zod-validated): `{ "default": "fake", "roles": { "<role>": "<runner name>" } }`; M2 registers only `fake`.

### C6 — Dashboard contract (`apps/web`)

| Route          | Behaviour                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/runs`        | Table of runs (newest first): title, module, status badge, `done/total` tasks, updated time. Row links to the run.                                                                                  |
| `/runs/:runId` | Header (title, status, worker status dot), live task graph, task side panel (title, role, status, attempts, claimed_by, result JSON), event timeline (newest first, kind + from→to + actor + time). |
| nav            | "Runs" becomes a live link; "Inbox" and "Settings" stay disabled until M3.                                                                                                                          |

Pure helper `layoutGraph(tasks) -> { nodes: {id,x,y}[]; edges: {from,to}[]; width; height }` in `apps/web/src/lib/graph-layout.ts`: `depth = 0` without dependencies else `1 + max(depth of dependencies)`; x = `depth * 240`, y = index within the depth ordered by `created_at` then id, times `88`; node 180×56.

Test IDs: `runs-list`, `run-row`, `run-graph`, `task-node-<taskId>` (attribute `data-status`), `task-panel`, `event-timeline`, `event-item`, `worker-status` (attribute `data-online`).

Realtime hook `useRealtimeInvalidation(tables, runId)`: `supabase.realtime.setAuth(access_token)` first, subscribe to `postgres_changes` on `runs`, `tasks`, `events`, `gates`, `worker_heartbeats`, **refetch the affected queries ~1.5 s after `SUBSCRIBED`** (rows inserted between `SUBSCRIBED` and the active subscription are lost, ADR-4), then invalidate on every change.

## Tasks

### T2.1 — Dependency validation, status state machine, event data hook

> **Plan updated (implementation, 2026-11-05):** the planned check `tasks_running_has_lease` was dropped: M1's `events_test.sql` legitimately sets `status = 'running'` without a lease and existing tests must not be weakened; `claim_task` is the only path that sets a lease. The parking-lot entries were added during planning.

- **Depends on:** —
- **Area:** database
- **What:** In `supabase/schemas/`: add `tasks_validate_deps` (C1), `tasks_status_transition` and the `tasks_running_has_lease` check, and extend `log_status_event` with `app.event_data`. Generate the migration with `pnpm db:diff`. Append to `docs/parking-lot.md`: lane exclusion, retry backoff `not_before`, GIN index on `depends_on`, run cancellation.
- **Tests (write first):** `supabase/tests/task_rules_test.sql`: every allowed transition succeeds; every disallowed pair (all 9 non-allowed combinations from each terminal state, plus `pending -> done`, `pending -> failed`, `running -> waiting_human`, `waiting_human -> running`) raises `invalid task status transition`; `lease_until` cleared on leaving `running`; `claimed_by` cleared on `-> pending`, kept on `-> done`; deps: unknown id, other run, self, and update of `depends_on` all raise `22023`; a valid dependency inserts; the status event carries `app.event_data` merged (set via `set_config`) and is unchanged when unset (extend the M1 `events_test.sql` assertions rather than editing them).
- **Done when:** `pnpm db:reset && pnpm db:test` green and `supabase db diff` reports no changes.

### T2.2 — `create_task_graph` and `create_run`

- **Depends on:** T2.1
- **Area:** database
- **What:** Implement C2/C3 for the two creation functions in `supabase/schemas/20_functions.sql` (or a new `21_scheduler.sql`), including topological insertion, gate rows, and grants (`service_role` only).
- **Tests (write first):** `supabase/tests/task_graph_test.sql`: diamond graph creates the right `depends_on` ids and one `created` event per task; gate task creates its `gates` row with kind/priority/context/options; every error message in C2 (one test each, `throws_ok` with `22023` and message); `create_run` creates run + tasks atomically and rolls everything back when the graph is invalid (count of runs unchanged); unknown module; run not open; 501 tasks rejected; anon/authenticated cannot execute (`42501`).
- **Done when:** pgTAP green, drift clean.

### T2.3 — Claim, heartbeat, complete, fail

- **Depends on:** T2.2
- **Area:** database
- **What:** `claim_task`, `heartbeat_task`, `complete_task`, `fail_task` per C3, setting `app.actor_type`/`app.actor_id`/`app.event_data` so events attribute the worker.
- **Tests (write first):** `supabase/tests/scheduler_test.sql`: claims in priority then age order; skips tasks with an unfinished dependency and claims them once the dependency is `done` (requirement 5); never claims gate tasks or tasks of paused/failed/done runs; a gate dependency that is `waiting_human` blocks dependents, `done` releases them; claim increments `attempts`, sets lease and moves the run to `running`; two sequential claims return two different tasks and a third returns zero rows; `heartbeat_task` extends the lease only for the owner; `complete_task` false for a non-owner and for a task whose lease was reaped; `fail_task` retries until `attempts = max_attempts` then fails (event data has reason and attempt); non-retryable fails immediately; `ignored` for non-owner.
- **Done when:** pgTAP green, drift clean.

### T2.4 — Reaper, gates, run settling, tick, worker heartbeat

- **Depends on:** T2.3
- **Area:** database
- **What:** `reap_expired_leases`, `promote_ready_gates`, `decide_gate`, `settle_runs`, `cancel_blocked_tasks`, `scheduler_tick`, `worker_heartbeat` per C3.
- **Tests (write first):** `supabase/tests/scheduler_lifecycle_test.sql`: an expired lease returns the task to `pending` (requirement 6) with a `lease_expired` event attributed to `system/reaper`, and fails it after `max_attempts`; a non-expired lease is untouched; gate opens only when all dependencies are done; `decide_gate` approve/modify/answer -> task `done`, dismiss -> `cancelled` and dependents cancelled by the next tick; second `decide_gate` returns `first=false` and changes nothing (also with a different decision); `modify` without comment raises; non-open gate raises; `gate_decided` event written once; `settle_runs` done/failed/untouched-when-paused cases; `scheduler_tick` returns the counts and is idempotent when nothing changed; `worker_heartbeat` upserts.
- **Done when:** pgTAP green, drift clean. Requirements 5, 6, 7 are covered by T2.3 and T2.4.

### T2.5 — Core contracts and engine actions

- **Depends on:** T2.4
- **Area:** shared
- **What:** In `packages/core/src/engine/`: `taskGraphSpecSchema` and `validateTaskGraph(spec)` (same messages as C2, pure); typed wrappers over the RPCs taking a `SupabaseClient<Database>` (`createRun`, `claimTask`, `heartbeatTask`, `completeTask`, `failTask`, `schedulerTick`, `workerHeartbeat`, `decideGate`) that throw a typed `EngineError` on RPC errors. Regenerate `db/types.ts` (`pnpm db:types`). Export from the package entry.
- **Tests (write first):** `validate-task-graph.test.ts`: one case per C2 error plus valid graphs; a property-style test that generates random DAGs and random cyclic graphs and checks the validator agrees with a reference topological sort; wrapper tests with a fake client asserting RPC names and argument mapping.
- **Done when:** unit tests, typecheck and lint pass; the SQL and TS validators accept/reject the same fixtures (shared fixture file used by both pgTAP-adjacent integration test in T2.8 and this test).

### T2.6 — Runner interface and FakeRunner

- **Depends on:** T2.5
- **Area:** shared
- **What:** C4 in `packages/agents-sdk`: types, `runnerResultSchema`, `fakePayloadSchema`, `FakeRunner`, and a `RunnerRegistry` (`register(name, runner)`, `forRole(role, config)`).
- **Tests (write first):** default outcome done; outcome per attempt with last repeating; `failed` and `needs_human` outcomes; `delayMs` respected (fake timers); `hang` rejects when the signal aborts and resolves nothing otherwise; invalid `payload.fake` rejected with a clear error; `costUsd` is 0; result parses with `runnerResultSchema`; registry resolves default and per-role runners and throws for an unknown runner name.
- **Done when:** tests, typecheck, lint pass; `agents-sdk` imports only `@aziz-hq/core` (boundary lint).

### T2.7 — Worker: executor, loop, heartbeat, shutdown

- **Depends on:** T2.5, T2.6
- **Area:** functions
- **What:** `apps/worker/src`: `config.ts` (C5, zod), `executor.ts` (`executeTask`: start lease renewal timer, build `RunnerInput`, enforce `TASK_TIMEOUT_MS` via `AbortController`, map result: `done -> complete_task`, `failed -> fail_task(retryable)`, `needs_human -> fail_task(retryable false, error.kind needs_human)`, thrown error -> `fail_task(retryable)`, lease lost (heartbeat false) -> abort and drop the result; insert runner events into `events` as `runner.<kind>` with actor `agent`/role), `loop.ts` (`scheduler_tick` each iteration, fill up to `WORKER_CONCURRENCY` claims, sleep `POLL_INTERVAL_MS` when idle, `worker_heartbeat` every `HEARTBEAT_INTERVAL_MS`), `main.ts` (wire config, supabase client, SIGTERM/SIGINT graceful shutdown: stop claiming, wait `SHUTDOWN_GRACE_MS`, then abort and `fail_task(retryable)` with reason `shutdown`). Failure to reach Supabase is retried with capped exponential backoff and never crashes the loop.
- **Tests (write first):** `executor.test.ts` and `loop.test.ts` with a fake engine client and `FakeRunner` under fake timers: each result mapping; lease renewal cadence; lease lost drops the result; timeout aborts and fails; concurrency cap respected; graceful shutdown waits then releases; heartbeat cadence; backoff on RPC errors; config parsing (defaults, missing required, invalid numbers).
- **Done when:** unit tests, typecheck, lint pass.

### T2.8 — Integration harness, concurrency and crashed-worker tests

> **Plan updated (implementation, 2026-11-05):** integration files are named `*.integration.ts` (not `.integration.test.ts`) so the default `pnpm test` never picks them up; `pnpm test:integration` uses `vitest.integration.config.ts`. Verified: plain supabase-js with an `sb_secret_` key works as the service client (no Authorization-stripping wrapper needed). The integration run found a bug pgTAP could not: the worker runs as `service_role`, which lacked EXECUTE on `current_actor_type()`/`current_actor_id()` used by the event triggers; fixed with explicit grants and a pgTAP test that runs the scheduler flow as `service_role` (`supabase/tests/service_role_test.sql`). **Lesson for later milestones: every new function a trigger or RPC calls needs a grant for the role that executes it, and pgTAP must exercise the flow as that role.**

- **Depends on:** T2.4, T2.7
- **Area:** infra
- **What:** `vitest.integration.config.ts` (project `integration`, `*.integration.test.ts`, run serially against the local stack); `pnpm test:integration` script; helper `test-support/local-supabase.ts` (reads `supabase status -o json`, service client, truncates run data between tests). Default `pnpm test` excludes integration tests. Resolve the `sb_secret_` question from Context here and record the outcome in the Plan-updated note if the approach changes.
- **Tests (write first):** `apps/worker/test/claim-concurrency.integration.test.ts`: 20 pending tasks, 5 concurrent claimers x 8 loops via supabase-js: every task claimed exactly once, none twice (requirement 5 under concurrency); `crashed-worker.integration.test.ts`: spawn the real worker (`tsx apps/worker/src/main.ts`) with `LEASE_SECONDS=3` on a task whose `fake.hang` is true, `SIGKILL` it mid-task, start a second worker, assert the first lease expires, the task returns to `pending` with a `lease_expired` event and the second worker completes it (requirement 6).
- **Done when:** both integration tests pass locally and on repeat (3 consecutive runs).

### T2.9 — Fake-run scenario and the full scripted run

- **Depends on:** T2.8
- **Area:** functions
- **What:** `scripts/fake-run.ts` (`pnpm fake-run`): creates the scripted run via `create_run`: `setup` (system) -> `build-a`, `build-b` (parallel agent tasks; `build-b` has `fake.outcomes = [failed, done]`) -> `review-gate` (gate, kind `plan`) -> `ship` (agent), plus a `flaky-crash` agent task with `fake.hang` on its first attempt used by the crash scenario flag `--crash`. Prints the run id. `apps/worker/test/fake-run.integration.test.ts` runs the whole thing with real worker processes.
- **Tests (write first):** the integration test: start worker A and B, seed the scenario, wait until the gate is `waiting_human`, assert `ship` has not started (requirement 5), call `decide_gate`, wait for the run to be `done`; assert `build-b` has 2 attempts and a `retry` event, the event log has a `created` and `status_changed` event for every task and run transition (requirement 7), and every event has a plausible actor; second scenario with a crashed worker (as T2.8) also ends `done`.
- **Done when:** the scripted fake run completes end to end locally; Done Criteria 1 and 2 are demonstrated by this test.

### T2.10 — Worker in local Docker

- **Depends on:** T2.7
- **Area:** infra
- **What:** `apps/worker/Dockerfile` (multi-stage, Node from `.nvmrc`, pnpm deploy of the workspace package, non-root user), `docker-compose.worker.yml` at the repo root (`restart: always`, `env_file: .env.worker`, `extra_hosts: host.docker.internal:host-gateway` so it reaches the local Supabase API), `.env.worker.example` (names only; `.env.worker` is gitignored). Document in `docs/runbooks/worker-local.md`: which Docker/Colima profile to use (a right-sized one, see Project-Plan risk 9), how to start, read logs, and stop.
- **Tests (write first):** a script test `scripts/worker-docker.test.ts` asserting the compose file has `restart: always` and no inline secrets, and the Dockerfile runs as non-root; manual verification below.
- **Done when:** with local Supabase running, `docker compose -f docker-compose.worker.yml up -d` makes a `worker_heartbeats` row appear and refresh every minute; `pnpm fake-run` completes against the containerised worker; killing the container (`docker kill`) leaves a running task whose lease then expires and is re-claimed after `docker compose up -d`. Record the outputs in `docs/evidence/m2-worker-docker.md`.

### T2.11 — Dashboard: runs list and live run view

> **Plan updated (implementation, 2026-11-05):** the shell moved to `components/app-shell.tsx` (header, nav, the `is_owner()` check) with routes rendered through `<Outlet/>`; `/` is `pages/home.tsx` (`dashboard-empty`), a non-owner sees `not-authorised` on every route. Playwright helpers live in `e2e/helpers.ts` (`loginAsOwner` resets the user's TOTP factors through the Admin API first, because all specs share one database and the owner is a single user). **Verified:** Realtime delivers `postgres_changes` to an aal2 user JWT after `setAuth` (the e2e updates statuses, timeline and the worker dot within 5 s without a reload).

- **Depends on:** T2.5, T2.4
- **Area:** web
- **What:** C6: pages `runs.tsx` and `run-detail.tsx`, `lib/graph-layout.ts`, `lib/realtime.ts` (`useRealtimeInvalidation`), components `task-graph.tsx` (SVG), `task-panel.tsx`, `event-timeline.tsx`, `worker-status.tsx`; enable the "Runs" nav item. UI strings in English; low-variance neutral style from the existing tokens; status colours from tokens (no new palette). Confirm during manual testing that the `aal2` claim reaches the Realtime token (Project-Plan risk; write the result in the Plan-updated note if it differs).
- **Tests (write first):** Vitest `graph-layout.test.ts` (depths for a diamond, a chain, disconnected nodes, ordering stability, no overlaps); Playwright `e2e/runs.spec.ts` against local Supabase: seed a run through the service role (`create_run`), log in as the owner, `/runs` lists it, open it, every task node is present with the right `data-status`; then change task statuses through the service role (`claim_task`, `complete_task`) and assert the node statuses and a new timeline item update **within 5 s without reload**; a non-owner at aal2 sees an empty runs list.
- **Done when:** unit and e2e tests pass locally and in CI (the existing `web` job).

### T2.12 — CI: integration tests

- **Depends on:** T2.8, T2.9, T2.11
- **Area:** infra
- **What:** Add `pnpm test:integration` to the `database` CI job (stack already running) and make the `web` job seed through the same helper. Keep the jobs under ~12 minutes each.
- **Tests (write first):** none locally; verification is a green CI run on `main` with the integration step visible; a deliberately broken scheduler function on a throwaway branch turns the integration step red (record the run URLs in `docs/ci-failure-demos.md`).
- **Done when:** CI green with integration tests; the red demo recorded.

## Environment & Configuration

| Name                                                                                                                                    | Where                                             | Purpose                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                                                                                                   | `.env.worker` (gitignored), local env for scripts | worker and scenario script (service role, apikey only) |
| `WORKER_ID`, `WORKER_CONCURRENCY`, `POLL_INTERVAL_MS`, `LEASE_SECONDS`, `HEARTBEAT_INTERVAL_MS`, `TASK_TIMEOUT_MS`, `SHUTDOWN_GRACE_MS` | worker env                                        | C5                                                     |

No new GitHub secrets. Hosted application of the new migrations happens through the existing `deploy.yml` when `DEPLOY_ENABLED=true`.

## Done Criteria

- [x] Every task's "Done when" met
- [x] A scripted fake run (parallel tasks, a failing-then-retried task, a gate, a crashed worker whose lease expires) completes end to end (T2.9 integration test)
- [x] Requirements 5, 6, 7 covered by pgTAP (T2.3, T2.4) and integration tests (T2.8, T2.9)
- [x] Dashboard shows the run live within a few seconds (T2.11 e2e)
- [x] Runner interface in place with `FakeRunner` (pre-mortem #1, #3)
- [x] `docs/MANUAL_MIGRATIONS.md` still accurate; `supabase db diff` clean; CI green on `main` including integration tests
- [x] TODO.md updated; Milestone 3 detailed (already done in this planning pass)

## Risks & Watch-Outs

- **Race conditions are the core risk:** claim must be a single statement with `for update skip locked`; the concurrency integration test is the guard, do not weaken it.
- **Lease vs. clock:** all lease times use database `now()`; workers never compare their own clock to `lease_until`.
- **Reaper only runs when a worker ticks:** by design (nothing runs without a worker); M3's `pg_cron` watchdog covers "worker offline" alerts, not reaping.
- **supabase-js and `sb_secret_` keys:** see Context; verify in T2.8 before building on it.
- **Event volume:** every status change writes an event; the run view must paginate or cap the timeline at 200 items.
- **Docker headroom:** the worker container plus local Supabase need the right-sized Colima profile; keep >10 GiB disk free (Project-Plan risk 9).
- **Keep to scope:** no real agent logic, no inbox UI, no Telegram. Park ideas in `docs/parking-lot.md`.
