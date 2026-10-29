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

### ADR-5: Telegram webhook lives in a Cloudflare Pages Function

- **Decision:** `POST /api/telegram/webhook` as a Pages Function (`apps/web/functions/api/telegram/webhook.ts`), implemented with grammY (`webhookCallback`, Cloudflare adapter). Cloudflare Access bypass policy applies to **that exact path only**. Authentication on that path: Telegram `secret_token` header must match, and `from.id`/`chat.id` must equal the configured owner chat ID; anything else returns 200 with no action and logs an event. Gate callbacks go through the same `resolve_gate` RPC logic via a server-side function using the service role, with idempotency (a decided gate ignores repeat presses). **Contingent on spike S4**, which also compares this against a Supabase Edge Function webhook (keeps the service-role key inside Supabase, needs no Access bypass); S4 picks one. If both fail, fall back to the worker long-polling Telegram.
- **Why:** Gates must be answerable when the laptop is off; the webhook needs a public endpoint, and the Pages project already exposes Functions.
- **Rejected:** Worker long-polling as primary (dead when worker is offline). Separate Telegram Worker (extra deploy unit); Edge Function stays a candidate until S4.

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

- **Decision:** A Pages Functions middleware (`functions/_middleware.ts`, with `_routes.json` including `/*` so static assets are covered) verifies the `Cf-Access-Jwt-Assertion` header (JWKS from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, audience = Access app AUD, via `jose`) on every route except `/api/telegram/webhook`. If `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are unset: allowed only when `NODE_ENV !== 'production'`; in production the middleware returns 500 for every request (fail closed).
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
- **Consequences:** env vars are `VITE_*`; no server-side session (supabase-js stores the session in the browser); route guarding is client-side UX, security is Access + RLS (ADR-1, ADR-10); `NEXT_PUBLIC_*` names in earlier drafts become `VITE_*`.

## Architecture Overview

```
Aziz ──browser──> Cloudflare Access ──> Dashboard (Vite SPA on CF Pages + Pages Functions, apps/web)
  │                                        │  user JWT (MFA aal2) + RLS, Realtime
  └──Telegram──> /api/telegram/webhook ────┤
                  (secret_token + chat id)  v
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

| # | Risk | Mitigation | Where |
|---|---|---|---|
| 1 | Platform becomes the project | Fixed milestone order; FakeRunner (M2) finishes plumbing without agent cost; `docs/parking-lot.md` rule in CLAUDE.md (out-of-scope ideas are parked, not built); backups/extras only when first needed (ADR-3, ADR-7); M8 forces a real run | M1 T1.1; M2; M8; ADR-3/7 |
| 2 | `claude -p` doesn't expose usage % | Spike S1 decides primary source; fallback = own token tracking calibrated vs `/usage` + limit-error detection + sleeping-hours scheduling | M0 T0.2; M4 stub |
| 3 | Pro limits too tight | Runner interface lets Max/API swap in; measurements recorded | M2 (interface), M4 (measure), M8 (measure) |
| 4 | Plausible-but-wrong code | Separate test agent, protected tests, QA vs spec, reviewer, milestone review gate | M4 (test protection check), M6, M7 |
| 5 | Agent loops burn usage | Loop guards, no-progress detection, timeouts, orchestrator → gate | M4 stub |
| 6 | Secret leak / agent touches prod | Access + MFA + RLS aal2 + in-app Access JWT check; gitleaks pre-commit + CI on platform repo; sandbox env scoping; Infisical | M0 T0.5; M1 T1.1, T1.5, T1.10, T1.11; M4; M8 |
| 7 | Sandbox can't run local Supabase | Spike S2 on macOS (concurrency, ports, RAM); Linux/VPS leg re-verified at M8 start before first real run; fallback shared local Supabase per project on worker host | M0 T0.4; M8 stub |
| 8 | Supabase free-tier limits | Keepalive in M1; nightly dump + restore test in M4; local Supabase for builds; project-count check before creating the platform project | M1 T1.9, T1.12; M4 |
| 9 | Dashboard hosting/runtime incompatibilities | SPA on Pages (ADR-12) keeps server code to a few Functions; spike S3 confirms (Functions limits, Access, Auth MFA); heavy work in worker | M0 T0.5; M1 T1.11 |
| 10 | Notification fatigue | Priority levels, daily digest, inline buttons, quiet hours except critical | M3 stub (`gates.priority` column exists from M1) |

