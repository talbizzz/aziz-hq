# Aziz HQ — Personal Agent Platform & Software Factory

## Summary

Aziz HQ is a private, single-user platform at `hq.aziztalbi.com` that runs Aziz's AI agents
and lets him supervise them through approval gates. Its first and main module is the
**SaaS Factory**: Aziz submits a product idea, groups of agents brainstorm, challenge,
pre-mortem and plan it, then build it in a standard stack (the "golden path") — with Aziz
approving only at defined gates (spec, plan, milestone reviews, release). The platform is
built as a generic core (tasks, gates, events, memory, secrets, triggers, notifications)
so other agent modules (training plan, job search) can be added later without rework.
Goal: move from in-loop agentic coding (Aziz drives every turn) to out-loop (agents run
unattended, Aziz decides at gates), within a tight budget.

## Problem Statement

Aziz builds software end to end with Claude Code (GigAway was built in ~2 months with
Claude Sonnet on a Pro plan). Today every step is in-loop: he prompts, watches, reviews,
and fixes. This caps throughput at his own attention. He wants agents to carry projects
from idea to deployed app while he only makes the decisions that matter — without losing
control over quality, security, production, or token usage.

## Target Users

Exactly one user: Aziz (product engineer, Berlin, Europe/Berlin timezone). No multi-user,
no teams, no external customers. The platform must never let anyone else trigger agent
runs.

## Proposed Solution

### Core platform

- **Dashboard** (`hq.aziztalbi.com`): an inbox of gates across all modules, live run views
  (task graph, which agent does what, logs, costs/usage), module pages, settings.
- **Engine:** Postgres-backed task queue with a deterministic scheduler. LLM agents are
  stateless workers that claim tasks, run in disposable sandboxes, and write results back.
- **Gates:** anything waiting on Aziz (approve / modify with comment / dismiss / answer).
  Only tasks depending on a gate wait; everything else continues.
- **Notifications:** Telegram bot (with inline buttons for simple gates) + dashboard inbox.
- **Usage policy:** agents respect Claude plan limits on a time-of-day schedule, with manual
  overrides from Telegram or the dashboard.

### SaaS Factory module — the flow

1. **Idea** — Aziz submits an idea in the dashboard.
2. **Brainstorm & challenge** — Expander drafts a spec → 3 challengers in parallel
   (Skeptic, User advocate, Feasibility) → Synthesizer merges → **Gate: spec**
   (approve / modify → loop / dismiss). Max 2 challenge rounds per loop.
3. **Pre-mortem** — agent assumes the project failed in 6 months and lists ranked failure
   causes with mitigations. Feeds the planner.
4. **High-level plan** — Lead planner writes milestones, ADRs (golden-path extensions chosen
   from a fixed menu, with reasons), design tokens, design-taste dial settings, domain map,
   risks, pre-mortem mitigations. Feasibility reviewer checks it against the spec first.
   **Gate: plan.** Milestone 1 is always "Foundation".
5. **Detailed planning (rolling)** — one detailed planner per milestone writes
   `Milestone-N-*.md` (contracts first, small tasks with dependencies, lane, tests,
   "done when", cost estimate). Only M1 + M2 detailed up front; each next milestone is
   detailed when the previous one starts. Lead planner reviews all plans (no gate for
   Aziz, info notification only). Budget gate only if estimate > budget.
6. **Execution** — per task: **Test agent** writes tests from spec/contracts first →
   **Builder** makes them pass in a sandbox (cannot edit existing tests) → **QA** judges
   test coverage vs spec, runs e2e → **Reviewer** checks code, conventions, migrations,
   scope of diff → CI green → **auto-merge to `develop`**. Lanes: database, functions,
   web, mobile, QA. Up to 2–3 tasks in parallel.
7. **Escalation ladder** — (1) builder retries within loop guards → (2) orchestrator agent
   is woken (retry differently, split task, adjust within plan) → (3) gate for Aziz on
   product/scope decisions → (4) contract/plan change goes back to the lead planner,
   Aziz approves, affected tasks get new instructions.
