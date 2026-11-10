# Runbook: the per-task Docker sandbox (T4.10)

Topology A-prime (spike S2): the **worker** starts a slim Supabase stack per task; the **agent container** has no Docker socket, is read-only, non-root and capability-free, and sits alone on an internal-only network. Only that stack's database and API gateway and an allowlist proxy are connected to the network. Code: `apps/worker/src/sandbox/` (`plan.ts` pure names/ports/arguments, `sandbox.ts` lifecycle). Images: `docker/sandbox/`.

## Build the images (once, and after changing the Dockerfiles)

```
docker build -t aziz-hq-sandbox-agent:local -f docker/sandbox/agent.Dockerfile docker/sandbox
docker build -t aziz-hq-sandbox-proxy:local docker/sandbox/proxy
```

The agent image pins the Supabase CLI to the repo's version (2.109.1) and pnpm to the repo's `packageManager`; change them together with the repo. The proxy allowlist is `docker/sandbox/proxy/allowlist.txt` (GitHub, npm registry, Anthropic, public.ecr.aws).

## Live check (manual, never in CI)

1. Docker must be the Colima `s2` profile (3 CPU / 3 GiB). **Stop the local Supabase stack first** (`pnpm db:stop`): two sandboxes plus the dev stack do not fit in 3 GiB. Restart it afterwards (`pnpm db:start`).
2. `pnpm --filter @aziz-hq/worker exec tsx scripts/sandbox-check.ts --slots=1,2`

It starts the sandboxes, asserts from inside each agent container (own database reachable; no route to the internet, not even by raw IP; GitHub reachable and other hosts refused through the proxy; no Docker socket; read-only root; uid 1000; no secret-looking variables; memory limit enforced; commit and push work; slots cannot reach each other), prints memory, tears down and verifies that no containers, networks or volumes are left.

## Known gotchas

- **Colima stops forwarding newly published ports** after the VM has run for days: `supabase start` then fails with `dial tcp 127.0.0.1:544xx: connection refused`. Check with a throwaway container publishing a port; fix with `colima restart s2` (never touch the `default` profile, it belongs to another project).
- Slots are 1-9 (ports base + 100 per slot); slot 0 is the host's own stack.
- The Claude credential is not delivered yet: how it reaches the container is the open decision in `Milestone-4-Real-Agents.md` T4.10 and Project-Plan risk 10 (the agent can read the token inside its container).
