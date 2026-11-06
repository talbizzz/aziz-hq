# Aziz HQ — Project Plan

Planned: 2026-10-29. Source of truth: `Project-Raw.md` (never modified).

## Decisions Carried Over

Everything below is fixed by Project-Raw.md and is **not re-decided** here. See Project-Raw.md "Decisions Already Made" for full wording; this is the index agents must respect.

- **Repo:** Turborepo + pnpm monorepo: `apps/web`, `apps/worker`, `packages/core`, `packages/ui`, `packages/agents-sdk`, `modules/factory`. Modules import only from `packages/` (lint-enforced). One root `CLAUDE.md`. Built projects live in separate repos.
- **Dashboard:** TypeScript + Tailwind + shadcn/ui, "read + decide" only, free-text comment on every gate. Domain `hq.aziztalbi.com`, behind Cloudflare Access + Supabase Auth with MFA.
  > **Plan updated:** Project-Raw.md specifies Next.js on Cloudflare Workers via OpenNext. Aziz overrode this on 2026-10-29: the dashboard is a **Vite + React Router SPA on Cloudflare Pages** (same as the golden-path product app), with spike S3 confirming (ADR-12). Project-Raw.md itself is left unchanged.
- **Database:** Supabase hosted, free plan, Frankfurt. Declarative schemas (hybrid) in `supabase/schemas/*.sql`, manual migrations listed in `docs/MANUAL_MIGRATIONS.md`, CI drift check, pgTAP for every table. GitHub Action keepalive every 3 days; nightly encrypted `pg_dump` to R2 (7 daily / 4 weekly / 12 monthly).
- **Orchestration:** Postgres queue; tasks have `status`, `depends_on`, `role`, `attempts`, `lease_until`; claim via `FOR UPDATE SKIP LOCKED`; leases + heartbeats; gates are tasks of type `gate` with status `waiting_human`; every status change writes an event. Deterministic scheduler; orchestrator agent only for judgment calls.
- **Runtime:** `apps/worker` Node/TS; `Runner` interface in `packages/agents-sdk`; `FakeRunner`, `ClaudeCodeSubscriptionRunner` (Pro plan, `claude -p`), `AgentSdkApiRunner` (later, out of v1). Runner chosen per role in config. Roles are config files in `modules/factory/roles/*.md`.
- **Model:** Claude Sonnet 5.5, medium effort, all roles. Opus only as optional orchestrator escalation.
- **Sandboxing:** fresh Docker container per task, git worktree, CPU/RAM/time limits, network allowlist, task-scoped dev secrets only, code leaves only via `git push` to a branch.
- **Worker hosting:** Phase 1 local Docker; Phase 2 netcup VPS Lite 2 G12.5s (from M8).
- **Secrets:** Infisical Cloud EU (M8), folders per scope, redaction, gitleaks.
- **Environments (built projects):** dev + prod only, no staging.
- **Notifications:** Telegram bot (inline buttons) + dashboard inbox; daily digest for info events.
- **Observability:** all in Supabase (`events`, Storage transcripts, `usage`, worker heartbeat every minute). Realtime updates within seconds.
- **Usage policy, budget mechanics, loop guards:** exactly as in Project-Raw.md.
- **Golden path:** exactly as in Project-Raw.md (built in M5).
- **Fixed milestone order M0–M8** with the "Done when" column from Project-Raw.md.
- **Out of v1:** training/job-search agents, 3D city, chat with agents, API/multi-provider runners, multi-user, Opus-by-default, Sentry/PostHog insight digests.

## Architecture Decision Records

### ADR-1: Single-owner enforcement in the database

- **Decision:** Table `app_owner` (exactly one row, enforced by a unique index on `((true))`) holds the owner's `auth.users.id`. Function `public.is_owner()` (security definer, `search_path=''`) returns true iff `auth.uid()` equals that user **and** `auth.jwt()->>'aal' = 'aal2'`. Every RLS policy uses `is_owner()`. Supabase Auth sign-ups are disabled; the owner user is created once by script.
- **Why:** "Never let anyone else trigger agent runs" must hold even if Cloudflare Access is misconfigured. MFA is enforced at the data layer, not only in the UI.
- **Rejected:** Checking `auth.email()` in each policy (brittle, duplicates logic). Relying on Access alone (single layer).

