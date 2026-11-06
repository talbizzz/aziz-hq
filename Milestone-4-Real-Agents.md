# Milestone 4: Real-Agents

## Goal

A real agent completes a small coding task in a sandbox, its usage and transcript are recorded, and the platform respects the Claude plan limits and Aziz's overrides.

## Context

- M1-M3 are built (M1/M3 owner-only steps are open). Read `docs/spikes/FINDINGS.md` S1, S2, S5 first; **where it contradicts this file, FINDINGS wins**.
- What exists: the engine (ADR-13: `claim_task`, leases, `scheduler_tick`, runs `paused`), `Runner` interface and `FakeRunner` (`packages/agents-sdk`), the worker (`apps/worker`: executor, loop, registry), `overrides` (`pause`, `off_today`; `claim_task` honours an active `pause`), `usage` table (empty), `notifications`/Telegram (M3), settings, `docs/MANUAL_MIGRATIONS.md`.
- Conventions: see `CLAUDE.md` (explicit grants, run flows as the executing role, regenerate DB types with every schema change, no secrets in the repo).
- **Execution split (decided when planning, 2026-11-05).** Tasks marked **[local]** need neither a live Claude session nor an owner account and are built and tested with recordings/fakes. Tasks marked **[live]** use Aziz's Claude plan quota, a real sandbox at scale, or an owner account (Cloudflare R2): they are **not started without his go-ahead** (usage is shared with his own work; the S5 live limit-hit capture is still owed).
- Spike facts to build on (do not re-derive): headless `claude -p --output-format stream-json --verbose` emits a `rate_limit_event` with `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt,status}` (fixtures `docs/spikes/evidence/S1-a-stream.jsonl`); the exit code is untrusted (`is_error: true` can come with exit 0); `classifyClaudeFailure` and `extractResetsAt` in `spikes/s5/detect.ts` (documented fixtures only, a live capture is owed); `CLAUDE_CONFIG_DIR` isolates login and sessions but quota is per account; sandbox design A-prime (S2).

## Scope

### In Scope

- Usage policy as a **pure decision engine** (5-hour caps by time of day, weekly pacing and ceiling, overrides) evaluated by the worker before each claim and between turns; usage snapshots stored in the database.
- `ClaudeCodeSubscriptionRunner` (`claude -p` stream-json, usage and limit detection).
- Limit hit = **pause, not failure**: the task goes back to pending without consuming an attempt, a `limit` override holds claims until the window resets, then it resumes by itself.
- Loop guards, the protected-tests diff check, the files-touched-within-scope check, the orchestrator-on-failure hook (gate with the evidence).
- Transcripts to Storage with secret redaction; `usage` table filled per task.
- Per-task Docker sandbox (A-prime) **[live]**; nightly encrypted `pg_dump` to R2 with a tested restore **[live]** (ADR-7).
- Overrides extended from M3 (`working`, `sleeping`, `custom`) and surfaced in the dashboard header and Telegram.

### Out of Scope

- Infisical (M8; until then secrets come from the gitignored `.env.worker` mapped per role), the golden-path template (M5), factory stages/roles (M6-M7), `AgentSdkApiRunner`.

## Contracts (build these first)

### C1 — Usage snapshot and policy settings (database)

New table `usage_snapshots` (RLS: owner select; writes by `service_role`): `id uuid pk`, `at timestamptz default now()`, `source text check in ('rate_limit_event','estimate')`, `five_hour_pct numeric(5,2)`, `five_hour_resets_at timestamptz`, `seven_day_pct numeric(5,2)`, `seven_day_resets_at timestamptz`, `run_id uuid`, `task_id uuid`. The latest row per source is the current truth. Index `(at desc)`.

Settings keys (jsonb, seeded by a manual migration, editable on the settings page): `usage_policy` = `{"sleeping_hours": {"start":"00:00","end":"08:00"}, "cap_work_pct": 50, "cap_sleeping_pct": 100, "weekly_margin_pct": 10, "weekly_ceiling_pct": 90}`.

Overrides (M3 table) get kinds `working` (cap 50, 5 h), `stop` (cap 0, 5 h), `sleeping` (cap 100, 5 h), `custom` (`cap_pct` 0-100 and a duration up to 24 h) in addition to `pause` (an alias of `stop`) and `off_today` (cap 100 for the local day). New column `overrides.cap_pct smallint` (null for the old kinds). `set_override` gains the new kinds and bounds (pgTAP); `claim_task` is **not** changed: the worker applies the policy before claiming.

