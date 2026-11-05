# TODO

## Milestone 0: Spikes

- [x] T0.1 — Initialise git repo and private GitHub remote
- [x] T0.2 — Spike S1: does headless `claude -p` expose usage / rate limits?
- [x] T0.3 — Spike S5: behaviour when a plan limit is hit mid-task (documentation-based; live limit-hit test declined by Aziz, owed before M8)
- [x] T0.4 — Spike S2: per-task Docker sandbox running `supabase start`
- [x] T0.5 — Spike S3: Vite SPA on Cloudflare Pages + Supabase Auth MFA + Access (local phase done, 5/5 checks pass; live Cloudflare phase done 2026-11-05; only the Workers Free CPU limit is left, owned by M1 T1.11)
- [x] T0.6 — Spike S4: Telegram inline buttons → secure webhook (handler + Pages and Edge variants done, 10 unit tests + mock-API checks pass; live Telegram run done 2026-11-05 for the Pages variant; Edge Function check moved to M3)
- [x] T0.7 — Findings doc and plan amendments (findings, check script and plan amendments done; Aziz approved GO 2026-11-05)

## Milestone 1: Foundation

> Built autonomously 2026-11-05: everything that needs no owner account is done and CI is green on `main`. **Open, owner-only:** branch protection and required checks (T1.3, T1.7), the hosted Supabase project, secrets and owner user (T1.9), Access, domain and `DEPLOY_ENABLED` (T1.11), keepalive dispatch (T1.12). Steps: `docs/runbooks/m1-manual-steps.md`.

- [x] T1.1 — Monorepo scaffold, tooling, CLAUDE.md, gitleaks
- [x] T1.2 — Module-boundary lint rule with fixture test
- [ ] T1.3 — CI baseline (typecheck, lint, test) (CI green on main, red-then-green shown in docs/ci-failure-demos.md; only Aziz's branch-protection approval is open)
- [x] T1.4 — Local Supabase setup and DB scripts
- [x] T1.5 — Core schema (declarative) with pgTAP tests
- [x] T1.6 — Owner model, RLS policies and event triggers with pgTAP tests
- [ ] T1.7 — Drift check, pgTAP and type-generation checks in CI (database job green on main; drift and types red demos in docs/ci-failure-demos.md; only making it required in branch protection is open)
- [x] T1.8 — Core Zod schemas matching DB enums
- [ ] T1.9 — Hosted platform Supabase project (manual + scripted) (deploy.yml, verify-hosted.ts, runbook done; needs Aziz: Supabase project, secrets, owner user)
- [x] T1.10 — Dashboard skeleton: login, MFA, Access JWT check, empty shell
- [ ] T1.11 — Deploy to Cloudflare at hq.aziztalbi.com behind Access (wrangler config, deploy job, size gate, smoke script, runbook done; needs Aziz: Access app, domain, secrets)
- [ ] T1.12 — Keepalive workflow (keepalive.yml written; needs the hosted project and a manual dispatch)

## Milestone 2: Engine

> ✅ Completed 2026-11-05 (built autonomously). All tests passing locally and in CI (pgTAP, integration, unit, e2e). Hosted application of the new migrations happens through `deploy.yml` once the owner enables it (M1 T1.9/T1.11); nothing in M2 needs a hosted account.

- [x] T2.1 — Dependency validation, status state machine, event data hook
- [x] T2.2 — create_task_graph and create_run
- [x] T2.3 — Claim, heartbeat, complete, fail
- [x] T2.4 — Reaper, gates, run settling, tick, worker heartbeat
- [x] T2.5 — Core contracts and engine actions
- [x] T2.6 — Runner interface and FakeRunner
- [x] T2.7 — Worker: executor, loop, heartbeat, shutdown
- [x] T2.8 — Integration harness, concurrency and crashed-worker tests
- [x] T2.9 — Fake-run scenario and the full scripted run
- [x] T2.10 — Worker in local Docker
- [x] T2.11 — Dashboard: runs list and live run view
- [x] T2.12 — CI: integration tests

## Milestone 3: Human-Loop

> Built autonomously 2026-11-05: T3.1-T3.10 done, CI green (pgTAP, integration incl. the real Edge Function under Deno, unit, e2e). **Open, owner-only: T3.11** (bot, Vault secrets, function deploy, `setWebhook`, live latency/cold start/watchdog/digest checks): `docs/runbooks/telegram-setup.md`.

- [x] T3.1 — resolve_gate
- [x] T3.2 — Overrides
- [x] T3.3 — Notification outbox and watchdog logic
- [x] T3.4 — Vault, pg_net, pg_cron plumbing
- [x] T3.5 — Telegram core logic (pure modules)
- [x] T3.6 — Edge Function entry and local end-to-end
- [x] T3.7 — Dashboard: inbox and gate detail
- [x] T3.8 — Dashboard: overrides, off-today, settings
- [x] T3.9 — Daily digest and delivery policy end to end
- [x] T3.10 — CI wiring and docs
- [ ] T3.11 — Live verification [Aziz] (needs the hosted project from M1 T1.9)

## Milestone 4: Real-Agents

- [x] T4.1 — Usage policy engine [local]
- [x] T4.2 — Usage snapshots and overrides schema [local]
- [x] T4.3 — Claude stream parsing and limit detection [local]
- [x] T4.4 — Guards: loop guard, protected tests, scope [local]
- [x] T4.5 — Redaction [local]
- [x] T4.6 — ClaudeCodeSubscriptionRunner against a recorded CLI [local]
- [x] T4.7 — Worker integration: policy, limit handling, usage, transcripts [local]
- [ ] T4.8 — Transcript storage and Storage RLS [local]
- [ ] T4.9 — First real agent run [live: needs Aziz's go-ahead]
- [ ] T4.10 — Per-task Docker sandbox (A-prime) [live]
- [ ] T4.11 — Nightly backup and tested restore [live: needs R2]
- [x] T4.12 — Dashboard and Telegram for the new overrides [local]

## Milestone 5: Golden-Path

- [ ] (stub — to be detailed)

## Milestone 6: Factory-Planning

- [ ] (stub — to be detailed)

## Milestone 7: Factory-Build

- [ ] (stub — to be detailed)

## Milestone 8: First-Run

- [ ] (stub — to be detailed)
