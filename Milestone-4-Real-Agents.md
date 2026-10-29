# Milestone 4: Real-Agents

> Stub — detail with project-plan before starting.

## Goal

A real agent completes a small coding task in a sandbox and respects limits and overrides.

## Scope

### In Scope

- `ClaudeCodeSubscriptionRunner` (`claude -p`, usage source and limit detection per spike S1/S5).
- Per-task Docker sandbox per spike S2 (worktree, resource limits, network allowlist, scoped dev secrets via local `.env.worker`, push-only egress).
- Usage policy: 5-hour caps by time of day, weekly pacing + ceiling, overrides applied (stop after current turn and commit), pause/resume at limits.
- Loop guards, protected tests check (worker rejects diffs that modify existing tests), orchestrator-on-failure hook.
- Transcripts to Storage, `usage` table filled, secret redaction.
- Nightly encrypted `pg_dump` to R2 + tested restore (ADR-7).

### Out of Scope

- Infisical (M8). Golden-path template (M5).

## Depends on

Milestone 3 (and spike findings S1, S2, S5).

## Done Criteria

- Real small coding task completed in a sandbox with transcript and usage recorded.
- Hitting a (simulated) limit pauses and auto-resumes; each override mode takes effect immediately.
- Requirements 9–13, 18 (platform DB) covered by tests. Pre-mortem #2, #5, #6 mitigations verified.
