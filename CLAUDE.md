# Aziz HQ: rules for agents working in this repo

Plan: [Project-Plan.md](Project-Plan.md). Current work: the milestone named in [TODO.md](TODO.md). Spike results: [docs/spikes/FINDINGS.md](docs/spikes/FINDINGS.md) (where it contradicts a milestone file, FINDINGS wins and the milestone file gets a `> **Plan updated:**` note).

## Hard rules

- **Local Supabase only for tests.** Never touch the hosted database from tests or scripts you run by hand.
- **Explicit hosted target.** `pnpm db:push` needs `SUPABASE_PROJECT_REF` and a `SUPABASE_DB_URL` that belongs to it (`supabase db push` has no `--project-ref`); other CLI commands take the ref from the environment. Never run `supabase link`.
- **Schema changes only in `supabase/schemas/`**, then generate the migration with `pnpm db:diff`. The only hand-written migrations are the ones listed in [docs/MANUAL_MIGRATIONS.md](docs/MANUAL_MIGRATIONS.md).
- **Module boundaries (ADR-8, lint-enforced):** `modules/*` import only from `packages/*` and themselves; `packages/*` never import `apps/*` or `modules/*`; cross-workspace imports use package entry points (`@aziz-hq/core`), never another workspace's `src/`.
- **Manual migrations are mirrored in the schemas** when the diff tool tracks the object (publication membership, default ACLs); it never emits REVOKEs, so revokes live in a listed manual migration. Run `supabase db diff` after `db:reset`: it must print "No schema changes found".
- **Every new table needs explicit grants** in `supabase/schemas/15_grants.sql` (default privileges are revoked by a manual migration); RLS on, `anon` gets nothing.
- **Test as the role that runs the code.** pgTAP runs as the superuser; the worker is `service_role` and the dashboard `authenticated`. New functions need explicit grants for the role that executes them (including helpers called from triggers) and a pgTAP case that runs the flow as that role (see `supabase/tests/service_role_test.sql`).
- **Regenerate the DB types with every schema change:** after `pnpm db:diff` + `pnpm db:reset`, run `pnpm db:types` and commit `packages/core/src/db/types.ts` in the same commit (CI's types check fails otherwise).
- **`pnpm db:reset` before `pnpm db:test`:** e2e and integration runs leave data (an owner, runs) in the local database that the older pgTAP files do not expect; CI always resets first.
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
