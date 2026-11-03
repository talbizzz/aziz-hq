# Milestone 0: Spikes

> **Execution note (2026-11-03):** executed up to the limits of what could be verified without Aziz's accounts. Local phases of S3/S4 and all of S1/S2 are done; S5 is documentation-based (live test declined); Cloudflare and Telegram live checks are deferred to M1 T1.11 / M3 (see FINDINGS and Project-Plan Open Risks 5, 7, 8). The milestone is **not complete** until Aziz approves go / no-go.

## Goal

Replace every risky assumption in Project-Raw.md "Risks & Open Questions" with measured evidence, recorded in `docs/spikes/FINDINGS.md`, before any product code is written.

## Context

- Nothing exists yet except Project-Raw.md, Project-Plan.md, TODO.md and this file in `/Users/aziztalbi/Documents/aziz-hq` (not yet a git repo).
- Spike code is **throwaway** (ADR-11): `spikes/<id>/`, outside any pnpm workspace, never imported by product code.
- Spikes are not TDD. Instead of "tests first", each task states an **Experiment** written down *before* running it and an **Evidence** artifact saved under `docs/spikes/evidence/`.
- Manual steps that only Aziz can do are marked **[Aziz]**. The executing agent must stop and ask for them rather than guess.
- Never commit secrets, tokens, or chat IDs. Evidence files must be scrubbed (replace with `<redacted>`).

## Scope

### In Scope

- S1 (T0.2): usage visibility in headless `claude -p`.
- S5 (T0.3): behaviour at plan-limit.
- S2 (T0.4): per-task Docker sandbox running local Supabase (macOS leg; Linux/VPS leg deferred to M8, see Risks).
- S3 (T0.5): Vite SPA on Cloudflare Pages (+ Pages Functions) + Supabase Auth with MFA + Cloudflare Access; confirm or reverse ADR-12.
- S4 (T0.6): Telegram inline buttons → secure webhook.
- Repo initialisation (T0.1) and the findings document (T0.7).

### Out of Scope

- Any reusable product code, schema, CI beyond what a spike needs.
- Renting the netcup VPS (3-month minimum; M8).
- Re-checking Anthropic's terms (M8).

## Contracts (build these first)

### Findings document contract — `docs/spikes/FINDINGS.md`

One section per spike, exactly this shape:

```markdown
## S<n>: <question>
- **Verdict:** CONFIRMED | CONFIRMED WITH CHANGES | REPLACED
- **Evidence:** links to files in docs/spikes/evidence/
- **What we learned:** 3–10 bullets, concrete (commands, versions, numbers)
- **Decision for the plan:** the exact change to Project-Plan.md / milestones (or "none")
- **Open follow-ups:** things deferred, with the milestone that owns them
```

A top table summarises all verdicts. Versions recorded: `claude --version`, Docker Desktop version, `supabase --version`, Node, Vite, `@supabase/supabase-js`, wrangler, `jose`, grammY.

### Evidence naming

`docs/spikes/evidence/S<n>-<short-description>.<ext>` (`.txt`, `.json`, `.md`, `.png`).

## Tasks

### T0.1 — Initialise git repo and private GitHub remote

- **Depends on:** —
- **Area:** infra
- **What:** `git init -b main` in `/Users/aziztalbi/Documents/aziz-hq`. Add `.gitignore` (node_modules, `.env*` except `.env.example`, `.turbo`, `.next`, `.open-next`, `.wrangler`, `dist`, `.DS_Store`, `spikes/**/node_modules`, `spikes/**/.env*`). Create directories `docs/spikes/evidence/`, `spikes/`. Create a **private** GitHub repo `aziz-hq` with `gh repo create aziz-hq --private --source . --remote origin` (confirm with Aziz before creating the remote). Commit Project-Raw.md, Project-Plan.md, TODO.md, Milestone files, `.gitignore`.
- **Tests (write first):** `git status` clean after commit; `git check-ignore spikes/s3/.env` prints the path; `gh repo view aziz-hq --json visibility` returns `PRIVATE`.
- **Done when:** commit on `main` exists on the private remote, no secrets tracked.

### T0.2 — Spike S1: does headless `claude -p` expose usage / rate limits?