8. **Milestone review** — full suite on `develop`, deploy to dev, **Gate: milestone review**
   (dev URL / EAS preview, summary, usage): approve / changes / replan.
9. **Release** — release candidate summary → **Gate: release** → one approval runs:
   `develop` → `main` PR, backend deploy (migration dry-run shown in gate), web to
   Cloudflare Pages prod, mobile via fingerprint check (OTA staged rollout or store
   build + submit), backups + monitoring on. First release adds a **checklist gate** for
   manual items (store listings, screenshots, privacy policy, DNS, live payment keys,
   legal pages).
10. **Maintenance** — Sentry issues in prod → triage tasks (reproduce, failing test, fix,
    PR to `develop`) → release gate. Small features go through a lighter flow (no
    brainstorm).

## Decisions Already Made

Do not re-decide anything in this section. Plan only the gaps.

### Platform stack

| Layer                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo                          | Turborepo + pnpm monorepo: `apps/web` (dashboard), `apps/worker`, `packages/core`, `packages/ui`, `packages/agents-sdk`, `modules/factory` (later `modules/training`, `modules/jobsearch`). Modules may import only from `packages/`, never from each other (lint-enforced). One root CLAUDE.md. Built projects live in their own separate repos.                                                                                                                                                                                                                                                                          |
| Dashboard UI                  | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. "Read + decide" only (no chat with agents in v1), with a free-text comment on every gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dashboard hosting             | Cloudflare Workers via OpenNext adapter (`@opennextjs/cloudflare`, `nodejs_compat`). Domain `hq.aziztalbi.com` (root `aziztalbi.com` stays a public portfolio). Protected by **Cloudflare Access** in front of the app + Supabase Auth with MFA.                                                                                                                                                                                                                                                                                                                                                                           |
| Database                      | Supabase hosted, **free plan**, region Frankfurt. Holds platform state, event log, memory, usage, storage for transcripts. A GitHub Action pings it every 3 days (keepalive) and takes a nightly `pg_dump` to Cloudflare R2 (encrypted; retention 7 daily / 4 weekly / 12 monthly via R2 lifecycle). Built projects never share this Supabase project.                                                                                                                                                                                                                                                                     |
| Database schema style         | Supabase **declarative schemas** (hybrid): `supabase/schemas/*.sql` for tables/indexes/RLS/functions/triggers; hand-written migrations only for diff-tool caveats (DML, cron jobs, buckets, grants, special views) listed in `docs/MANUAL_MIGRATIONS.md`. CI drift check: fresh DB from migrations, diff vs schemas, must be empty. pgTAP tests for every table.                                                                                                                                                                                                                                                           |
| Orchestration                 | Postgres as queue. Tasks with `status`, `depends_on`, `role`, `attempts`, `lease_until`. Claiming via `SELECT … FOR UPDATE SKIP LOCKED`. Leases + worker heartbeats; expired lease → task back to pending. Gates are tasks of type `gate` with status `waiting_human`. Every status change writes an event.                                                                                                                                                                                                                                                                                                                |
| Orchestrator                  | **Deterministic scheduler code** does claiming, dependencies, leases, retries, budgets. The **orchestrator agent is invoked only for judgment calls** (task failed past loop guard, conflicting results, contract change, escalation).                                                                                                                                                                                                                                                                                                                                                                                     |
| Agent runtime                 | `apps/worker`: Node/TypeScript. **Runner interface** in `packages/agents-sdk` (`run({role, task, context, workdir, budget}) → {status: done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | failed | needs_human, summary, costUsd, events}`). Implementations: **FakeRunner** (scripted, zero cost — used to build/test the whole engine), **ClaudeCodeSubscriptionRunner** (headless `claude -p` logged into Aziz's Claude **Pro** plan — first real runner), **AgentSdkApiRunner** (later, API key). Runner chosen per role in config. |
| Roles                         | Defined as config files (prompt, tools, model, limits) e.g. `modules/factory/roles/*.md`. Adding a role = adding a file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Model                         | **Claude Sonnet 5.5 (medium effort) by default for all roles** — proven: all of GigAway was built with it. Opus only as an optional escalation for the orchestrator.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sandboxing                    | One fresh Docker container per task with a git worktree of the project repo, CPU/RAM/time limits, network allowlist (GitHub, npm, Anthropic, Supabase), only the secrets that task's role needs (dev only). Code leaves the sandbox only as a `git push` to a branch. Agents never get SSH, platform DB credentials, or prod secrets.                                                                                                                                                                                                                                                                                      |
| Worker hosting                | Phase 1: **local Docker on Aziz's machine**. Phase 2 (when runs must continue with the laptop off): **netcup VPS Lite 2 G12.5s** (4 vCore, 8 GB, 160 GB SSD, €9.50/month, 3-month minimum), Ubuntu 24.04, IPv4+IPv6, no Plesk. Outbound-only (no open ports except SSH from Aziz's IP, or Tailscale/Cloudflare Tunnel). Worker image built by GitHub Actions → GHCR → pulled on server. Server is disposable: all state in Supabase + GitHub. Nightly `docker system prune` + old worktree cleanup.                                                                                                                        |
| Secrets                       | **Infisical Cloud (EU region)**. Folders per scope: `platform/prod`, `factory-<project>/dev`, `factory-<project>/prod`. Worker has its own machine identity. Sandboxes get only task-scoped dev secrets as env vars. Prod secrets only for GitHub Actions deploy jobs after the release gate. Agents request new secrets via a gate. Dashboard "secrets health" page (owner, env, created, last rotated, expiry → gate + Telegram before expiry). Automatic rotation where Infisical supports it, reminder gates otherwise. Worker redacts known secret values from agent output. gitleaks pre-commit in every built repo. |
| Environments (built projects) | **dev + prod only, no staging.** Per-PR preview deploys against dev act as pre-prod check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Notifications                 | Telegram bot (instant for blocking gates; inline buttons for simple gates; link to dashboard for complex ones) + dashboard inbox as source of truth. Info events batched into a daily digest.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Observability                 | All in Supabase: `events` table, transcripts in Storage (one file per task run), `usage` table (run, task, role, model, tokens, cost), worker heartbeat row every minute (offline → Telegram). Dashboard shows usage vs limits, run timelines. Docker logs only for deep debugging.                                                                                                                                                                                                                                                                                                                                        |
| Event log design              | Every worker action is an event; entities (modules, factories, runs, tasks, agents) have stable IDs and statuses. UI contains no logic beyond calling core actions — so a future 3D "city" view can be another view over the same data.                                                                                                                                                                                                                                                                                                                                                                                    |

