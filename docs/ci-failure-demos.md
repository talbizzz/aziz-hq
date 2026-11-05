# CI failure-mode demos (T1.3, T1.7)

Throwaway PR #1 (closed without merging, branch deleted), 2026-11-05. Each state was pushed to the PR branch.

| State                                                                    | Run                                                          | Result                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: a type error plus a schema edit without a migration                   | https://github.com/talbizzz/aziz-hq/actions/runs/42023836788 | `typecheck, lint, test` red (`TS2322`), `database` red at **Drift check** (`ALTER TABLE public.modules ADD COLUMN demo_note text`). `gitleaks` was also red: a real workflow bug (the action needs `pull-requests: read`), fixed in `7d3e39f`.                                                                                               |
| B: drift fixed with a generated migration, generated types not refreshed | https://github.com/talbizzz/aziz-hq/actions/runs/42024578991 | `database` red at **Generated types are up to date** (`+ demo_note: string \| null`). `web (e2e)` was red from a CI-only problem (the CLI installed by setup-cli was not the pinned version, so the `-x` exclude names were invalid and the full stack hit a registry rate limit): fixed in `982d537` by pinning the CLI as a devDependency. |
| C: types regenerated, on top of the fixes                                | https://github.com/talbizzz/aziz-hq/actions/runs/42025975548 | all four jobs green                                                                                                                                                                                                                                                                                                                          |
| `main` after the CLI pin                                                 | https://github.com/talbizzz/aziz-hq/actions/runs/42025232451 | all four jobs green                                                                                                                                                                                                                                                                                                                          |

Still owner-only: making the four checks **required** in branch protection (see `docs/runbooks/m1-manual-steps.md`).

## Integration tests (T2.12)

Throwaway PR #2 (closed without merging, branch deleted): the worker stopped calling `scheduler_tick`, so lease reaping and gate opening stop.

| State                            | Run                                                          | Result                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| worker without the tick          | https://github.com/talbizzz/aziz-hq/actions/runs/42033282984 | `database` red at **Integration tests** (the crashed-worker and fake-run scenarios time out), `typecheck, lint, test` red (the loop unit test) |
| `main` with the integration step | https://github.com/talbizzz/aziz-hq/actions/runs/42032485646 | all four jobs green                                                                                                                            |

## Telegram delivery policy (T3.10)

Throwaway PR #3 (closed without merging, branch deleted): the delivery policy ignored quiet hours and "off today".

| State                                              | Run                                                          | Result                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| policy ignores quiet hours                         | https://github.com/talbizzz/aziz-hq/actions/runs/42039651362 | `typecheck, lint, test` red (policy unit tests), `database` red at **Integration tests** (the Edge Function e2e: a normal gate was sent at 23:30 instead of deferred) |
| `main` with the Telegram, inbox and overrides work | https://github.com/talbizzz/aziz-hq/actions/runs/42039635407 | all four jobs green                                                                                                                                                   |
