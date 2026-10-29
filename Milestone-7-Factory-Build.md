# Milestone 7: Factory-Build

> Stub — detail with project-plan before starting.

## Goal

An approved plan becomes a working app on dev, releasable via the gate.

## Scope

### In Scope

- Test agent → Builder → QA → Reviewer → CI → auto-merge to `develop`; lanes (database, functions, web, mobile, QA); 2–3 tasks in parallel.
- Escalation ladder, milestone review gate, release gate (+ first-release checklist), prod deploy via GitHub `production` environment, EAS fingerprint/OTA flow, maintenance triage from Sentry webhooks.

### Out of Scope

- First real run on netcup (M8).

## Depends on

Milestone 6.

## Done Criteria

- Approved plan builds into a working app on dev; release gate performs the prod deploy sequence (tested on a throwaway project).
- Requirements 14–17 covered.