### Usage policy (Claude Pro plan)

- Pro has a **5-hour rolling window** and a **weekly** limit. The platform reads usage %
  from Claude Code's `rate_limits` data (five_hour / seven_day `used_percentage` +
  `resets_at`) if available headless; otherwise it estimates from its own token tracking,
  calibrated once against `/usage`, plus detects "limit reached" errors.
- **5-hour window:**
  - **Sleeping hours** (configurable, default 00:00–08:00 Europe/Berlin): factory may use
    up to **100%**, then pauses until reset.
  - **All other times** (work, evenings, weekends): cap **50%**, then pause + Telegram gate
    with buttons: +10% / +25% / up to 80% / up to 100% ("I'm not working") / No.
    No answer = stays paused.
- **Weekly pacing:** factory may run only if `weekly_used% ≤ elapsed_fraction_of_week% +
margin (default 10%)` and below a **hard ceiling (default 90%)**. Uses `resets_at`, not
  calendar weeks.
- **Manual overrides** (Telegram command + dashboard header, any time): "I'm working —
  next 5h" (50% cap), "Stop using my tokens — next 5h" (0%), "I'm off / sleeping now"
  (100%), custom mode + duration, cancel. Overrides take effect immediately (running
  agents stop after the current turn and commit), show in the dashboard, and expire
  automatically. Weekly ceiling always applies. "I'm off today" switch for days off.
