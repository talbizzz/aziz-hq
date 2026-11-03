# Milestone 1: Foundation

## Goal

Aziz can log in (Cloudflare Access + Supabase Auth with MFA) to an empty dashboard live at `hq.aziztalbi.com`, backed by the hosted platform Supabase project with the core schema applied, and CI is green.

## Context

- Milestone 0 is complete: `docs/spikes/FINDINGS.md` exists and Project-Plan.md has been amended where a verdict differed. **Before starting, re-read FINDINGS.md; where it contradicts this file, FINDINGS.md wins** and this file must be edited with a `> **Plan updated:**` note.
- The repo is `aziz-hq` (private, trunk-based `main`, ADR-6). `Project-*.md`, `Milestone-*.md`, `TODO.md`, `spikes/`, `docs/spikes/` already exist.
- Conventions to respect: Project-Plan.md ADR-1…ADR-12 (dashboard = Vite SPA on Cloudflare Pages unless S3 reversed ADR-12 — if so, adapt T1.10/T1.11 and note it); Project-Raw.md golden-path rules apply to the platform where sensible (strict TS, one version of TS/ESLint/Prettier/Zod, kebab-case files, conventional commits, feature folders, schema changes only in `supabase/schemas/`, local Supabase only for tests, explicit `--project-ref` from env, never a global `supabase link`).
- Manual steps for Aziz are marked **[Aziz]**; the agent stops and asks for them.

## Scope

### In Scope

- Monorepo scaffold, tooling, root CLAUDE.md, boundary lint, gitleaks.
- CI: typecheck, lint, unit tests, pgTAP on a fresh local DB, drift check, generated-types check.
- Local Supabase setup; core schema (declarative) with RLS + pgTAP; event triggers.
- Hosted platform Supabase project, migrations pushed from CI.
- Dashboard skeleton (Vite SPA): login, MFA, empty shell; Pages Functions with Access JWT verification; deployed to Cloudflare Pages at `hq.aziztalbi.com`.
- Keepalive workflow.

### Out of Scope

- Scheduler, claim RPC, worker logic (M2). `apps/worker` is only a stub package.
- Gate inbox UI, `resolve_gate`, Telegram (M3). Overrides, notifications, memory, secrets_meta tables (added when first used).
- Backups (M4, ADR-7), Infisical (M8).
- Dashboard PR previews, staging, Terraform.
- Any module code under `modules/factory` beyond an empty package entry.

## Contracts (build these first)

### C1 — Database enums (`supabase/schemas/00_types.sql`)

```sql
create type public.task_status as enum ('pending','running','waiting_human','done','failed','cancelled');
create type public.task_type    as enum ('agent','gate','system');
create type public.run_status   as enum ('pending','running','paused','done','failed','cancelled');
create type public.gate_decision as enum ('approve','modify','dismiss','answer');
create type public.actor_type   as enum ('system','worker','agent','human');
```

### C2 — Tables (all in `public`, all with RLS enabled, all `created_at timestamptz not null default now()` unless noted)

