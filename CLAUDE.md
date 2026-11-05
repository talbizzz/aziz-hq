# Aziz HQ: rules for agents working in this repo

Plan: [Project-Plan.md](Project-Plan.md). Current work: the milestone named in [TODO.md](TODO.md). Spike results: [docs/spikes/FINDINGS.md](docs/spikes/FINDINGS.md) (where it contradicts a milestone file, FINDINGS wins and the milestone file gets a `> **Plan updated:**` note).

## Hard rules

- **Local Supabase only for tests.** Never touch the hosted database from tests or scripts you run by hand.
- **Project ref from the environment.** Pass `--project-ref "$SUPABASE_PROJECT_REF"` explicitly. Never run `supabase link`.
- **Schema changes only in `supabase/schemas/`**, then generate the migration with `pnpm db:diff`. The only hand-written migrations are the ones listed in [docs/MANUAL_MIGRATIONS.md](docs/MANUAL_MIGRATIONS.md).
- **Module boundaries (ADR-8, lint-enforced):** `modules/*` import only from `packages/*` and themselves; `packages/*` never import `apps/*` or `modules/*`; cross-workspace imports use package entry points (`@aziz-hq/core`), never another workspace's `src/`.
- **No secrets** in the repo, docs, commits or logs. Names only in `.env.example`. gitleaks runs in the pre-commit hook and in CI.
- **Production is off limits** (migrations, deploys, data changes) unless the owner explicitly asks in that session.

## Working style

1. Think before coding: state assumptions, surface ambiguity.
2. Simplicity first: the smallest change that meets the spec, no speculative abstractions.
3. Surgical changes: touch only what the task requires; note nearby problems instead of fixing them.
4. Goal-driven: tests first, then make them pass. Never weaken or delete an existing test to get green.
5. **Scope guard:** an idea outside the current milestone's scope goes into [docs/parking-lot.md](docs/parking-lot.md), not into code.

## Conventions

- pnpm workspace (`apps/*`, `packages/*`, `modules/*`) with Turborepo; one version of TypeScript, ESLint, Prettier, Zod and Vitest, all pinned in the `catalog:` of `pnpm-workspace.yaml`.
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESM, kebab-case file names, feature folders.
- Conventional commits (`feat(scope): T1.3 ...`), enforced by commitlint. One commit per task; tick the task in TODO.md.
- Node version in `.nvmrc`; pnpm via the `packageManager` field.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; database work also `pnpm db:test`.
- All UI strings are English.