- **Hitting a limit = pause, not failure.** Runs resume automatically after reset.
- All thresholds are dashboard settings.

### Budget mechanics (generic, for API runners later)

Usage metered after every model turn. Nested caps: month → run → milestone → task.
Checks before claiming a task, after every turn, and at planning. 80% → info ping;
100% → stop new claims, running agents stop after their turn and commit, gate shows
spend breakdown with options (add budget / cut scope / pause). Anthropic Console spend
limit as outer backstop when API keys are used.

### Loop guards (every task)

Max 3 fix attempts; same test failing with same error twice in a row → stop immediately;
per-task cap; wall-clock timeout (default 45 min). On trip: task `failed` → orchestrator
once → gate for Aziz with failing test, error, each attempt, diff. Builders cannot modify
or delete existing tests; worker checks the diff; test changes need QA approval with a reason.

### Golden path (SaaS template — a separate repo built in this project)

Based on GigAway's proven setup ("GigAway shape") plus fixes.

- **Shape:** pnpm workspaces monorepo: `apps/app` (product), optional `apps/web`
  (landing), `apps/mobile`, `apps/admin`; `packages/shared` (Zod schemas, domain rules,
  generated DB types, design tokens); `supabase/` (schemas, migrations, functions, tests,
  config). Strict TypeScript; one TS / ESLint / Prettier / Zod version across apps.
- **Backend:** Supabase only — RLS on every table, security-definer RPCs for privileged
  writes, Edge Functions for side effects (email, push, external APIs), pg_cron + pg_net
  for jobs. No separate Node server. Declarative schemas (hybrid) + drift check. **Every
  new table ships with its RLS policies and pgTAP tests in the same task.**
- **Local Supabase stack mandatory** (`supabase start`) — agents never test against dev
  or prod databases. Supabase CLI always with explicit `--project-ref` from env, never a
  global link.
- **Product app:** Vite + React Router + TanStack Query. **Landing (extension):** Next.js
  static export. **Dynamic web (extension, only if spec has SEO-relevant dynamic pages):**
  Next.js on Cloudflare Workers via OpenNext.
- **Mobile (extension):** Expo, StyleSheet + shared design tokens (no NativeWind).
  EAS Build/Submit/Update.
- **Styling:** web = Tailwind + shadcn/ui; tokens defined once as a TS object in
  `packages/shared/src/theme/tokens.ts`; a build script generates CSS variables for
  Tailwind/shadcn; CI checks generated CSS is up to date. Tokens chosen per project at
  the plan gate.
- **Design taste:** design-taste-frontend skill (Leonxlnx/taste-skill), **pinned copy**
  in the template. Dials set per project at the plan gate (landing: higher variance/motion;
  app: low variance, low–medium motion). One taste skill per project.
- **Data & state:** TanStack Query (server state), Zustand (client state only),
  react-hook-form + Zod resolvers, DB types generated into `packages/shared`.
- **Shared code** must work in Node, bundlers (Vite/Metro/Next) and Deno (Edge
  Functions): pure ESM TS, no Node-only APIs, runtime-agnostic deps; CI imports it in
  both a Node test and a Deno test. Deno sync step (copy shared into functions) is a
  built-in, tested template script.
- **Testing:** pgTAP (DB), Vitest (shared, under Node and Deno), Vitest + Testing
  Library (web components), Playwright (web e2e against local stack), Jest + RN Testing
  Library (mobile components), Maestro (mobile e2e — runs in GitHub Actions incl. macOS
  runners, not in sandboxes), Deno test (Edge Functions, external services mocked).
  **No coverage percentage target** — every spec requirement and user flow must have a
  meaningful test; QA judges this against the spec.