| Table | Columns (type, constraints) |
|---|---|
| `app_owner` | `user_id uuid primary key references auth.users(id) on delete restrict`; unique index `app_owner_single on app_owner ((true))` |
| `modules` | `id text primary key` (e.g. `factory`); `name text not null`; `enabled boolean not null default true` |
| `runs` | `id uuid pk default gen_random_uuid()`; `module_id text not null references modules(id)`; `title text not null`; `status run_status not null default 'pending'`; `config jsonb not null default '{}'`; `updated_at timestamptz not null default now()`; `finished_at timestamptz` |
| `tasks` | `id uuid pk default gen_random_uuid()`; `run_id uuid not null references runs(id) on delete cascade`; `type task_type not null`; `role text` (check: not null when `type='agent'`); `title text not null`; `status task_status not null default 'pending'`; `depends_on uuid[] not null default '{}'`; `attempts int not null default 0 check (attempts >= 0)`; `max_attempts int not null default 3 check (max_attempts >= 1)`; `lease_until timestamptz`; `claimed_by text`; `priority int not null default 0`; `lane text`; `payload jsonb not null default '{}'`; `result jsonb`; `updated_at timestamptz not null default now()`. Index `(run_id, status)`, index `(status, priority desc, created_at)` where `status='pending'`. Check: `lease_until is null or status = 'running'`. |
| `gates` | `task_id uuid primary key references tasks(id) on delete cascade`; `kind text not null` (one of `spec`,`plan`,`milestone_review`,`release`,`checklist`,`budget`,`usage_extension`,`secret_request`,`escalation`,`other`); `priority smallint not null default 1 check (priority between 0 and 2)` (0 info, 1 normal, 2 blocking); `title text not null`; `context jsonb not null default '{}'`; `options jsonb not null default '[]'`; `decision gate_decision`; `comment text`; `decided_at timestamptz`; `decided_via text check (decided_via in ('dashboard','telegram'))`. Check: `(decision is null) = (decided_at is null)`. Trigger: task referenced must have `type='gate'`. |
| `events` | `id bigint generated always as identity primary key`; `at timestamptz not null default now()`; `run_id uuid`; `task_id uuid`; `entity_type text not null`; `entity_id uuid`; `kind text not null`; `actor_type actor_type not null default 'system'`; `actor_id text`; `data jsonb not null default '{}'`. Index `(run_id, id)`, `(task_id, id)`. **Append-only**: `before update or delete` trigger raises exception (applies to service role too). No FKs (events must survive deletions). |
| `usage` | `id uuid pk default gen_random_uuid()`; `run_id uuid`; `task_id uuid`; `role text`; `model text`; `runner text not null`; `input_tokens bigint not null default 0`; `output_tokens bigint not null default 0`; `cache_read_tokens bigint not null default 0`; `cache_write_tokens bigint not null default 0`; `cost_usd numeric(12,6) not null default 0`. Empty until M4. |
| `worker_heartbeats` | `worker_id text primary key`; `last_seen_at timestamptz not null default now()`; `info jsonb not null default '{}'` |
| `settings` | `key text primary key`; `value jsonb not null`; `updated_at timestamptz not null default now()` |

Seed (`supabase/seed.sql`, local only): `modules` row `('factory','SaaS Factory')`. The same row for hosted goes in a manual migration (DML) listed in `docs/MANUAL_MIGRATIONS.md`.

### C3 — Functions and triggers (`supabase/schemas/`)

- `public.is_owner() returns boolean` — `security definer`, `stable`, `set search_path = ''`; true iff `exists (select 1 from public.app_owner where user_id = auth.uid())` **and** `(auth.jwt() ->> 'aal') = 'aal2'`. `revoke all … from public; grant execute … to authenticated`.
- `public.health() returns text` — returns `'ok'`; `grant execute to anon, authenticated` (used by keepalive).
- `public.set_updated_at()` trigger function on `runs`, `tasks`, `settings`.
- `public.log_status_event()` trigger function: `after insert` on `runs`/`tasks` writes event kind `created`; `after update of status` writes kind `status_changed` with `data = {"from": old, "to": new}`; entity_type `'run'|'task'`; `run_id`/`task_id` filled; `actor_type` `system` (callers may set `set_config('app.actor_type'/'app.actor_id', …, true)` before the update; the trigger reads them with `current_setting(..., true)` and falls back to `system`). `gates` insert/decision write kinds `gate_created` / `gate_decided`.
- `events` guard trigger: `public.events_append_only()` raises `'events are append-only'`.

### C4 — RLS policies

- Every table: `enable row level security`; `force row level security` not needed (service role bypasses by design).
- `select` policy `owner_select` `to authenticated using (public.is_owner())` on all tables except `app_owner`, which has the same select policy (owner can read their own row only via `is_owner()`).
- **No** insert/update/delete policies in M1 (writes: service role or RPC). Exception: `settings` gets `owner_update` (`using` and `with check` `is_owner()`), because settings are edited in the dashboard (used from M3).
- `anon` has no table privileges: `revoke all on all tables in schema public from anon, authenticated` then `grant select on …` to `authenticated`, `grant update on settings to authenticated`.