- **Depends on:** T0.1
- **Area:** infra
- **What:** Answer "Does headless `claude -p` signed in with the Pro plan expose `rate_limits` / usage %? If not, what is the most reliable estimate?"
  - **Experiment (write in `spikes/s1/EXPERIMENT.md` first):** (a) run `claude -p "Reply with OK" --output-format json` and `--output-format stream-json --verbose`; list every field in the output, particularly usage/token/cost fields. (b) Configure a `statusLine` command in a scratch settings file that dumps its stdin JSON to a file; run `claude -p` with that settings file and check whether `rate_limits` (`five_hour`/`seven_day` `used_percentage`, `resets_at`) is ever present in headless mode, and in interactive mode for comparison. (c) Check for any other headless-readable source (CLI subcommands, local state files under the Claude config directory) — read-only inspection, never parse credentials. (d) Calibration: run 5 prompts of increasing size; after each, record token totals from the output and Aziz's `/usage` percentages (**[Aziz]** reads `/usage` in an interactive session and pastes the numbers); compute %-per-token for the 5-hour and weekly windows and the error margin.
  - Also test isolating the worker's credentials with `CLAUDE_CONFIG_DIR` pointing at a separate directory (login stays valid? sessions don't leak into the interactive config?).
  - Record `claude --version`.
- **Tests (write first):** a script `spikes/s1/run.sh` that runs (a) and (b) and saves raw outputs to `docs/spikes/evidence/S1-*.json`; a checklist in EXPERIMENT.md of the exact fields looked for.
- **Done when:** FINDINGS.md S1 section states the primary usage source for the usage policy (`rate_limits` if present headless, else the calibrated token-estimate formula with measured error), and whether `CLAUDE_CONFIG_DIR` isolation works.

### T0.3 — Spike S5: behaviour when a plan limit is hit mid-task

- **Depends on:** T0.2
- **Area:** infra
- **What:** Determine error format and exit code of `claude -p` when the Pro 5-hour limit is reached, so the runner can detect it and pause cleanly.
  - **Experiment:** First gather what is knowable without burning usage: Claude Code docs/help-center text and any limit messages seen in T0.2 output. Then, **only with Aziz's explicit go-ahead [Aziz]** and at a time he chooses (suggest sleeping hours, so his own work is not blocked), run a loop of `claude -p` calls with long prompts until the limit hits; capture stdout, stderr, exit code, and the `stream-json` events for the failing call, plus a call made *during* the blocked period, and one right after `resets_at` (or the stated reset time). If Aziz declines, document the doc-based findings and design detection as: non-zero exit **or** `is_error: true` **and** message matching a configurable pattern list, plus a safe default (treat unknown failures after N tries as "possible limit" → pause 30 min, not fail).
  - Test mid-task behaviour: does a long multi-turn task get killed mid-way, leaving a dirty worktree?
- **Tests (write first):** `spikes/s5/detect.test.ts` (Vitest in the spike folder) containing the classifier `classifyClaudeFailure(exitCode, stdout, stderr) → 'limit' | 'auth' | 'other'`, fed with the captured fixtures saved in `docs/spikes/evidence/S5-*.txt`.
- **Done when:** FINDINGS.md S5 states the exact signals (exit code, JSON fields, message text, reset-time source) and the classifier passes against real or documented fixtures; states whether partial work is recoverable.

### T0.4 — Spike S2: per-task Docker sandbox running `supabase start`

- **Depends on:** T0.1
- **Area:** infra
- **What:** Prove that a disposable per-task container can run `supabase start`, tests, and `git push`, and measure cost.
  - **Experiment:** Write `spikes/s2/Dockerfile` (Ubuntu or Node base, Node 22 LTS, pnpm, git, supabase CLI, docker CLI, `claude` CLI not required). Try two topologies and compare: **(A) sibling containers** — mount `/var/run/docker.sock`, container runs `supabase start` which starts Supabase containers on the host daemon; **(B) Docker-in-Docker** — privileged container with its own daemon. For each: success?, cold start time (`time supabase start` with warm and cold image cache), peak RAM (`docker stats`), disk used, teardown completeness (`supabase stop --no-backup` + `docker rm` leaves no containers/volumes).
  - **Concurrency:** run 3 sandboxes in parallel with distinct `project_id` and port blocks (`[api] port`, `[db] port`, `[studio] port`, `[inbucket] port`, etc. in `config.toml`, or per-sandbox network in topology B). Document the port-allocation scheme that works (e.g. base port + 100×slot) and the failure mode when ports collide.
  - **Path gotcha:** in topology A, bind mounts are resolved by the host daemon; record how the worktree path must be mounted (same absolute path on host and in container).
  - Run `supabase db reset` and a trivial pgTAP test (`supabase test db`) inside the sandbox.
  - Apply resource limits (`--cpus`, `--memory`, `--pids-limit`) and record the minimum limits that still work, as input for the netcup (4 vCore / 8 GB) budget with 2–3 parallel tasks.
  - Test a network allowlist approach: enumerate domains required (GitHub, npm registry, Anthropic, Supabase image registries — images are pulled by the host daemon, not the sandbox) and try enforcing it (e.g. a proxy sidecar with allowlist, or a user-defined Docker network with an egress proxy). Record what works on macOS Docker Desktop; if enforcement isn't feasible locally, write what the netcup phase will use (e.g. nftables/ufw rules for the sandbox network) as a follow-up.