### C2 — Usage policy engine (`packages/core/src/usage-policy`, pure TypeScript)

```ts
interface PolicyInput {
  now: Date;
  timezone: string;
  settings: UsagePolicySettings; // C1
  snapshot: {
    fiveHourPct: number;
    fiveHourResetsAt: Date;
    sevenDayPct: number;
    sevenDayResetsAt: Date;
  } | null;
  overrides: {
    kind: 'pause' | 'stop' | 'working' | 'sleeping' | 'custom' | 'off_today' | 'limit';
    capPct: number | null;
    expiresAt: Date;
  }[]; // active only
}
type PolicyDecision =
  | { allow: true; capPct: number; reason: string }
  | {
      allow: false;
      reason:
        | 'weekly_ceiling'
        | 'weekly_pacing'
        | 'five_hour_cap'
        | 'override_stop'
        | 'limit'
        | 'no_data';
      resumeAt: Date | null;
      capPct?: number;
    };
function evaluateUsagePolicy(input: PolicyInput): PolicyDecision;
```

Rules (Project-Raw "Usage policy", all thresholds from settings):

1. Weekly **hard ceiling** first: `sevenDayPct >= ceiling` -> deny, `resumeAt = sevenDayResetsAt`. It beats every override.
2. Weekly **pacing** (applies to everything, including modes and "off today"; **only an explicit bypass lifts it**: `pacing_bypass_day` until the next local midnight, `pacing_bypass_week` until `sevenDayResetsAt`; the hard ceiling still applies to a bypass; stop, pause and a hit plan limit still deny): elapsed fraction of the week = `1 - (sevenDayResetsAt - now) / 7 days` (clamped 0..1, **from `resets_at`, not calendar weeks**); deny when `sevenDayPct > elapsed% + margin`; `resumeAt` = the moment the pace catches up (`now + (sevenDayPct - margin - elapsed%)/100 * 7 days`), capped at `sevenDayResetsAt`.
   > **Plan updated:** 2026-11-06, decided by Aziz: modes no longer bypass pacing (this replaces the earlier assumption). Telegram `/nopacing day|week` and `/pacing`; dashboard Mode menu "Ignore weekly pacing today / this week" and "Restore pacing"; both are `set_override` kinds (migration `pacing_bypass`).
3. **Effective cap** (strongest first): an active `limit` override -> deny until its expiry; `stop`/`pause` -> 0; the most recent of `working`/`sleeping`/`custom` -> its cap; `off_today` -> 100; otherwise sleeping hours (local time window, may span midnight) -> `cap_sleeping_pct`, else `cap_work_pct`.
4. `fiveHourPct >= capPct` -> deny, `resumeAt = fiveHourResetsAt`; at 0 cap deny with the override's expiry.
5. A window whose `resets_at` is already in the past counts as empty (a stale snapshot must never block).
6. No snapshot yet: allow with the effective cap but `reason: 'no_data'` (the first run produces the first snapshot).
   Everything deterministic; no I/O; table-driven tests cover each rule, both sides of every boundary, DST days and a window spanning midnight.

### C3 — Claude output parsing and limit detection (`packages/agents-sdk`)

- `parseClaudeStream(stdout): { usage: {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, model}|null; rateLimit: { fiveHour, sevenDay }|null; result: {isError, text, subtype}|null; events: RunnerEvent[] }` from `stream-json` lines (ignores non-JSON lines).
- `classifyClaudeFailure(exitCode, stdout, stderr): 'limit'|'auth'|'other'` and `extractResetsAt(stdout): Date|null` ported from `spikes/s5/detect.ts` with its 10 tests plus the S1 recordings as fixtures.

### C4 — Limit handling in the engine

New RPC (service_role): `release_for_limit(p_task_id uuid, p_worker_id text, p_resets_at timestamptz) returns boolean`: the owner of a running task puts it back to `pending` **without consuming the attempt** (`attempts - 1`, event reason `limit_hit`) and records a `limit` override that expires at `p_resets_at` (or in 30 minutes when null). The worker's usage-policy check treats that override as a deny. `Runner` contract addition: `RunnerResult.status` may be `'limit'` with `resetsAt`; the executor maps it to `release_for_limit`.

### C5 — Guards (pure, `packages/agents-sdk/src/guards`)