### C5 — Realtime publication (manual migration, ADR-4)

`alter publication supabase_realtime add table public.runs, public.tasks, public.gates, public.events, public.worker_heartbeats;` — in `supabase/migrations/<ts>_realtime_publication.sql`, documented in `docs/MANUAL_MIGRATIONS.md`. Also in the same file: `insert into public.modules … on conflict do nothing`.

### C6 — Zod/TS contract (`packages/core/src`)

```ts
// packages/core/src/domain/enums.ts — values MUST equal the DB enums in C1
export const taskStatus = z.enum(['pending','running','waiting_human','done','failed','cancelled']);
export const taskType = z.enum(['agent','gate','system']);
export const runStatus = z.enum(['pending','running','paused','done','failed','cancelled']);
export const gateDecision = z.enum(['approve','modify','dismiss','answer']);
export const actorType = z.enum(['system','worker','agent','human']);
export const gateKind = z.enum(['spec','plan','milestone_review','release','checklist','budget','usage_extension','secret_request','escalation','other']);
```

Generated DB types: `packages/core/src/db/types.ts` via `pnpm db:types` (`supabase gen types typescript --local`).

### C7 — Dashboard route contract (`apps/web`)

| Route | Auth requirement | Behaviour |
|---|---|---|
| `/login` | Access JWT valid; no session | Email + password form → on success redirect to `/mfa` |
| `/mfa` | Access JWT valid; session at aal1 | If no verified TOTP factor: enroll (show QR + secret), then verify code; else verify code. On success redirect to `/` |
| `/` | Access JWT valid; session aal2; `is_owner()` true | Empty dashboard shell: header (title "Aziz HQ", sign-out button), left nav with disabled placeholders "Inbox", "Runs", "Settings", empty state "No gates. Nothing running." |
| `/api/health` (Pages Function) | Access JWT valid | `200 {"status":"ok"}` |
| anything without a session (SPA) | — | client-side redirect to `/login` |
| Without valid Access JWT (any request, including static assets and `pages.dev`) | — | `403` plain text from `functions/_middleware.ts`, before anything else (ADR-10). Missing config in production → `500` (fail closed) |

The SPA route guard is UX only; data protection is RLS + `is_owner()` (a user at aal1 who bypasses the guard still reads 0 rows).

Test IDs (`data-testid`): `login-email`, `login-password`, `login-submit`, `mfa-code`, `mfa-submit`, `mfa-qr`, `dashboard-empty`, `signout`.

## Tasks

### T1.1 — Monorepo scaffold, tooling, CLAUDE.md, gitleaks