- **Tests (write first):** `spikes/s2/check.sh` with assertions: `supabase status` exits 0 inside the sandbox; `supabase test db` passes; after teardown `docker ps -a` and `docker volume ls` show nothing from the sandbox; 3 parallel sandboxes all pass.
- **Done when:** FINDINGS.md S2 names the chosen topology with numbers (cold/warm start, RAM per sandbox, max safe parallelism on 8 GB), the port-allocation scheme, the allowlist approach, and the fallback decision from pre-mortem #7 if neither topology works.

### T0.5 — Spike S3: Vite SPA on Cloudflare Pages + Supabase Auth MFA + Cloudflare Access

- **Depends on:** T0.1
- **Area:** web
- **What:** Prove the dashboard hosting/auth chain end to end on a throwaway app at `spike-hq.aziztalbi.com`.
  - **[Aziz]** confirms `aziztalbi.com` is a Cloudflare zone, provides (via env, never in repo) a scoped API token with Cloudflare Pages edit + DNS-edit-for-zone permissions, and creates a Zero Trust organisation (free) if none exists. Create a throwaway Supabase **local** stack for auth (no hosted project needed for this spike; hosted is created in M1) — but Realtime and Auth behaviour on hosted differ in no relevant way for this test; note this as a limitation.
  - **Experiment (ADR-12 default):** minimal Vite + React Router SPA deployed with `wrangler pages deploy` to a Pages project. Include: `supabase-js` email+password login; TOTP MFA enroll + verify (`supabase.auth.mfa.*`); a route guard requiring `aal2`; a page that subscribes to Realtime `postgres_changes` on a test table with the user JWT and shows live inserts; Pages Functions: `functions/_middleware.ts` verifying `Cf-Access-Jwt-Assertion` with `jose` against the team JWKS (with `_routes.json` including `/*` — prove static assets are covered too), and `/api/ping` for the Telegram spike. SPA fallback via `_redirects`. Only if a blocker is found, build the minimal Next.js + OpenNext variant to compare, and record the reversal.
  - Cloudflare Access: self-hosted application for `spike-hq.aziztalbi.com`, policy allow only Aziz's email (one-time PIN or his IdP). Verify unauthenticated request is redirected to Access; verify `<project>.pages.dev` and preview URLs either are protected (Access for previews) or are rejected by the middleware's JWT check.
  - **Measure:** Pages Functions bundle size vs the Workers Free limit (3 MB gzipped); whether `jose`/grammY run (compat flags needed); CPU time per request on Free (10 ms limit — note any exceeded); SPA build size; TOTP MFA flow works with session in browser storage (refresh, second tab, sign-out).
  - Realtime from the browser to Supabase works while behind Access (websocket goes direct to Supabase, not through Cloudflare — confirm).
- **Tests (write first):** `spikes/s3/e2e.md` checklist + a Playwright script `spikes/s3/check.spec.ts` covering: unauthenticated → redirect; login → forced to MFA → enrolled TOTP (otplib) → dashboard; Realtime insert appears within 5 s; request without Access header (incl. to `pages.dev` and a static asset) → 403 from the middleware.
- **Done when:** FINDINGS.md S3 states: works / blockers; **explicit verdict on ADR-12 (SPA on Pages confirmed / reversed, with reason)**; exact versions and `wrangler` / `_routes.json` flags that were needed; Functions bundle size vs the Free limit and CPU headroom.

### T0.6 — Spike S4: Telegram inline buttons → secure webhook

