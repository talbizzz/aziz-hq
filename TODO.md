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

> M1 complete 2026-11-06: hosted Supabase (20 migrations), owner, keepalive and the Cloudflare deploy behind Access are live. Workers Free CPU limit for the Access middleware is still to watch (see S3).

- [x] T1.1 — Monorepo scaffold, tooling, CLAUDE.md, gitleaks
- [x] T1.2 — Module-boundary lint rule with fixture test
- [x] T1.3 — CI baseline (typecheck, lint, test) (done 2026-11-06: CI green, red-then-green in docs/ci-failure-demos.md; repo made public by Aziz so branch protection is available; protection active on main)
- [x] T1.4 — Local Supabase setup and DB scripts
- [x] T1.5 — Core schema (declarative) with pgTAP tests
- [x] T1.6 — Owner model, RLS policies and event triggers with pgTAP tests
- [x] T1.7 — Drift check, pgTAP and type-generation checks in CI (database job green on main; drift and types red demos in docs/ci-failure-demos.md; branch protection now requires the four checks, 2026-11-06)
- [x] T1.8 — Core Zod schemas matching DB enums
- [x] T1.9 — Hosted platform Supabase project (manual + scripted) (project, 20 migrations incl. API lockdown, secrets, owner user, verify-hosted 15/15; done 2026-11-06)
- [x] T1.10 — Dashboard skeleton: login, MFA, Access JWT check, empty shell
- [x] T1.11 — Deploy to Cloudflare at hq.aziztalbi.com behind Access (live 2026-11-06: Pages project, domain, Access app, deploy job green, smoke-prod 5/5, owner login with MFA confirmed by Aziz)
- [x] T1.12 — Keepalive workflow (manual dispatch green against hosted, 2026-11-06)

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
- [x] T3.11 — Live verification [Aziz] (mostly done 2026-11-07/09, evidence in docs/spikes/evidence/M3-live-telegram.md; open: latency numbers, a second real account, digest confirmation. Found and fixed pg_net missing on hosted and a 500 on rejected callbacks)

## Milestone 4: Real-Agents

- [x] T4.1 — Usage policy engine [local]
- [x] T4.2 — Usage snapshots and overrides schema [local]
- [x] T4.3 — Claude stream parsing and limit detection [local]
- [x] T4.4 — Guards: loop guard, protected tests, scope [local]
- [x] T4.5 — Redaction [local]
- [x] T4.6 — ClaudeCodeSubscriptionRunner against a recorded CLI [local]
- [x] T4.7 — Worker integration: policy, limit handling, usage, transcripts [local]
- [x] T4.8 — Transcript storage and Storage RLS [local] (bucket + owner-read policy, StorageTranscriptSink wired into the worker; pgTAP, unit and Storage integration tests green; hosted migration applies on merge)
- [x] T4.9 — First real agent run [live] (done 2026-11-09 with the owner's go-ahead: a tiny Haiku task through the runner, ~$0.003; fixtures captured, FINDINGS updated; found and fixed the macOS USER login bug. Open: a full worker run with transcript storage and the separate worker login)
- [ ] T4.10 — Per-task Docker sandbox (A-prime) [live] (core built and verified live 2026-11-10: plan + lifecycle + images + 26-assertion live check, docs/runbooks/sandbox.md; open: worker integration (SandboxRunner), the Claude credential decision, RAM under real load, VPS run)
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