- **CI/CD:** GitHub Actions (typecheck, lint, all tests, drift check, pgTAP on fresh
  local DB). Branches: task branch → PR → `develop` (dev env) → release PR → `main`
  (prod). **Auto-merge to `develop`** when CI green + reviewer agent approves. Prod deploy
  only after the dashboard release gate approves the GitHub `production` environment.
  Web on Cloudflare Pages (preview per PR against dev). Backend deploy: migration dry-run
  then push + functions. Nightly `pg_dump` to R2 per project.
- **EAS Update:** production publish token only in GitHub `production` environment;
  agents never get an Expo token. Channels: `develop` → `preview` automatically; `main` +
  approval → `production`. Expo **fingerprint** check decides OTA (JS-only) vs store
  build (native change). Staged rollout percentages and one-click rollback offered at
  the gate; updates tagged in Sentry.
- **Monitoring:** Sentry (web, mobile, functions), PostHog behind `ANALYTICS_ENABLED`
  flag, simple uptime check. New prod Sentry issue → webhook → triage task.
- **Repo docs:** `CLAUDE.md` (hard rules: local stack only, explicit project ref, never
  touch prod, tests protected, schema changes in `schemas/`, Karpathy principles
  adapted for out-loop: escalate instead of asking), `docs/spec.md`, `docs/plan.md`,
  `docs/milestones/Milestone-N-*.md`, `docs/adr/`, `docs/contracts/`,
  `docs/MANUAL_MIGRATIONS.md`, `TODO.md`, `.claude/skills/`. Feature folders
  (`src/features/<domain>`), kebab-case files, conventional commits, PR template.
- **Extension menu with written criteria** (landing, dynamic web, mobile, admin, 3D via
  react-three-fiber, …). Planner picks from the menu via ADRs; anything not on the menu →
  gate "add a new extension?" instead of improvising.

### Agent behavior standards

- Karpathy principles (think before coding, simplicity first, surgical changes,
  goal-driven) in every builder prompt and the golden-path CLAUDE.md. Out-loop adaptation:
  ambiguity is returned as a question in the task result → orchestrator → gate, never
  silently guessed. Reviewer enforces simplicity; worker checks files touched ⊆ task scope.
- Role prompts for the factory are derived from Aziz's updated `project-brainstorm`,
  `project-plan`, `execute-implementation` skills, rewritten for structured output and
  gates (not chat).

### Fixed milestone order

The planner must keep this order. **Milestone 0 (Spikes) precedes Foundation** — this
overrides the default "Milestone 1 is Foundation" rule only in the sense that spikes come
first; M1 is Foundation.

| #   | Milestone                                                                                                                                          | Done when                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| M0  | Spikes                                                                                                                                             | Findings doc confirming or replacing every risky assumption (see Open Questions)      |
| M1  | Foundation — monorepo, platform Supabase project, core schema (declarative + pgTAP), CI, dashboard skeleton live on hq.aziztalbi.com behind Access | Aziz can log in to an empty dashboard; CI green                                       |
| M2  | Engine — scheduler, task graph, leases, retries, gates, event log, FakeRunner, worker in local Docker                                              | A fake run flows end to end, visible live in the dashboard                            |
| M3  | Human loop — gates inbox, Telegram bot with buttons, overrides, daily digest                                                                       | Aziz approves a fake gate from his phone and the run continues                        |
| M4  | Real agents — ClaudeCodeSubscriptionRunner, per-task sandbox, usage policy, loop guards, transcripts + usage tracking                              | A real agent completes a small coding task in a sandbox and respects limits/overrides |
| M5  | Golden-path template repo                                                                                                                          | A fresh project from the template passes CI and deploys to dev                        |
| M6  | Factory planning side — Stages: brainstorm/challenge, pre-mortem, high-level plan, detailed planning                                               | Idea in → approved spec + plan + milestone files                                      |
| M7  | Factory build side — test agent, builder, QA, reviewer, lanes, auto-merge, milestone review, release                                               | An approved plan becomes a working app on dev, releasable via the gate                |
| M8  | First real run + platform go-live — tiny test project end to end, worker on netcup, Infisical, backups                                             | The factory builds something small while Aziz's laptop is off                         |