- **Depends on:** T0.5
- **Area:** functions
- **What:** Prove a gate can be answered from Telegram safely.
  - **[Aziz]** creates a bot with BotFather and sends it a message; token stored only in the Pages secret store / local `.env` (never committed). Chat ID is discovered via the first webhook update and configured as `TELEGRAM_OWNER_CHAT_ID`.
  - **Experiment:** in the S3 throwaway app add `POST /api/telegram/webhook` as a Pages Function using grammY (`webhookCallback` for Cloudflare). **Also build the same handler as a Supabase Edge Function (Deno) and compare** on: setup effort, where the service-role key lives, Access-bypass needs (none for Edge Function), cold-start latency, local testability. Pick one for ADR-5. `setWebhook` with a random `secret_token` and `allowed_updates=["callback_query","message"]`. Behaviours to prove: (1) request without/with wrong `X-Telegram-Bot-Api-Secret-Token` → rejected, no side effect; (2) update from a different chat/user ID → ignored, logged; (3) message with inline keyboard (Approve / Modify / Dismiss) is sent; a button press arrives as `callback_query`, handled, `answerCallbackQuery` called, original message edited to show the decision; (4) pressing twice (or Telegram retry) is idempotent — keep a decision store (table in local Supabase) keyed by gate id with a unique constraint; (5) callback data stays within Telegram's 64-byte limit — define the compact format (e.g. `g:<gate-uuid-short>:a`) and how it maps to a gate; (6) Cloudflare Access bypass policy scoped to **only** `/api/telegram/webhook` works, and all other paths remain protected (probe 5 other paths); (7) Telegram can reach the endpoint at all (Access in front doesn't block it).
  - Record webhook latency from press to edited message.
- **Tests (write first):** `spikes/s4/webhook.test.ts` (Vitest) with a handler factory taking an injected store: unit tests for secret-token check, owner-chat check, idempotent decision, callback-data parse; plus a manual script checklist for the live parts.
- **Done when:** FINDINGS.md S4 states the verified webhook security rules, callback-data format, idempotency approach, Access bypass configuration (exact path/policy), and measured latency. Unit tests pass.

### T0.7 — Findings doc and plan amendments

- **Depends on:** T0.2, T0.3, T0.4, T0.5, T0.6
- **Area:** infra
- **What:** Assemble `docs/spikes/FINDINGS.md` per the contract. For every verdict other than CONFIRMED, edit Project-Plan.md (and affected stub milestones) and add `> **Plan updated:** <what/why> (<date>)` lines. Update Open Technical Risks (close or reword risks 3, 5, 7). Add a go / no-go summary: does the architecture stand? If S1 shows no usable usage source, state the fallback chosen and its effect on M4. Delete spike `node_modules`; keep source and evidence. Commit and push.
- **Tests (write first):** a script `scripts/check-findings.mjs` (plain Node) that fails if any of S1–S5 sections is missing a `Verdict` line, or evidence links point to missing files, or evidence files contain strings matching token-like patterns (`\d{8,10}:[A-Za-z0-9_-]{35}`, `sk-ant-`, `eyJ` JWT prefixes).
- **Done when:** the check script passes; every pre-mortem row referencing M0 (2, 7, 9) has a recorded outcome; Aziz has read the summary and said go (or the plan is changed accordingly).

## Environment & Configuration

Local only, never committed (names/purpose):

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — wrangler deploy of the spike.
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` — Access JWT verification in the spike app.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_CHAT_ID` — S4.
- `CLAUDE_CONFIG_DIR` — S1 credential-isolation test.

## Done Criteria

- [ ] Every task's "Done when" met
- [x] `docs/spikes/FINDINGS.md` has S1–S5 with verdicts; `scripts/check-findings.mjs` passes
- [x] Project-Plan.md amended wherever a verdict differs from CONFIRMED
- [x] No secrets in the repo (`git log -p` grep for token patterns is clean)
- [x] Spike resources cleaned (none were created on Cloudflare/Telegram; see FINDINGS): throwaway Pages project, DNS record `spike-hq`, Access app, Telegram webhook either deleted or documented for reuse in M1/M3 (state which in FINDINGS)
- [ ] Aziz has approved go / no-go

## Risks & Watch-Outs

- **S5 consumes real Pro usage.** Needs Aziz's go-ahead; schedule in sleeping hours.
- **S2 Linux leg:** macOS Docker Desktop (a Linux VM) approximates but is not the netcup host. Mitigation: M8 stub begins with a repeat of `spikes/s2/check.sh` on the VPS before the first real run; if it fails, apply the pre-mortem #7 fallback.
- Don't let spikes grow: each has a time-box of one working session; if a spike is not resolving, record "inconclusive + fallback chosen" rather than continuing.
- `claude` CLI behaviour changes between versions; always record the version with each result.