- `LoopGuard`: per task, max 3 fix attempts, stop at once when the same failing test with the same error occurs twice in a row, wall-clock cap; `trip` result carries the evidence (each attempt's test + error).
- `checkProtectedTests(diff, protectedGlobs)`: from a unified diff, flags modified or deleted files that match test globs and existed before (new test files are fine); returns `{ ok, violations[] }`.
- `checkScope(touchedFiles, allowedGlobs)`.
- On a trip or violation the task fails with `error.kind` `loop_guard` / `protected_tests` / `out_of_scope`; the orchestrator hook (a system task `orchestrator-review`) is created once, which in turn opens an `escalation` gate with the evidence.

### C6 — Redaction and transcripts

`redactSecrets(text): string` replaces Anthropic keys (`sk-ant-...`), Supabase keys (`sb_secret_...`, `sb_publishable_...`, JWT-shaped `eyJ...`), Telegram bot tokens, GitHub tokens (`ghp_`, `github_pat_`), AWS keys, `Bearer ...` and `password=...` forms with `[REDACTED:<kind>]`; idempotent; never changes non-secret text. Transcript path `transcripts/<run_id>/<task_id>/<attempt>.jsonl` in the Storage bucket `transcripts` (private; owner read through RLS on `storage.objects`; the worker writes with the service role). The worker redacts **before** upload and before inserting events.

## Tasks

### T4.1 — Usage policy engine **[local]**

> **Plan updated (implementation, 2026-11-05):** built as `packages/core/src/usage-policy/engine.ts` (`evaluateUsagePolicy`, `isSleepingHours`, `usagePolicySettingsSchema`, `defaultUsagePolicy`). Mode precedence: a `limit` override denies; the most recently created of `pause|stop|working|sleeping|custom` decides (stop/pause deny until their expiry); `off_today` (cap 100) is weaker than an explicit mode; the stale-window rule and the pacing bypass are as in C2. Assumption to confirm: whether manual overrides should bypass weekly pacing (implemented: yes; the hard ceiling never).

- **Depends on:** —
- **Area:** shared
- **What:** C2 in `packages/core/src/usage-policy` (`evaluateUsagePolicy`, settings schema with defaults, `isSleepingHours`), exported from the package entry.
- **Tests (write first):** table-driven Vitest: the 100%/50% caps at both sides of the sleeping-window boundaries (00:00, 08:00) and a window that spans midnight; cap exactly reached; weekly ceiling beats an `off_today`/`sleeping` override and a `working` override; pacing at the margin boundary with `resets_at` mid-week (not calendar weeks); each override kind and "most recent wins"; expired overrides ignored; `limit` override; `resumeAt` values; no snapshot; DST days; a property test that `allow` is monotone (raising usage never turns a deny into an allow).
- **Done when:** the table of rules in Project-Raw "Usage policy" is covered, tests green.

### T4.2 — Usage snapshots and overrides schema **[local]**

> **Plan updated (implementation, 2026-11-05):** `set_override` (M3) is untouched; the new kinds are set with a separate `set_mode_override(p_kind, p_minutes, p_cap_pct, p_via)` (`working|stop|sleeping` = 5 h with caps from the `usage_policy` setting, `custom` = minutes 1-1440 + `cap_pct` 0-100; `limit` is created only by `release_for_limit`; `clear_override` works for every kind). `overrides.created_by` gains `system`. `usage_snapshots` joins the Realtime publication (for the T4.12 usage panel). **Tool gap found:** recreating `active_overrides` (new `cap_pct` column) dropped its grants and the diff tool did not re-emit them; a listed manual migration restores them (`20261105140800_active_overrides_grants.sql`). **Rule: after any migration that recreates a view, check its grants.**

- **Depends on:** T4.1
- **Area:** database
- **What:** `usage_snapshots` table + grants + RLS + realtime? (no), `overrides.cap_pct` and the extended kinds in `set_override`, `usage_policy` settings seed (manual migration), `record_usage_snapshot(...)` RPC (service_role), `release_for_limit` (C4). Regenerate types.
- **Tests (write first):** pgTAP: table privileges and RLS; `set_override` for the new kinds and bounds (custom cap 0-100, duration up to 24 h; `working`/`stop`/`sleeping` fixed 5 h) as owner and as service_role; `release_for_limit` returns false for a non-owner/not-running task, returns the attempt (`attempts - 1`), writes the `limit` override with the right expiry, event reason `limit_hit`; runs as `service_role` (lesson of M2).
- **Done when:** `db:reset`, `db:test` green, drift clean, types regenerated.

### T4.3 — Claude stream parsing and limit detection **[local]**

> **Plan updated (implementation, 2026-11-05):** `packages/agents-sdk/src/claude/` (`parseClaudeStream`, `classifyClaudeFailure`, `extractResetsAt` returning a `Date`, shared `events.ts`). Fixtures live in `packages/agents-sdk/test/fixtures/`: `claude-stream-recorded.jsonl` is the **real** S1 recording (utilization is a fraction: 0.15 = 15%, +-1 pp), the `s5-*.txt` files are the **DOCUMENTED** S5 shapes (not live captures). Percentages are rounded to two decimals.

- **Depends on:** —
- **Area:** shared
- **What:** C3 (`parseClaudeStream`, `classifyClaudeFailure`, `extractResetsAt`) in `packages/agents-sdk/src/claude`.
- **Tests (write first):** the 10 S5 tests ported; the real S1 stream fixtures (copy `docs/spikes/evidence/S1-a-stream.jsonl` into `packages/agents-sdk/test/fixtures/`) parsed into the expected usage and rate-limit values; a blocked-state event, `is_error` with exit 0, non-JSON noise lines, truncated final line, empty output.
- **Done when:** tests green; fixtures are recordings, never invented (documented ones are marked DOCUMENTED until the live capture).

### T4.4 — Guards: loop guard, protected tests, scope **[local]**

- **Depends on:** —
- **Area:** shared
- **What:** C5 in `packages/agents-sdk/src/guards`.
- **Tests (write first):** `LoopGuard`: 3 attempts then trip, same error twice trips immediately, different errors do not, timeout trip, evidence content; `checkProtectedTests` on real diff text (modified test, deleted test, renamed test, new test file allowed, source-only diff, test file outside the globs); `checkScope` with glob edge cases (nested dirs, dotfiles, `**`).
- **Done when:** tests green.

### T4.5 — Redaction **[local]**

- **Depends on:** —
- **Area:** shared
- **What:** C6 `redactSecrets` in `packages/core/src/redaction`.
- **Tests (write first):** one case per secret kind (using generated fake values assembled in the test so no real-looking literal is committed), mixed text, idempotency, non-secrets untouched (UUIDs, commit hashes, base64 images), property test that redacted output never contains the generated secret.
- **Done when:** tests green; gitleaks stays clean on the test file.

### T4.6 — ClaudeCodeSubscriptionRunner against a recorded CLI **[local]**

> **Plan updated (implementation, 2026-11-05):** `packages/agents-sdk/src/claude/runner.ts`. The runner result contract is extended **additively**: `status` may be `limit` (with `resetsAt`), plus optional `errorKind` (`auth`, `claude_failed`, `protected_tests`, `out_of_scope`, `config`, `guard_error`), `usage`, `rateLimit` and a redacted `transcript`. The process gets a **minimal environment** (PATH, HOME, LANG, TERM, TMPDIR + explicit extras + `CLAUDE_CONFIG_DIR`): no platform secret is inherited. Task payload: `prompt` (required) and optional `scope` globs. The default diff is `git add -N . && git diff HEAD` in the workdir (a failing diff read fails closed). Tests drive a fake `claude` (`packages/agents-sdk/test/fake-claude.mjs`) that replays the recorded stream. The worker's executor does not map `limit` yet: that is T4.7.

- **Depends on:** T4.3, T4.4, T4.5
- **Area:** functions
- **What:** `ClaudeCodeSubscriptionRunner` in `packages/agents-sdk` (`claude -p --output-format stream-json --verbose --max-turns ...` in `input.workdir`, env `CLAUDE_CONFIG_DIR`, abort on `signal`, parse with T4.3, redact with T4.5, run the guards on the produced diff, map to `RunnerResult` incl. `'limit'`). The `claude` binary path is injectable.
- **Tests (write first):** a fake `claude` executable (a script replaying a recorded stream) drives: success with usage, a blocked-state stream -> `limit` with `resetsAt`, auth failure, non-zero exit with `is_error`, abort mid-run kills the process tree, secrets in output are redacted, protected-test diff is rejected.
- **Done when:** unit tests green. **A real `claude -p` run is [live] (T4.9).**

### T4.7 — Worker integration: policy, limit handling, usage, transcripts **[local]**

> **Plan updated (implementation, 2026-11-05):** `loop.ts` evaluates `policy()` (from `policy-source.ts`, reading `usage_snapshots`, `active_overrides` and the settings) before every claim; a deny logs once per change and sleeps `min(poll, time to resumeAt)`, while the scheduler tick and running tasks carry on. `executor.ts`: a `limit` result calls `release_for_limit`; usage rows, usage snapshots and transcripts are recorded for every outcome (a failing recorder never fails the task); a **final** failure (non-retryable kinds `auth`, `config`, `protected_tests`, `out_of_scope`, `guard_error`, `needs_human`, or attempts exhausted; not `shutdown`) first opens a blocking `escalation` gate with the evidence through `createTaskGraph`, which replaces the planned `orchestrator-review` task (the orchestrator agent itself arrives with the factory in M6). Transcript storage is a `TranscriptSink` (no-op until T4.8). The worker registers `claude-code-subscription` next to `fake` (`CLAUDE_BIN`, `CLAUDE_CONFIG_DIR`); `USAGE_POLICY=off` disables the gate for experiments. `FakeRunner` gained scripted `limit` outcomes (`resetsInMs`, absolute `resetsAt`, and `limitUntil`: a scripted limit stops applying then, kept earlier than `resetsAt` so clock skew between the host and the Docker VM cannot matter; found while testing: the VM clock runs slightly ahead of the host's). Not yet done: stopping a running agent after the current turn when an override changes mid-run (needs the real runner's turn hooks, T4.9). Integration test: `limit-pause.integration.ts`.

- **Depends on:** T4.1, T4.2, T4.6
- **Area:** functions
- **What:** before each claim the loop evaluates the policy (latest snapshot + active overrides + settings from Supabase) and skips claiming on deny (logging `resumeAt`); the executor maps `limit` to `release_for_limit`, records `usage` rows and `usage_snapshots`, writes the redacted transcript through a `TranscriptSink` interface (Storage adapter written, exercised in T4.8), and creates the `orchestrator-review` system task on a guard trip (once).
- **Tests (write first):** worker unit tests with the fake engine: deny stops claiming; resumes at `resumeAt`; limit result releases the task without consuming an attempt; usage rows; guard trip creates exactly one review task; integration test (local stack): a FakeRunner run returning `limit` pauses claims until the `limit` override expires and then completes (short window), each override mode takes effect at the next claim.
- **Done when:** unit + integration green.

### T4.8 — Transcript storage and Storage RLS **[local]**

- **Depends on:** T4.7
- **Area:** database
- **What:** bucket `transcripts` (private) and policies in a manual migration (storage schema objects are not tracked by the diff tool), `StorageTranscriptSink` adapter; enable the `storage` service in the local config for the tests that need it.
- **Tests (write first):** integration: upload a redacted transcript as the service role, owner at aal2 can read it, anon and a non-owner cannot; path layout; redaction applied before upload.

> **Plan updated (implementation, 2026-11-06):** the owner-read and no-client-write rules are asserted in pgTAP (`transcripts_storage_test.sql`), which can act as the owner at aal2 without a TOTP flow; the integration test (`apps/worker/test/transcripts.integration.ts`) covers the sink against the real local Storage (upload, redaction, privacy for anon, text-only bucket). Layout: `<run_id>/<task_id>/attempt-<n>.txt`, a retry replaces the object. The sink redacts again before uploading.

- **Done when:** integration green; `docs/MANUAL_MIGRATIONS.md` updated.

### T4.9 — First real agent run **[live: needs Aziz's go-ahead]**

- **Depends on:** T4.6, T4.7
- **What:** run `ClaudeCodeSubscriptionRunner` with the real `claude` on a tiny, throwaway task (a script in a temp repo) on the owner's machine, with `CLAUDE_CONFIG_DIR` set for the worker login; record the stream as new fixtures; replace DOCUMENTED fixtures where possible. Consumes plan quota: ask first, run in sleeping hours.
- **Done when:** transcript and usage recorded, fixtures captured, FINDINGS S1/S5 updated.

### T4.10 — Per-task Docker sandbox (A-prime) **[live]**

- **Depends on:** T4.7
- **What:** productionise `spikes/s2` (slim per-task Supabase stack, ports +100 per slot, `docker update` limits, agent container without `docker.sock`, allowlist proxy, `docker rm -v`, worktree, push-only egress), pin the Supabase CLI version in the image, repeat on the VPS in M8. Needs Docker headroom and supervised measurement (RAM under load).
- **Tests (write first):** `scripts`-level checks from `spikes/s2/check.sh` adapted; integration with a FakeRunner task that must fail to reach the network and succeed to push.
- **Done when:** a task runs end to end in the sandbox; limits and cleanup verified (no leaked volumes).

### T4.11 — Nightly backup and tested restore **[live: needs R2]**

- **Depends on:** M1 T1.9
- **What:** `.github/workflows/backup.yml` (nightly encrypted `pg_dump` over the pooler to R2, retention), a restore script and one tested restore into a scratch local database (ADR-7).
- **Done when:** a dump restores into local Postgres and the row counts match.

### T4.12 — Dashboard and Telegram for the new overrides **[local]**

> **Plan updated (implementation, 2026-11-05):** done. Telegram: `/working`, `/sleeping`, `/stop`, `/custom <cap> <duration>` (`HandlerStore.setMode` -> `set_mode_override`), `/resume` ends `pause` and `stop`. Dashboard: a **Mode** menu in the header (I'm working / I'm sleeping / Stop, 5 h each, and a custom cap + minutes), a _Clear mode_ button, the chip text from `lib/overrides.ts` (limit, pause/stop, the latest mode, off today), a **usage policy** section on the settings page (`parseUsagePolicyForm`, saved to the `usage_policy` setting, margin must stay below the ceiling) and a live **usage panel** on `/` (two bars, the weekly pace marker, and the policy decision in plain language computed in the browser with the same `evaluateUsagePolicy` the worker uses). 4 new e2e specs (`usage.spec.ts`), 20 in total.

- **Depends on:** T4.2
- **What:** header menu items "I'm working (5 h)", "Stop (5 h)", "I'm sleeping (5 h)", custom cap+duration; Telegram commands `/working`, `/stop`, `/sleeping`, `/custom 70 2h`; policy settings (sleeping hours, caps, weekly margin and ceiling) on the settings page; a usage panel (five-hour and weekly bars with `resets_at`, the policy decision and its reason).
- **Tests (write first):** unit tests for the command parser and settings schema; Playwright for the header menu, the settings form and the panel reading a seeded snapshot (live update on a new snapshot).
- **Done when:** unit + e2e green.

## Environment & Configuration

| Name                          | Where                      | Purpose                                                                  |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `CLAUDE_CONFIG_DIR`           | worker env                 | isolates the worker's Claude login/sessions (quota is still per account) |
| `CLAUDE_BIN`                  | worker env                 | path of the `claude` executable (tests point it at a fake)               |
| per-role secret mapping       | `.env.worker` (gitignored) | scoped dev secrets only; Infisical replaces it in M8                     |
| `R2_*`, backup encryption key | GitHub secrets             | T4.11 only                                                               |

## Done Criteria

- [ ] Real small coding task completed in a sandbox with transcript and usage recorded (T4.9, T4.10: live)
- [ ] Hitting a (simulated) limit pauses and auto-resumes; each override mode takes effect immediately (T4.7)
- [ ] Requirements 9-13 covered by tests (policy T4.1, limit T4.7, guards T4.4/T4.6, sandbox T4.10); requirement 18 for the platform DB (T4.11)
- [ ] Pre-mortem #2, #5, #6 mitigations verified (usage source + fallback, loop guards, redaction/protected tests/sandbox scoping)
- [ ] CI green; `docs/MANUAL_MIGRATIONS.md` accurate; TODO.md updated; Milestone 5 detailed before starting it

## Risks & Watch-Outs

- **Quota:** every live run spends Aziz's plan; never schedule one unattended; default the factory to the sleeping-hours cap logic from day one.
- **Documented, not captured:** S5's limit wording is from documentation; treat the classifier as best-effort until the live capture, and keep the "unknown repeated failure => pause 30 minutes" fallback.
- **Policy correctness is safety:** an off-by-one in a cap or pacing edge can burn the weekly quota; the table-driven tests and the monotonicity property are the guard; keep thresholds in settings, never in code.
- **Redaction is best-effort:** pattern-based; the real protection is scoping (no secrets in agent environments) and gitleaks on everything the agent pushes.
- **Sandbox cost:** 2 parallel tasks, 3 max on the netcup box; peak RAM is still unmeasured (open from S2).
- **Keep to scope:** no factory stages, no template, no Infisical. Park ideas in `docs/parking-lot.md`.
