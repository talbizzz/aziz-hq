# TODO

## Milestone 0: Spikes

- [x] T0.1 — Initialise git repo and private GitHub remote
- [x] T0.2 — Spike S1: does headless `claude -p` expose usage / rate limits?
- [x] T0.3 — Spike S5: behaviour when a plan limit is hit mid-task (documentation-based; live limit-hit test declined by Aziz, owed before M8)
- [x] T0.4 — Spike S2: per-task Docker sandbox running `supabase start`
- [ ] T0.5 — Spike S3: Vite SPA on Cloudflare Pages + Supabase Auth MFA + Access (local phase done, 5/5 checks pass; Cloudflare phase needs Aziz's credentials; moved to M1 T1.11)
- [ ] T0.6 — Spike S4: Telegram inline buttons → secure webhook (handler + Pages and Edge variants done, 10 unit tests + mock-API checks pass; live bot/Access/latency needs Aziz; moved to M3)
- [ ] T0.7 — Findings doc and plan amendments (findings, check script and plan amendments done; waiting for Aziz's go/no-go approval)

## Milestone 1: Foundation

- [ ] T1.1 — Monorepo scaffold, tooling, CLAUDE.md, gitleaks
- [ ] T1.2 — Module-boundary lint rule with fixture test
- [ ] T1.3 — CI baseline (typecheck, lint, test)
- [ ] T1.4 — Local Supabase setup and DB scripts
- [ ] T1.5 — Core schema (declarative) with pgTAP tests
- [ ] T1.6 — Owner model, RLS policies and event triggers with pgTAP tests
- [ ] T1.7 — Drift check, pgTAP and type-generation checks in CI
- [ ] T1.8 — Core Zod schemas matching DB enums
- [ ] T1.9 — Hosted platform Supabase project (manual + scripted)
- [ ] T1.10 — Dashboard skeleton: login, MFA, Access JWT check, empty shell
- [ ] T1.11 — Deploy to Cloudflare at hq.aziztalbi.com behind Access
- [ ] T1.12 — Keepalive workflow

## Milestone 2: Engine

- [ ] (stub — to be detailed)

## Milestone 3: Human-Loop

- [ ] (stub — to be detailed)

## Milestone 4: Real-Agents

- [ ] (stub — to be detailed)

## Milestone 5: Golden-Path

- [ ] (stub — to be detailed)

## Milestone 6: Factory-Planning

- [ ] (stub — to be detailed)

## Milestone 7: Factory-Build

- [ ] (stub — to be detailed)

## Milestone 8: First-Run

- [ ] (stub — to be detailed)