### ADR-2: Writes: dashboard through RPCs only, worker through service role

- **Decision:** The dashboard (user JWT) gets `SELECT` policies only on core tables. Every dashboard write is a `security definer` RPC that calls `is_owner()` first (e.g. `resolve_gate`, added in M3). The worker uses the Supabase service-role key (bypasses RLS) held in its local env (Infisical from M8). The service-role key never reaches the dashboard bundle or any sandbox.
- **Why:** Keeps privileged logic in one reviewable place (SQL), testable with pgTAP; matches the golden-path "security-definer RPCs for privileged writes".
- **Rejected:** Direct table writes from the browser with write policies (harder to keep invariants such as "gate decided once").

### ADR-3: Core schema shape

- **Decision:** Tables: `app_owner`, `modules`, `runs`, `tasks`, `gates`, `events`, `usage`, `worker_heartbeats`, `settings` (full contract in Milestone-1). `tasks.depends_on` is `uuid[]` as specified in Project-Raw.md; existence/cycle validation happens in the RPC/scheduler that creates tasks (M2), not via FK. A gate is a `tasks` row with `type='gate'` plus a `gates` row (1:1, PK = `task_id`) holding kind, context, options, decision. `events` is append-only (trigger blocks UPDATE/DELETE, including for service role). Status-change events are written by DB triggers so no code path can skip them. `memory`, `secrets_meta`, `overrides`, `notifications` tables are **not** created in M1; each is added in the milestone that first uses it.
- **Why:** Triggers guarantee requirement 7 ("every status change produces an event"). Adding tables when first used avoids speculative schema (pre-mortem #1).
- **Rejected:** Join table for dependencies (deviates from the stated column; revisit only if M2 finds array lookups too slow). One table per gate kind (explodes the schema; payload is JSON validated by Zod).

### ADR-4: Realtime via Supabase Realtime `postgres_changes`

- **Decision:** `tasks`, `runs`, `gates`, `events`, `worker_heartbeats` are added to the `supabase_realtime` publication (manual migration, listed in `docs/MANUAL_MIGRATIONS.md`). The browser subscribes with the user JWT; RLS applies. Subscriptions trigger TanStack Query invalidation.
- **Why:** Meets "within a few seconds" with no extra infrastructure; free tier supports it.
- **Rejected:** Polling (wasteful, laggy). Custom WebSocket server (new moving part).
- > **Plan updated:** Spike S3 found `SUBSCRIBED` fires before `postgres_changes` is active, so rows inserted in that gap are never delivered. After subscribing, the dashboard must refetch the affected queries; set the Realtime token (`realtime.setAuth`) before subscribing. RLS with `aal = 'aal2'` is honoured by Realtime (S3). (2026-11-03)

### ADR-5: Telegram webhook is a Supabase Edge Function

> **Plan updated:** Spike S4 compared a Pages Function with a Supabase Edge Function; both work against a mock Telegram API. Approved by Aziz at the M0 go/no-go (2026-11-05). The webhook moves to a **Supabase Edge Function** (previously a Pages Function). Reason: the service-role key stays inside Supabase and **no Cloudflare Access bypass is needed**. (2026-11-03)

- **Decision:** `telegram` Supabase Edge Function (Deno), deployed with `verify_jwt = false` (Telegram cannot send a Supabase JWT), implemented with grammY on `grammy/web` (`webhookCallback(bot, "std/http", { secretToken })`, `botInfo` preset to skip `getMe`). Authentication: Telegram `secret_token` header must match (else 401, no side effect), and `from.id` **and** `chat.id` must equal the configured owner chat ID (else 200, no action, logged). Callback data is `g:<32-hex gate uuid>:<a|m|d>` (36 bytes of the 64 allowed). Idempotency: a decision table with `UNIQUE(gate_id)` using `insert ... on conflict (gate_id) do nothing returning decision`; a repeat press answers "Already decided". Gate callbacks call the same decision logic as the `resolve_gate` RPC server-side with the function's service-role key. Shared logic lives in `packages/core` (injected decision store). **Fallback (proven locally in S3/S4):** the same handler as a Pages Function (`functions/api/telegram/webhook.ts`) with a Cloudflare Access bypass for that exact path only; the dashboard middleware skips only that path. If both fail, the worker long-polls Telegram.
- **Why:** Gates must be answerable when the laptop is off; a public endpoint is required. The Edge Function avoids storing the service-role key at Cloudflare and removes the one Access bypass hole.
- **Rejected:** Worker long-polling as primary (dead when worker is offline). Separate Telegram Worker (extra deploy unit). Pages Function as primary (key at Cloudflare, Access bypass to get right).
- **Unverified (needs live accounts):** hosted Edge Function deployment, hosted cold start, real `setWebhook` and Telegram reachability, real press-to-edit latency (owner: M3).

### ADR-6: Platform repo is trunk-based with one hosted environment

- **Decision:** Platform repo `aziz-hq` uses `main` + short-lived PR branches, CI required on PRs. Merge to `main` deploys the dashboard to `hq.aziztalbi.com` and pushes migrations to the single hosted platform Supabase project. Local Supabase (`supabase start`) is the dev/test environment. The `develop`/`main` split applies to **built projects**, not to the platform.
- **Why:** Project-Raw.md lists no environments for the platform itself and forbids inventing staging. Solo project; one hosted instance.
- **Rejected:** A second hosted Supabase project (free plan allows only 2 active; see Open Technical Risks).
- **Assumption:** flagged in the summary to the user.

### ADR-7: Backups pulled forward to M4; Infisical stays in M8

- **Decision:** Keepalive workflow in M1 (required to prevent free-tier pause). Nightly encrypted `pg_dump` → R2 workflow + one tested restore in **M4** (first milestone with real data: usage, transcripts). M8 re-verifies. Before M8, the local worker reads secrets from a gitignored `.env.worker` file mapped per role in config; Infisical integration happens in M8 as specified.
- **Why:** M1–M3 produce only fake/empty data; a backup then has little value and adds scope. M4 is when loss would hurt. Raw's M8 line lists backups; this moves part of it earlier without dropping anything.
- **Rejected:** Backups in M1 (scope creep vs pre-mortem #1). Backups only in M8 (months of real data unprotected).

### ADR-8: Module boundaries enforced with ESLint flat config

- **Decision:** `no-restricted-imports` / `no-restricted-paths`-style rules in the root `eslint.config.js`: `modules/<a>` may import from `packages/*` only; `packages/*` may not import from `apps/*` or `modules/*`; `apps/*` may import `packages/*` and `modules/*` public entry points. A fixture test lints a file with a forbidden import and asserts the rule fires.
- **Why:** Lint-enforced is required; a fixture test prevents the rule silently going dead.
- **Rejected:** `eslint-plugin-boundaries` (extra dependency for three rules). Nx module-boundary rules (not using Nx).

### ADR-9: Dashboard data layer

- **Decision:** Vite SPA; browser `@supabase/supabase-js` client with user JWT (session in browser storage); TanStack Query for server state; Realtime events invalidate query keys. The only server code is Pages Functions: Cloudflare Access JWT check (middleware), `/api/health`, and the Telegram webhook. The SPA's aal2 route guard is UX only; real enforcement is RLS (ADR-1). DB types are generated into `packages/core/src/db/types.ts`; Zod schemas for JSONB payloads live in `packages/core`.
- **Why:** Matches the golden-path data stack; UI has no logic beyond calling core actions.
- **Rejected:** Next.js server rendering (no SEO need behind a login; see ADR-12). Zustand in M1 (no client state yet).

### ADR-10: Cloudflare Access verified again inside the app, fail-closed

- **Decision:** A Pages Functions middleware (`functions/_middleware.ts`, with `_routes.json` including `/*` so static assets are covered) verifies the `Cf-Access-Jwt-Assertion` header (JWKS from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, audience = Access app AUD, via `jose`) on every route except `/api/telegram/webhook`. If `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are unset: allowed only when the explicit var `ENVIRONMENT === 'development'` (the Workers runtime has no `NODE_ENV`; `wrangler.jsonc` sets `ENVIRONMENT=production`, local dev overrides it); otherwise the middleware returns 500 for every request (fail closed).
- > **Plan updated:** S3 verified (local workerd) that with `_routes.json` including `/*` the middleware covers static assets and SPA-fallback routes, rejects missing, garbage, wrong-audience and expired tokens (403) and fails closed (500); `NODE_ENV` replaced by `ENVIRONMENT` (2026-11-03). If Telegram moves to the Edge Function (ADR-5) the webhook skip in the middleware becomes unnecessary but is harmless.
- **Why:** Defense in depth if an Access policy is edited wrongly or the site is reachable via `<project>.pages.dev` or a preview URL. Also restrict/disable `pages.dev` previews (Pages setting "Access policy for previews" or no preview deployments).
- **Rejected:** Trusting Access alone.

### ADR-11: Spikes are throwaway code in `spikes/`

- **Decision:** Spike code lives in `spikes/<id>/` outside the pnpm workspace, committed for evidence, never imported by product code. Findings go to `docs/spikes/FINDINGS.md`, evidence to `docs/spikes/evidence/`. Each finding either confirms an assumption or produces a dated `> **Plan updated:**` note here.
- **Why:** M0's job is information, not reusable code; keeps M1 clean.
- **Rejected:** Building spikes inside the real apps (risk of promoting prototype code).

### ADR-12: Dashboard is a Vite SPA on Cloudflare Pages (overrides Project-Raw.md)

- **Decision:** `apps/web` is Vite + React Router + TypeScript + Tailwind + shadcn/ui + TanStack Query, deployed to **Cloudflare Pages** by `wrangler pages deploy` from GitHub Actions, with Pages Functions for the three server-side bits (Access JWT middleware, `/api/health`, Telegram webhook). Source: Aziz, 2026-10-29. Spike S3 may **reverse** this only if it finds a blocker (Access + Pages Functions, Supabase Auth MFA in an SPA, Functions limits); the default is the SPA.
- **Why:** The dashboard is behind login, needs no SEO, and talks to Supabase directly; Next.js adds an adapter (OpenNext), a Workers runtime surface and bundle limits for no benefit. It also matches the golden-path product app, so tokens, shadcn setup, tests and Playwright config are reused in M5.
- **Rejected:** Next.js + OpenNext on Workers (original Project-Raw.md decision) — heavier, more runtime risk. Keep as the S3 fallback.
- > **Plan updated:** Spike S3 **confirmed** ADR-12 locally: SPA 138 kB gzip, Functions bundle 46 kB gzip (OpenNext variant: 1.13-1.36 MB), login + forced MFA + aal2 + Realtime + session persistence (refresh, second tab, sign-out) all pass; no blocker found. The Cloudflare-side checks (deploy, Access, real JWKS, Free CPU) remain unverified and move to M1 T1.11 (2026-11-03). OpenNext variant kept in `spikes/s3-opennext/` as a fallback only.
- **Consequences:** env vars are `VITE_*`; no server-side session (supabase-js stores the session in the browser); route guarding is client-side UX, security is Access + RLS (ADR-1, ADR-10); `NEXT_PUBLIC_*` names in earlier drafts become `VITE_*`.

### ADR-13: The scheduler is a set of SQL functions, with state rules in the database

- **Decision:** Claiming, leases, heartbeats, retries, expiry reaping, gate promotion/decision, cancel cascade and run settling are `plpgsql` functions in `supabase/schemas/` (executable only by `service_role`), tested with pgTAP; the worker is a thin loop that calls them (`scheduler_tick`, `claim_task`, `complete_task`, `fail_task`, `heartbeat_task`). The task state machine and the dependency rules are enforced by triggers (`depends_on` is immutable and validated at insert, which makes cycles impossible). Task graphs are created through `create_task_graph`/`create_run` (validation in SQL, mirrored in Zod).
- **Why:** Requirements 5-7 are invariants of the data, not of one worker process; a single-statement `for update skip locked` claim is the safest race-free primitive and works unchanged for several workers (local now, netcup later). Keeping the logic in SQL makes it testable with pgTAP and a concurrency integration test, and the worker stays disposable. Amends ADR-3 ("deterministic scheduler code" lives in the database).
- **Rejected:** Scheduler logic in the Node worker (races between workers, state rules only enforceable by convention). A join table for dependencies (ADR-3 already rejected it). pg_cron for reaping (nothing runs without a worker anyway).
- **Consequences:** every status change still produces an event through the existing trigger; RPCs attribute events with `app.actor_type`/`app.actor_id`/`app.event_data`. A failed task does not cascade to dependents in M2/M3 (M4's orchestrator decides); a dismissed gate does.

### ADR-14: Notifications go through an outbox; Telegram secrets live in Vault; one Edge Function, two paths

- **Decision:** Database triggers write `notifications` rows (outbox). The `telegram` Edge Function has `POST /telegram` (webhook, ADR-5) and `POST /telegram/flush` (called every minute by `pg_cron` through `pg_net`, with a shared secret): it applies the delivery policy (critical = priority 2 always sent; normal deferred in quiet hours and when "off today"; info batched into a daily digest) and sends. Secrets (bot token, chat id, webhook secret, flush secret, URLs) are stored in Supabase Vault and read by the function through a `service_role`-only RPC. The **worker-offline watchdog** (decided 2026-10-29) is independent of the Edge Function: a `pg_cron` job checks heartbeat age and calls the Telegram API directly with `pg_net`.
- **Why:** Retries, deferral and digesting need durable state; the dashboard inbox stays the source of truth. A single source for secrets avoids copies in function secrets and Vault. The watchdog must keep working when the Edge Function is the thing that broke.
- **Rejected:** Direct `pg_net` sends from triggers (no retry, no policy). A separate notifier service (extra deploy unit). Storing the bot token in a table or in GitHub secrets.
- **Unverified:** `pg_cron`/`pg_net`/Vault on the free plan (M3 T3.4, T3.11).

### ADR-15: Usage policy is a pure decision engine, limits are overrides

- **Decision:** The usage policy (5-hour caps by time of day, weekly pacing and ceiling, manual overrides; pacing is lifted only by an explicit day or week bypass, never by a mode) is a pure TypeScript function `evaluateUsagePolicy` in `packages/core`, evaluated by the worker before every claim and between turns from three inputs read from Supabase: the latest `usage_snapshots` row (filled from the `rate_limit_event` of `claude -p` stream-json, ADR from spike S1), the active `overrides`, and the `usage_policy` settings. A plan limit hit by a task is **not a failure**: `release_for_limit` puts the task back to pending without consuming an attempt and records a `limit` override that expires at the window's `resetsAt`, so claims resume by themselves.
- **Why:** The policy decides how fast Aziz's subscription quota is spent, so it must be exhaustively testable without a database or a live model; keeping the claim function unchanged leaves the proven M2 scheduler alone; limits and manual overrides share one mechanism (an expiring override), which also makes them visible in the dashboard and Telegram.
- **Rejected:** Putting the policy into `claim_task` (SQL date maths for time zones and pacing is hard to test and mixes concerns). A separate "paused" state machine for limits (duplicates overrides).
- **Consequences:** a worker that is offline applies no policy (nothing runs then); the worker must re-evaluate at `resumeAt`; thresholds live in settings, never in code.

## Architecture Overview

```
Aziz ──browser──> Cloudflare Access ──> Dashboard (Vite SPA on CF Pages + Pages Functions, apps/web)
  │                                        │  user JWT (MFA aal2) + RLS, Realtime
  └──Telegram──> Supabase Edge Function ───┤
                  `telegram` (secret_token + chat id; flush by pg_cron)  v
                                   Supabase (platform project, Frankfurt)
                                   runs / tasks / gates / events / usage / settings / heartbeats
                                   Storage: transcripts            ^  service role
                                                                   │
                                   apps/worker (Docker: local -> netcup)
                                   scheduler (claim/leases/retries/budgets/usage policy)
                                   Runner interface (packages/agents-sdk)
                                      ├ FakeRunner
                                      └ ClaudeCodeSubscriptionRunner -> `claude -p` in per-task sandbox
                                   per-task sandbox: fresh container + git worktree + local `supabase start`
                                      └ git push branch ──> GitHub (built-project repos, CI, auto-merge to develop)
GitHub Actions (platform repo): CI, deploy dashboard + migrations on main, keepalive, nightly pg_dump -> R2
```

Data flow of a gate: scheduler creates a `gate` task (`waiting_human`) + `gates` row → trigger writes event → Realtime updates dashboard inbox; notifier sends Telegram (M3) → Aziz decides in dashboard (`resolve_gate` RPC) or Telegram (webhook) → gate task `done` with decision → dependent tasks become claimable.

## Repository Structure

```
aziz-hq/
├── Project-Raw.md  Project-Plan.md  TODO.md  Milestone-*.md
├── CLAUDE.md                      # hard rules for agents working on this repo
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
├── eslint.config.js  .prettierrc  .gitleaks.toml  .nvmrc
├── apps/
│   ├── web/                       # dashboard (Vite SPA + Pages Functions)
│   └── worker/                    # Node worker (stub in M1)
├── packages/
│   ├── core/                      # Zod schemas, generated DB types, domain actions
│   ├── ui/                        # design tokens, shadcn components
│   └── agents-sdk/                # Runner interface (+ FakeRunner from M2)
├── modules/
│   └── factory/                   # roles/*.md, stages (from M6)
├── supabase/
│   ├── config.toml  schemas/  migrations/  tests/  seed.sql
├── scripts/                       # db helpers, create-owner, etc.
├── spikes/                        # M0 throwaway code (outside workspace)
├── docs/
│   ├── MANUAL_MIGRATIONS.md  parking-lot.md  adr/
│   └── spikes/FINDINGS.md  spikes/evidence/
└── .github/workflows/             # ci.yml, deploy.yml, keepalive.yml (backup.yml in M4)
```

## Pre-Mortem Mitigations

| #   | Risk                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Where                                            |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Platform becomes the project                | Fixed milestone order; FakeRunner (M2) finishes plumbing without agent cost; `docs/parking-lot.md` rule in CLAUDE.md (out-of-scope ideas are parked, not built); backups/extras only when first needed (ADR-3, ADR-7); M8 forces a real run                                                                                                                                                                                                                                            | M1 T1.1; M2; M8; ADR-3/7                         |
| 2   | `claude -p` doesn't expose usage %          | **Outcome (S1, 2026-11-03):** it does, in `--output-format stream-json --verbose`: a `rate_limit_event` with `five_hour`/`seven_day` `utilization` and `resetsAt` (matches `/usage` within 1 pp). Primary source = that event; fallback = `total_cost_usd` estimate + limit-error detection (S5 classifier) + sleeping-hours scheduling. `CLAUDE_CONFIG_DIR` isolates login/sessions but not quota                                                                                     | M0 T0.2; M4 stub                                 |
| 3   | Pro limits too tight                        | Runner interface lets Max/API swap in; measurements recorded                                                                                                                                                                                                                                                                                                                                                                                                                           | M2 (interface), M4 (measure), M8 (measure)       |
| 4   | Plausible-but-wrong code                    | Separate test agent, protected tests, QA vs spec, reviewer, milestone review gate                                                                                                                                                                                                                                                                                                                                                                                                      | M4 (test protection check), M6, M7               |
| 5   | Agent loops burn usage                      | Loop guards, no-progress detection, timeouts, orchestrator → gate                                                                                                                                                                                                                                                                                                                                                                                                                      | M4 stub                                          |
| 6   | Secret leak / agent touches prod            | Access + MFA + RLS aal2 + in-app Access JWT check; gitleaks pre-commit + CI on platform repo; sandbox env scoping; Infisical                                                                                                                                                                                                                                                                                                                                                           | M0 T0.5; M1 T1.1, T1.5, T1.10, T1.11; M4; M8     |
| 7   | Sandbox can't run local Supabase            | **Outcome (S2, 2026-11-03):** works on macOS/Colima. Chosen design A-prime: worker starts a slim per-task stack (ports +100 per slot, unique `project_id`), the agent container has **no `docker.sock`**, joins the stack network, egress via an allowlisting proxy, limits via `docker update`; ~750 MiB per stack, 2 parallel tasks (3 max) on the netcup box. Linux/VPS leg re-verified at M8 start; fallback = DinD with a pre-baked image, then shared local Supabase per project | M0 T0.4; M4 stub; M8 stub                        |
| 8   | Supabase free-tier limits                   | Keepalive in M1; nightly dump + restore test in M4; local Supabase for builds; project-count check before creating the platform project                                                                                                                                                                                                                                                                                                                                                | M1 T1.9, T1.12; M4                               |
| 9   | Dashboard hosting/runtime incompatibilities | **Outcome (S3, 2026-11-03):** ADR-12 confirmed locally (Functions 46 kB gzip, middleware covers static assets, fail closed, MFA/Realtime fine). Cloudflare-side behaviour (Access, real JWKS, Free CPU) UNVERIFIED until M1 T1.11; OpenNext variant is a proven fallback                                                                                                                                                                                                               | M0 T0.5; M1 T1.11                                |
| 10  | Notification fatigue                        | Priority levels, daily digest, inline buttons, quiet hours except critical                                                                                                                                                                                                                                                                                                                                                                                                             | M3 stub (`gates.priority` column exists from M1) |

## Spike Outcomes and Go / No-Go (M0, 2026-11-03)

| Spike                            | Verdict                                                    | Effect on the plan                                                                |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| S1 usage in headless `claude -p` | CONFIRMED WITH CHANGES                                     | usage policy reads `rate_limit_event` from `stream-json`; cost-based fallback     |
| S5 behaviour at plan limit       | CONFIRMED WITH CHANGES (docs only, live test declined)     | classifier + pause-until-`resetsAt`; live capture owed before M8                  |
| S2 sandbox with local Supabase   | CONFIRMED WITH CHANGES                                     | A-prime design (no docker.sock in agent container); 2-3 parallel tasks on netcup  |
| S3 SPA on Pages + MFA + Access   | CONFIRMED WITH CHANGES (local only)                        | ADR-12 stands; ADR-10 uses `ENVIRONMENT`; Cloudflare-side checks move to M1 T1.11 |
| S4 Telegram webhook              | CONFIRMED WITH CHANGES (mock API; Pages variant also live) | ADR-5 now an Edge Function; Pages Function proven as fallback                     |

**Go / no-go recommendation: GO**, with conditions. No blocker was found: usage is observable, the sandbox design works, the dashboard stack is small (46 kB Functions) and the webhook is secure and idempotent. The conditions are the unverified live-account items (Risk 8), the live limit capture (Risk 5) and Aziz's approval of the ADR-5 change. Effect on M4: no usage-estimation fallback is needed for the normal path; M4 builds the runner on `stream-json`. **Aziz approved GO on 2026-11-05**, including the ADR-5 change, with the three conditions above carried into M1 T1.11 (Workers Free CPU), M3 (Edge Function check) and before M8 (live limit-hit capture).

## Milestones

| #   | Name             | Goal                                                                             | Depends on | Status                                                                                                  |
| --- | ---------------- | -------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 0   | Spikes           | Confirm or replace every risky assumption with evidence                          | —          | Done 2026-11-05: GO approved; live Cloudflare and Telegram checks run; three conditions carried forward |
| 1   | Foundation       | Monorepo, platform Supabase, core schema, CI, empty dashboard live behind Access | 0          | Detailed                                                                                                |
| 2   | Engine           | Scheduler, task graph, leases, retries, gates, FakeRunner, local worker          | 1          | Detailed                                                                                                |
| 3   | Human-Loop       | Gates inbox, Telegram buttons, overrides, daily digest, offline watchdog         | 2          | Detailed                                                                                                |
| 4   | Real-Agents      | ClaudeCodeSubscriptionRunner, sandboxes, usage policy, loop guards, backups      | 3          | Stub                                                                                                    |
| 5   | Golden-Path      | Template repo: fresh project passes CI and deploys to dev                        | 4          | Stub                                                                                                    |
| 6   | Factory-Planning | Idea in → approved spec + plan + milestone files                                 | 5          | Stub                                                                                                    |
| 7   | Factory-Build    | Approved plan → working app on dev, releasable via gate                          | 6          | Stub                                                                                                    |
| 8   | First-Run        | Tiny project end to end with laptop off; netcup, Infisical, backups verified     | 7          | Stub                                                                                                    |

> **Plan updated:** M2 and M3 detailed in rolling mode on 2026-11-05 (ADR-13, ADR-14); M2 needs no owner account and was started while M1's owner-only steps are open. Rolling rule: M4 is detailed when M3 is nearly done (run `project-plan` again). Note: Project-Raw.md says M0–M4 are built in-loop by Aziz; M5+ may be fed to the platform.

## Out of Scope for v1

Training-plan and job-search modules; 3D city view; chat with agents; AgentSdkApiRunner and other providers; multi-user; Opus-by-default; Sentry/PostHog insight digests; a staging environment for the platform; Terraform/IaC for Cloudflare (Access and DNS are configured manually and documented); PR preview deploys of the dashboard.

## Open Technical Risks

1. ~~Supabase free plan allows 2 active projects.~~ **Resolved (Aziz, 2026-10-29):** GigAway's projects are on a separate account; Aziz's personal account has both free slots available. M1 T1.9 still notes the 2-project limit: the platform project uses one slot, leaving one for the built-project dev/prod pairs (built projects use local Supabase for builds per pre-mortem #8).
2. ~~Worker-offline detection can't run on the offline worker.~~ **Decided (Aziz, 2026-10-29):** Supabase `pg_cron` checks heartbeat age every few minutes and, if stale, calls Telegram via `pg_net`. No extra service. Detail in M3 (watch-outs: bot token stored in Supabase Vault, not a table; alert de-duplication so it fires once per outage; `pg_cron`/`pg_net` extensions enabled via manual migration; free-plan availability confirmed in M3).
3. **Pages Functions limits on the free plan.** _Reworded after S3 (2026-11-03):_ the size limit is not a concern (Functions bundle 46 kB gzip vs 3 MB). **Still unverified:** CPU per request on Workers Free (10 ms) cannot be measured locally; verify after the first deploy (M1 T1.11).
4. **Supabase direct DB host is IPv6-only on free plan;** GitHub-hosted runners lack IPv6, so `pg_dump` and `db push` in CI must use the pooler connection string (verified in M1 T1.9/T1.12 and M4).
5. **Hitting the Pro limit on purpose (spike S5).** _Reworded (2026-11-03):_ Aziz declined the live test; S5 rests on documentation (classifier tested on documented fixtures). A live limit-hit capture is still owed before M8 (his go-ahead, sleeping hours) and the real blocked-state event, exit code and message must replace the documented fixtures.
6. **Anthropic terms** for subscription use at factory volume: re-check before M8 (carried from Project-Raw.md).
7. **Assumption: `aziztalbi.com` DNS is on Cloudflare** (needed for the Pages custom domain and Access). _Still UNVERIFIED after M0 (2026-11-03):_ the Cloudflare credentials were not available during M0. Verify first thing in M1 T1.11.
8. **Live-account checks deferred from M0 (new, 2026-11-03):** S3 deploy, Access redirect, real JWT/AUD and `pages.dev`/preview protection were verified live on 2026-11-05 (the account shares one Zero Trust organisation with another project; the Access login must use only the Cloudflare method). S4 was verified live for the Pages variant on 2026-11-05 (real `setWebhook`, delivery, secret and owner checks, near-instant edit). Still open: a timed latency number, hosted Edge Function deployment and cold start (S4), Workers Free CPU limit (S3). Owners: M1 T1.11 and M3.
9. **Local Docker headroom on the 8 GiB Mac (new, S2/S3):** the default Colima VM (2 CPU / 2 GiB) cannot run `supabase start`; a larger VM plus a low-disk Mac caused swap-driven disk exhaustion and a corrupted image store during M0. Use a dedicated, right-sized profile and keep >10 GiB disk free when running local Supabase.