- **Depends on:** —
- **Area:** infra
- **What:** pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `modules/*`), `turbo.json` (tasks: `build`, `typecheck`, `lint`, `test`), root `package.json` with `packageManager` pinned and `engines.node` matching `.nvmrc` (Node 22 LTS unless FINDINGS says otherwise), `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM, `moduleResolution: bundler`). Packages with `src/index.ts` and one trivial passing Vitest test each: `packages/core`, `packages/ui`, `packages/agents-sdk`, `modules/factory`, `apps/worker` (stub `src/index.ts` exporting a `main()` that logs nothing). `apps/web` created in T1.10. Root ESLint flat config (typescript-eslint), Prettier, Vitest (workspace mode). Single version of TypeScript/ESLint/Prettier/Zod/Vitest via root `devDependencies` / pnpm `catalog`. `.gitleaks.toml` (default rules) and a git pre-commit hook (via `simple-git-hooks`) running `gitleaks protect --staged` plus Prettier on staged files; commit-msg hook enforcing conventional commits (`commitlint`). Root `CLAUDE.md` with hard rules: local Supabase only for tests; `--project-ref` from env, never `supabase link`; schema changes only in `supabase/schemas/` (+ listed manual migrations); never touch the hosted DB from tests; modules import only from `packages/`; no secrets in repo/docs/logs; Karpathy principles (think before coding, simplicity first, surgical changes, goal-driven); **scope guard**: any idea outside the current milestone's scope is appended to `docs/parking-lot.md`, not built. Create `docs/parking-lot.md`, `docs/MANUAL_MIGRATIONS.md` (header + empty table), `docs/adr/README.md`.
- **Tests (write first):** per-package trivial Vitest tests (`expect(true)` style is not acceptable — import and assert the package's exported name); a root script test `scripts/verify-scaffold.test.ts` asserting required files/workspaces exist and that all packages use the single catalog versions (parse `package.json`s).
- **Done when:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass from a clean clone; committing a file containing a fake AWS key is blocked by the hook; a non-conventional commit message is rejected.

### T1.2 — Module-boundary lint rule with fixture test

- **Depends on:** T1.1
- **Area:** infra
- **What:** Implement ADR-8 in `eslint.config.js`: `modules/*` may import from `packages/*` and its own folder only (not another module, not `apps/*`); `packages/*` may not import `apps/*` or `modules/*`; deep imports into another workspace's `src/` are forbidden (use package entry points). Use workspace package names (`@aziz-hq/core`, `@aziz-hq/ui`, `@aziz-hq/agents-sdk`, `@aziz-hq/factory`).
- **Tests (write first):** `scripts/lint-boundaries.test.ts` using ESLint's Node API (`new ESLint({ overrideConfigFile })` + `lintText` with a fake `filePath`) asserting: a file in `modules/factory/src` importing `@aziz-hq/training` → error; importing `@aziz-hq/core` → ok; a file in `packages/core/src` importing `../../apps/web/src/x` → error; `apps/web` importing `@aziz-hq/factory` → ok.
- **Done when:** the four assertions pass and `pnpm lint` stays green on the real tree.

### T1.3 — CI baseline

- **Depends on:** T1.1, T1.2
- **Area:** infra
- **What:** `.github/workflows/ci.yml` on `pull_request` and `push` to `main`: checkout, pnpm + Node setup with cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, plus a gitleaks scan job (`gitleaks/gitleaks-action` or the CLI, full history on PRs). Concurrency group cancels superseded runs. Pin third-party actions to full commit SHAs. In the GitHub repo settings (via `gh api`), protect `main`: require PR, require the CI checks, no force-push. **[Aziz]** approves the branch-protection call.
- **Tests (write first):** none locally; verification is a PR that intentionally fails typecheck (red) then fixed (green) — record the two run URLs in the PR description.
- **Done when:** CI green on `main`; red-then-green demonstrated; branch protection active.

### T1.4 — Local Supabase setup and DB scripts

- **Depends on:** T1.1
- **Area:** database
- **What:** `supabase init` in repo root. Edit `supabase/config.toml`: `project_id = "aziz-hq"`, auth: `enable_signup = false`, `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true`, `[auth] site_url = "http://localhost:3000"`; set `[db.migrations] schema_paths = ["./schemas/*.sql"]` (declarative schemas, files ordered by numeric prefix). Root scripts: `db:start` (`supabase start`), `db:stop`, `db:reset` (`supabase db reset`), `db:diff` (`supabase db diff -f <name>` — generates the migration from schemas), `db:test` (`supabase test db`), `db:types` (generate into `packages/core/src/db/types.ts`), `db:push` (requires `SUPABASE_PROJECT_REF`; runs `supabase db push --project-ref "$SUPABASE_PROJECT_REF" --dry-run` unless `CONFIRM=1`; refuses to run if the variable is unset). `scripts/create-owner.ts`: creates the owner auth user via the Admin API (service role from env) with a password from env and inserts `app_owner`; refuses if `app_owner` already has a row. `.env.example` listing variable names only.
- **Tests (write first):** `scripts/db-scripts.test.ts` asserting `db:push` exits non-zero with a clear message when `SUPABASE_PROJECT_REF` is unset (spawn the script) and that no script contains `supabase link`.
- **Done when:** `pnpm db:start && pnpm db:reset && pnpm db:stop` works on Aziz's machine; script tests pass.

### T1.5 — Core schema (declarative) with pgTAP tests

> **Plan updated (M0 findings, 2026-11-03):** on the current Supabase version new `public` tables get no default grants for API roles; every table needs explicit `GRANT` statements (C2 already lists them; add a pgTAP assertion per table that `authenticated` has only the intended privileges and `anon` has none). `sb_secret_`/`sb_publishable_` keys are not JWTs: scripts send them as `apikey` only.

- **Depends on:** T1.4
- **Area:** database
- **What:** Implement C1 and C2 in `supabase/schemas/00_types.sql`, `10_tables.sql` (one file per concern, numeric prefixes keep ordering), plus `supabase/seed.sql`. Generate the first migration with `pnpm db:diff -- initial_core_schema`. Add C5 as a hand-written migration (timestamped after the generated one) and list it in `docs/MANUAL_MIGRATIONS.md` with reason ("publication membership is not tracked by the diff tool; DML seed").
- **Tests (write first):** pgTAP files under `supabase/tests/`: `tables_test.sql` — for **each** table assert it exists, columns and types (`has_column`, `col_type_is`), PKs, FKs, checks via `throws_ok` (e.g. agent task without role fails; `lease_until` set while `status='pending'` fails; gate with `decision` but null `decided_at` fails; second `app_owner` row fails; gate row pointing at a non-gate task fails), indexes exist, RLS enabled (`select relrowsecurity`), publication contains the five tables.
- **Done when:** `pnpm db:reset && pnpm db:test` passes; `git status` shows the generated migration committed.

### T1.6 — Owner model, RLS policies, helpers and event triggers with pgTAP tests

- **Depends on:** T1.5
- **Area:** database
- **What:** Implement C3 and C4 in `supabase/schemas/20_functions.sql`, `30_triggers.sql`, `40_policies.sql`; regenerate migration via `db:diff`. Triggers must attach `after insert` + `after update of status` to `runs`/`tasks` (ADR-3) and gate events.
- **Tests (write first):** `rls_test.sql` using `tests.create_supabase_user`-style helpers (create `supabase/tests/helpers.sql` that creates auth users and sets `request.jwt.claims` with `sub` and `aal`): (1) `anon` cannot select any table; (2) authenticated non-owner at aal2 sees 0 rows in every table with seeded data; (3) owner at aal1 sees 0 rows; (4) owner at aal2 sees all rows; (5) owner cannot insert/update/delete on any table except `settings` update; (6) `is_owner()` truth table of the 4 combinations; (7) `anon` can execute `health()`, cannot execute `is_owner()`. `events_test.sql`: inserting a task writes `created` event; updating its status writes `status_changed` with correct `from`/`to` and `task_id`/`run_id`; updating a non-status column writes nothing; `update`/`delete` on `events` as superuser raises `events are append-only`; actor override via `set_config` is respected; gate insert and decision write `gate_created`/`gate_decided`.
- **Done when:** all pgTAP tests pass on a fresh `db reset`.

### T1.7 — Drift check, pgTAP and type-generation checks in CI

- **Depends on:** T1.3, T1.6
- **Area:** infra
- **What:** Add CI job `database`: install Supabase CLI (pinned version, same as local; record in `.tool-versions` or `package.json` devDependency), `supabase start` (only needed services: db, auth, realtime; use `-x` excludes to save time), `supabase db reset` (applies **migrations**), `supabase test db`, **drift check** (`supabase db diff` against the schemas must output nothing: implement `scripts/check-drift.sh` that runs the diff and fails with the diff printed if non-empty), and **types check** (`pnpm db:types` then `git diff --exit-code packages/core/src/db/types.ts`). Make the job required in branch protection.
- **Tests (write first):** demonstrate failure modes in a throwaway PR: (a) edit a schema file without generating a migration → drift job red; (b) change a column without regenerating types → types check red. Record run URLs in the PR description. Also `scripts/check-drift.test.ts` is not needed; the throwaway PR is the test.
- **Done when:** the `database` job is green on `main`, red in both failure demos, and required.

### T1.8 — Core Zod schemas matching DB enums

- **Depends on:** T1.6
- **Area:** shared
- **What:** Implement C6 in `packages/core/src/domain/enums.ts` and export from the package entry. Add schemas for JSONB payloads that exist already: `gateOptionSchema` (`{ id: string; label: string; kind: 'approve'|'modify'|'dismiss'|'answer'; requiresComment?: boolean }`) and `eventDataSchema` as `z.record(z.unknown())`.
- **Tests (write first):** `enums.test.ts` — imports the generated `Database['public']['Enums']` type and asserts at compile time (`expectTypeOf`) and at run time (compare `Object.values` of each Zod enum to a list read from the DB via the generated type's `Constants.public.Enums`) that Zod enums equal DB enums exactly; `gateOptionSchema` accepts/rejects sample payloads.
- **Done when:** tests pass; changing a DB enum without updating Zod makes `pnpm typecheck` or `pnpm test` fail (shown once locally).

### T1.9 — Hosted platform Supabase project

- **Depends on:** T1.7
- **Area:** infra
- **What:** **[Aziz]** Create the project in his **personal** Supabase account (both free slots confirmed available; GigAway lives in a separate account). **[Aziz]** creates project `aziz-hq-platform`, region Frankfurt (eu-central-1), strong DB password stored in his password manager; in the dashboard: disable email sign-ups, enable TOTP MFA, set Site URL to `https://hq.aziztalbi.com`. Add GitHub repo secrets (names): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`; variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Create `.github/workflows/deploy.yml` job `migrate` (on push to `main`, after CI success; `environment: production`): `supabase db push --project-ref "$SUPABASE_PROJECT_REF" --dry-run` first, logging the plan, then the real push. CI runners lack IPv6: if the direct connection fails, use the pooler (session mode) connection per FINDINGS/CLI docs. Then **[Aziz]** runs `scripts/create-owner.ts` locally against hosted using a service-role key from his shell env (not committed, not in GH) and enrols MFA at first login (T1.10).
- **Tests (write first):** `scripts/verify-hosted.ts` (reads `VITE_SUPABASE_URL` + publishable key; no service key): asserts `rpc('health')` returns `ok`; anon `select` on each core table returns 0 rows / permission error; sign-up endpoint returns an error. Run manually after the push and again in the keepalive job (T1.12) for the `health` part.
- **Done when:** hosted project has all tables + RLS + realtime publication via CI-pushed migrations; `verify-hosted.ts` passes; the owner row exists.

### T1.10 — Dashboard skeleton: login, MFA, Access JWT check, empty shell

> **Plan updated (M0 findings, 2026-11-03):** (1) the MFA page must remove stale *unverified* TOTP factors before `mfa.enroll` (else `mfa_factor_name_conflict` on a second visit) and pass a unique `friendlyName`. (2) Realtime: call `supabase.realtime.setAuth(access_token)` before subscribing, and refetch the affected queries after `SUBSCRIBED` plus a moment (rows inserted between `SUBSCRIBED` and the active `postgres_changes` subscription are lost). (3) `_middleware.ts` uses an explicit `ENVIRONMENT` var (not `NODE_ENV`): unset Access vars + `ENVIRONMENT != 'development'` -> 500. (4) e2e: wrap TOTP generation with `otplib` 13 (`generate({secret})`).

- **Depends on:** T1.6, T1.8
- **Area:** web
- **What:** Create `apps/web` (Vite + React Router, TypeScript, Tailwind, shadcn/ui init, versions per FINDINGS S3). `packages/ui` exports design tokens (`src/tokens.ts`: color, spacing, radius, font as a TS object) and a script generating CSS variables consumed by Tailwind (`pnpm tokens:build`; CI verifies generated file is up to date with `git diff --exit-code`). Keep the neutral shadcn base; app style is low-variance, low–medium motion. Implement C7: `supabase-js` client (`src/lib/supabase.ts`, reads `VITE_*`), `AuthProvider` + `RequireAal2` route guard (session → `getAuthenticatorAssuranceLevel()` → redirects per C7, via a pure `decideRoute` function). Pages Functions in `apps/web/functions/`: `_middleware.ts` (Access JWT check via `jose`, ADR-10; skips `/api/telegram/webhook` once it exists in M3), `api/health.ts`; `public/_routes.json` including `/*`; `public/_redirects` SPA fallback. TanStack Query provider set up (no queries yet). `.env.example` additions. All UI strings in English.
- **Tests (write first):**
  - Vitest `functions/_middleware.test.ts`: generate an RSA keypair in the test, inject a JWKS resolver, call `onRequest` with a fake context; assert: valid token → `next()` called; wrong audience → 403; expired → 403; missing header → 403; static asset path without header → 403; production env with unset team domain → 500; non-production env with unset team domain → passes.
  - Vitest `redirects.test.ts`: pure function `decideRoute({accessOk, session, aal, path}) → {type:'next'|'redirect'|'deny', to?}` covering the C7 table.
  - Playwright `e2e/auth.spec.ts` against local Supabase (global setup: reset DB, create owner + a second non-owner user; `CF_ACCESS_*` unset in test env): login → `/mfa`; TOTP enrol via `otplib` using the shown secret; verify → `/` shows `dashboard-empty`; sign-out → `/login`; wrong password shows error; non-owner user with TOTP reaches `/` shell **but** the page's data check shows "Not authorised" and no data (is_owner false); direct `/` without session → `/login`.
- **Done when:** unit + e2e tests pass locally and in CI (add a `web` CI job that runs Playwright against local Supabase; cache browsers).

### T1.11 — Deploy to Cloudflare at hq.aziztalbi.com behind Access

> **Plan updated (M0 findings, 2026-11-03):** S3 could not run its Cloudflare phase (no credentials). This task now also owns it: confirm `aziztalbi.com` is a Cloudflare zone, then verify on the live deployment the Access redirect, a real `Cf-Access-Jwt-Assertion` against the team JWKS and AUD, `pages.dev`/preview URLs rejected, and Workers Free CPU per request (10 ms). Pages config verified locally: `compatibility_flags ["nodejs_compat"]`, `vars.ENVIRONMENT=production`, `_routes.json` includes `/*`, `_redirects` SPA fallback. Functions bundle measured at 46 kB gzip (limit 3 MB); keep the size gate at that scale.

- **Depends on:** T1.9, T1.10
- **Area:** infra
- **What:** `apps/web/wrangler.jsonc` for Pages (`name: aziz-hq-web`, `pages_build_output_dir: dist`, compat date + flags per FINDINGS S3), scripts `build` (`vite build`) and `deploy:pages` (`wrangler pages deploy dist --project-name aziz-hq-web --branch main`). Pages project created with preview deployments disabled (or Access-protected). Custom domain `hq.aziztalbi.com` attached to the project (**[Aziz]** confirms DNS in the Cloudflare UI). Add job `deploy-web` to `deploy.yml` (after `migrate`, `environment: production`): build with `VITE_*` vars, deploy via `cloudflare/wrangler-action` (SHA-pinned), secrets `CLOUDFLARE_API_TOKEN` (scoped: Pages edit only; DNS handled manually once), `CLOUDFLARE_ACCOUNT_ID`; Functions runtime secrets (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) set once by **[Aziz]** in the Pages project settings (production environment). **[Aziz]** configures Cloudflare Zero Trust: self-hosted Access application for `hq.aziztalbi.com` (all paths), policy Allow = his email only, session 24 h; the Telegram bypass is **not** created in M1 (M3). Gate this job on a Functions-size check: fail if the compiled Functions bundle exceeds the limit recorded in FINDINGS S3. Document Access and DNS setup (screenshots not needed; exact steps) in `docs/runbooks/cloudflare-access.md`.
- **Tests (write first):** `scripts/smoke-prod.ts` (run manually by Aziz or by an agent via curl): (1) `curl -I https://hq.aziztalbi.com/` without cookies → `302` to `*.cloudflareaccess.com`; (2) `curl -I https://aziz-hq-web.pages.dev/` (and a static asset path there) → `403` from the middleware or an Access redirect, never the app; (3) `curl` with a forged `Cf-Access-Jwt-Assertion` header to `pages.dev` → `403`; then manual checklist **[Aziz]**: login through Access → `/login` → email/password → MFA enrol → empty dashboard visible; sign out.
- **Done when:** Aziz completes the manual checklist on production, and the smoke script's automated checks pass.

### T1.12 — Keepalive workflow

- **Depends on:** T1.9
- **Area:** infra
- **What:** `.github/workflows/keepalive.yml`: `schedule: cron "17 6 */3 * *"` plus `workflow_dispatch`; calls `POST $VITE_SUPABASE_URL/rest/v1/rpc/health` with the publishable key header; fails the job (GitHub emails the owner) if the response is not `"ok"`. Note the `*/3` day-of-month quirk (resets at month end → max gap 4 days, still < 7) in a workflow comment.
- **Tests (write first):** shell step asserts HTTP 200 and body equals `"ok"`; verified by a manual `workflow_dispatch` run.
- **Done when:** a manual dispatch passes against hosted; the schedule is visible in the Actions tab.