M0–M4 are built in-loop by Aziz with Claude Code. From M5 on, parts of the work may be fed
to the platform itself as tasks.

## Competitive Landscape

Personal tool, not a product. Alternatives considered: Claude Code alone (in-loop only),
GitHub Action-based single workflows (no gates/usage policy/multi-stage planning),
hosted agent platforms (cost, less control). Differentiator for Aziz: his own golden path,
his gates, his usage policy, EU hosting, near-zero fixed cost.

## Pre-Mortem

| #   | Failure cause                                                                                | Likelihood | Impact | Mitigation                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Platform becomes the project — months on infrastructure, factory never builds anything       | High       | High   | Strict milestone order; FakeRunner to finish plumbing fast; M8 forces a real end-to-end run; no extras (3D, other modules) before M8                              |
| 2   | Headless `claude -p` doesn't expose usage %, usage policy can't work as designed             | Med        | High   | M0 spike; fallback = own token tracking calibrated vs `/usage` + limit-error detection + sleeping-hours scheduling                                                |
| 3   | Pro plan limits too tight — factory too slow to be useful                                    | Med        | Med    | Measure in M4/M8; runner interface allows switching to Max or API without code changes                                                                            |
| 4   | Agents produce plausible but wrong code that passes weak tests                               | Med        | High   | Tests written by separate test agent from spec; protected tests; QA judges vs spec; reviewer; milestone review gate                                               |
| 5   | Agents loop or burn usage on unfixable failures                                              | Med        | Med    | Loop guards, no-progress detection, per-task timeouts, orchestrator then gate                                                                                     |
| 6   | Secret leak (prompt, logs, commit) or agent touching prod                                    | Low        | High   | Infisical scoping, dev-only secrets in sandboxes, redaction, gitleaks, no prod credentials outside gated GitHub environment, Cloudflare Access + MFA on dashboard |
| 7   | Sandbox can't run local Supabase / Docker-in-Docker issues                                   | Med        | Med    | M0 spike; fallback: shared local Supabase per project on the worker host                                                                                          |
| 8   | Supabase free tier limits (2 active projects, pausing, no backups) cause outage or data loss | Med        | Med    | Keepalive + nightly pg_dump; pause idle built-app projects; local Supabase for builds; upgrade when needed                                                        |
| 9   | Dashboard on Cloudflare Workers (OpenNext) hits runtime incompatibilities                    | Low        | Med    | M0 spike; heavy work runs on the worker, dashboard stays thin                                                                                                     |
| 10  | Notification fatigue — Aziz ignores gates                                                    | Med        | Med    | Priority levels, daily digest for info, inline buttons, quiet hours except critical                                                                               |

## Risks & Open Questions

To be answered in **M0 (Spikes)**:

1. Does headless `claude -p` (signed in with the Pro plan) expose `rate_limits` /
   usage %? If not, what's the most reliable estimate?
2. Docker sandbox per task on macOS (local phase) and on the netcup VPS: can each sandbox
   run `supabase start` (Docker-in-Docker or sibling containers), and what's the
   startup time and RAM cost?
3. Next.js dashboard on Cloudflare Workers via OpenNext + Supabase Auth + Cloudflare
   Access: any blockers?