## Milestones

| #   | Name            | Goal                                                                          | Depends on | Status   |
| --- | --------------- | ----------------------------------------------------------------------------- | ---------- | -------- |
| 0   | Spikes          | Confirm or replace every risky assumption with evidence                       | —          | Detailed |
| 1   | Foundation      | Monorepo, platform Supabase, core schema, CI, empty dashboard live behind Access | 0          | Detailed |
| 2   | Engine          | Scheduler, task graph, leases, retries, gates, FakeRunner, local worker       | 1          | Stub     |
| 3   | Human-Loop      | Gates inbox, Telegram buttons, overrides, daily digest                        | 2          | Stub     |
| 4   | Real-Agents     | ClaudeCodeSubscriptionRunner, sandboxes, usage policy, loop guards, backups   | 3          | Stub     |
| 5   | Golden-Path     | Template repo: fresh project passes CI and deploys to dev                     | 4          | Stub     |
| 6   | Factory-Planning| Idea in → approved spec + plan + milestone files                              | 5          | Stub     |
| 7   | Factory-Build   | Approved plan → working app on dev, releasable via gate                       | 6          | Stub     |
| 8   | First-Run       | Tiny project end to end with laptop off; netcup, Infisical, backups verified  | 7          | Stub     |

Rolling rule: M2 is detailed when M1 is nearly done (run `project-plan` again). Note: Project-Raw.md says M0–M4 are built in-loop by Aziz; M5+ may be fed to the platform.

## Out of Scope for v1

Training-plan and job-search modules; 3D city view; chat with agents; AgentSdkApiRunner and other providers; multi-user; Opus-by-default; Sentry/PostHog insight digests; a staging environment for the platform; Terraform/IaC for Cloudflare (Access and DNS are configured manually and documented); PR preview deploys of the dashboard.

## Open Technical Risks

1. ~~Supabase free plan allows 2 active projects.~~ **Resolved (Aziz, 2026-10-29):** GigAway's projects are on a separate account; Aziz's personal account has both free slots available. M1 T1.9 still notes the 2-project limit: the platform project uses one slot, leaving one for the built-project dev/prod pairs (built projects use local Supabase for builds per pre-mortem #8).
2. ~~Worker-offline detection can't run on the offline worker.~~ **Decided (Aziz, 2026-10-29):** Supabase `pg_cron` checks heartbeat age every few minutes and, if stale, calls Telegram via `pg_net`. No extra service. Detail in M3 (watch-outs: bot token stored in Supabase Vault, not a table; alert de-duplication so it fires once per outage; `pg_cron`/`pg_net` extensions enabled via manual migration; free-plan availability confirmed in M3).
3. **Pages Functions limits on the free plan** (Workers Free CPU/size limits apply to Functions; ~100k requests/day). Far smaller exposure than with OpenNext (static SPA + 3 tiny Functions); S3 measures the Functions bundle and CPU.
4. **Supabase direct DB host is IPv6-only on free plan;** GitHub-hosted runners lack IPv6, so `pg_dump` and `db push` in CI must use the pooler connection string (verified in M1 T1.9/T1.12 and M4).
5. **Hitting the Pro limit on purpose (spike S5)** consumes Aziz's real usage; requires his go-ahead and a low-impact time slot.
6. **Anthropic terms** for subscription use at factory volume: re-check before M8 (carried from Project-Raw.md).
7. **Assumption: `aziztalbi.com` DNS is on Cloudflare** (needed for the Pages custom domain and Access). Verified at M0 T0.5.
