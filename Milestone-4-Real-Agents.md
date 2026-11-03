# Milestone 4: Real-Agents

> Stub — detail with project-plan before starting.

> **Plan updated:** M0 findings for this milestone (2026-11-03). (1) Usage source: run `claude -p --output-format stream-json --verbose` and read the `rate_limit_event` (`unifiedWindows.five_hour|seven_day.utilization`, `resetsAt`); fallback `total_cost_usd`. (2) Limit detection: `classifyClaudeFailure` from `spikes/s5/detect.ts` (exit code is not trusted; `is_error:true` with exit 0 is possible); pause until `resetsAt` or 30 min; reset the task worktree before retry; replace the documented fixtures with a live capture. (3) Sandbox = design A-prime (worker starts a slim Supabase stack per task, ports +100 per slot, `docker update` limits, agent container without `docker.sock`, egress allowlist proxy, `docker rm -v`); 2 parallel tasks, 3 max on netcup. (4) Pin the Supabase CLI version in the worker image (host 2.109.1 vs npm 3.0.0 pull different images). (5) Use `CLAUDE_CONFIG_DIR` for the worker login; quota is per account, not per directory. Open: peak RAM under load, minimum limits, GitHub push credential.

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
