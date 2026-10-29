# Milestone 2: Engine

> Stub — detail with project-plan before starting.

## Goal

A fake run flows end to end through the scheduler and is visible live in the dashboard.

## Scope

### In Scope

- Scheduler: claim RPC (`FOR UPDATE SKIP LOCKED`), dependency resolution, leases, expired-lease reaper, retries, attempts.
- Task graph creation with validation (dependencies exist, no cycles) — see ADR-3.
- Gates as tasks (`waiting_human`); only dependents wait.
- `Runner` interface + `FakeRunner` (scripted outcomes, zero cost) in `packages/agents-sdk`.
- `apps/worker` in local Docker with heartbeat every minute.
- Dashboard run view: live task graph, statuses, roles, event timeline (Realtime, ADR-4).

### Out of Scope

- Real agents, sandboxes, usage policy (M4). Telegram, gates inbox actions (M3).

## Depends on

Milestone 1.

## Done Criteria

- A scripted fake run (parallel tasks, a failing-then-retried task, a gate, a crashed worker whose lease expires) completes end to end.
- Requirements 5, 6, 7 covered by tests (pgTAP + integration).
- Dashboard shows the run live within a few seconds.
- Pre-mortem #1/#3: runner interface in place.