## Environment & Configuration

New names only (never values):

| Name | Where | Purpose |
|---|---|---|
| `SUPABASE_PROJECT_REF` | local env, GH secret | explicit project ref for `db:push` / deploy |
| `SUPABASE_ACCESS_TOKEN` | GH secret | Supabase CLI auth in deploy job |
| `SUPABASE_DB_PASSWORD` | GH secret | `db push` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | GH variables, `.env.local` | dashboard + keepalive |
| `SUPABASE_SERVICE_ROLE_KEY` | Aziz's shell only (owner creation), later worker env | admin tasks; never in GH or the web app |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Pages (Functions) secrets | Access JWT verification (ADR-10) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GH secrets | wrangler deploy |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | Aziz's shell only | `create-owner.ts` |

## Done Criteria

- [ ] Every task's "Done when" met
- [ ] All tests pass in CI: typecheck, lint, unit, pgTAP, drift, types, web e2e, gitleaks
- [ ] Hosted platform DB has the core schema, applied by CI; `verify-hosted.ts` passes
- [ ] `https://hq.aziztalbi.com` reachable only through Access; Aziz logs in with email/password + TOTP and sees the empty dashboard
- [ ] `pages.dev` and preview URLs verified denied; unauthenticated and non-owner access verified denied
- [ ] Keepalive workflow runs green
- [ ] `docs/MANUAL_MIGRATIONS.md`, `docs/runbooks/cloudflare-access.md`, `CLAUDE.md` exist and are accurate
- [ ] TODO.md updated; Milestone 2 can be detailed (`project-plan` rolling mode)

## Risks & Watch-Outs

- **Supabase free project limit (2 active):** check before anything else in T1.9.
- **Declarative-schema caveats:** the diff tool misses DML, publication membership, grants on some objects — those go to manual migrations and must be listed, or the drift check fails.
- **IPv6 only direct DB host** on free plan: CI must use the pooler for `db push`.
- **Pages Functions** run on the Workers runtime: keep them tiny, pin versions from S3; don't upgrade casually.
- **SPA session lives in browser storage:** Access plus RLS (aal2) are the security boundary, not the route guard.
- **Realtime + RLS:** Realtime respects RLS using the user JWT; confirm aal2 claim is present in the Realtime token during T1.10 manual testing (a non-obvious source of "no events" bugs, fixed in M2/M3 when subscriptions are added).
- **Keep to scope:** no worker logic, no inbox UI. Park ideas in `docs/parking-lot.md`.
- **Lockout risk:** if MFA enrollment or the Access policy is misconfigured, Aziz can lock himself out; keep Supabase service-role access and the Cloudflare dashboard as the recovery path (document in the runbook).