4. Telegram inline buttons → secure callback to the platform (verify the update came from
   Aziz's chat ID).
5. How does `claude -p` behave when a plan limit is hit mid-task (error format, exit
   code) so the runner can detect it and pause cleanly?

Other open questions:

- Exact role prompt wording for each factory role (done during M6/M7, derived from Aziz's
  skills).
- Whether ClaudeCodeSubscriptionRunner usage stays within Anthropic's terms for
  "ordinary, individual usage" at the volume reached — re-check Anthropic's help center
  before M8.

## Scope & Constraints

**v1 includes:** core platform, dashboard, engine, Telegram, usage policy, overrides,
FakeRunner + ClaudeCodeSubscriptionRunner, sandboxes, secrets (Infisical), backups,
golden-path template, full SaaS Factory flow (idea → release → maintenance triage),
deployment on Cloudflare + netcup.

**v1 does NOT include:** training-plan agent, job-search agent, 3D city view, chat with
agents in the dashboard, AgentSdkApiRunner / multi-provider (Pi) runners, multi-user
access, Opus-by-default, Sentry/PostHog weekly product-insight digests.

**Constraints:**

- Solo project (Aziz).
- Claude **Pro** plan for now; no API budget at the start. Upgrade only when limits block.
- Near-zero fixed cost: Supabase free, Cloudflare free tiers, Infisical free, netcup
  €9.50/month only from M8.
- EU hosting (Frankfurt / Nuremberg / Infisical EU).
- Never store secrets in repos, docs, prompts or logs.

## Requirements

### Functional

1. Aziz can log in to `hq.aziztalbi.com` only through Cloudflare Access + Supabase Auth (MFA).
2. The dashboard shows an inbox of all open gates across modules, sortable by priority.
3. Each gate shows its context and supports approve / modify (comment) / dismiss / answer.
4. Runs show a live task graph, task statuses, agent role per task, logs, transcripts, usage.
5. The scheduler claims only tasks whose dependencies are done and whose gate (if any) is resolved.
6. A crashed worker's tasks return to pending when the lease expires.
7. Every status change produces an event visible in real time.
8. Telegram notifies blocking gates instantly; simple gates are answerable via inline buttons; info events go into a daily digest.
9. The usage policy enforces the 5-hour time-of-day caps, weekly pacing and ceiling, and manual overrides exactly as specified above.
10. Hitting a plan limit pauses runs and resumes them automatically after reset.
11. Loop guards stop tasks as specified and escalate through orchestrator → gate.
12. Builders cannot modify existing tests; violations are rejected by the worker.
13. Each task runs in a fresh sandbox with only its scoped dev secrets; code leaves only via git push.
14. The factory runs the full flow (stages 1–10 above) with gates at spec, plan, milestone review, release (+ first-release checklist).
15. Factory-built repos are generated from the golden-path template and use its CI/CD.
16. Prod deploys (web, backend, mobile OTA/store) happen only after the release gate.
17. New prod Sentry issues in built apps create triage tasks.
18. Nightly backups of the platform DB (and each built project's prod DB) to R2 with retention.

### Non-functional

- **Security:** no agent access to prod secrets or platform DB credentials; secret redaction; all approvals logged.
- **Reliability:** worker restart-safe (`restart: always`), all state in Supabase/GitHub; server disposable.
- **Cost:** fixed costs ≤ ~€10/month until M8; model usage within Pro plan.
- **Observability:** every agent action traceable to task, role, transcript, usage.
- **Extensibility:** new modules and roles added via folders/config, not core changes.
- **Performance:** dashboard reflects events within a few seconds (Supabase Realtime).

## Success Criteria

- M8 reached: a small SaaS app goes from idea to deployed dev version (and released via
  the gate) with Aziz only acting at gates, while his laptop is off.
- Aziz keeps ≥10% of his weekly Claude usage at all times and ≥50% of each 5-hour
  window outside sleeping hours unless he overrides.
- No secret leaks, no unapproved prod changes.
- Fixed infrastructure cost stays around €10/month.

## Expected Final Result

Aziz opens `hq.aziztalbi.com` (or Telegram on his phone). He types an idea. Over the next
hours, agents draft and challenge a spec and send him a gate; he approves with a comment.
A pre-mortem and a milestone plan with ADRs and design tokens arrive; he approves. From
then on, agents build the app milestone by milestone in sandboxes on a small netcup
server — mostly at night, respecting his Claude usage — opening PRs that auto-merge to
`develop` when tests and review pass. At each milestone he gets a dev URL to click
through. When v1 is done, he approves the release and the web app, backend and mobile
update go live. Afterwards, production errors turn into fix proposals waiting for his
approval. At any time he can tap "Stop using my tokens — next 5h" and the factory pauses
immediately.
