# Milestone 8: First-Run

> Stub — detail with project-plan before starting.

> **Plan updated:** add to scope (2026-11-03): repeat `spikes/s2/check.sh` (design A-prime) on the VPS first; run the owed live plan-limit capture (S5) and replace the documented fixtures; pin the Supabase CLI version in the worker image.

## Goal

The factory builds something small while Aziz's laptop is off.

## Scope

### In Scope

- Re-run spike S2 check on the netcup VPS before anything else (pre-mortem #7); provision VPS, worker image via GHCR, hardening, Tailscale/Tunnel or IP-restricted SSH.
- Infisical Cloud EU: folders, machine identity, secrets health page, rotation/reminder gates.
- Verify backups; re-check Anthropic terms for subscription use at this volume (Project-Raw.md open question).
- Tiny test project end to end.

### Out of Scope

- Anything not required for the end-to-end run (3D, other modules).

## Depends on

Milestone 7.

## Done Criteria

- Tiny project goes idea → released with laptop off, Aziz acting only at gates.
- Success criteria in Project-Raw.md met or measured (usage floors, cost ≈ €10/month, no secret leaks).
