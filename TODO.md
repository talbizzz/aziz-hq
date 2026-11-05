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
