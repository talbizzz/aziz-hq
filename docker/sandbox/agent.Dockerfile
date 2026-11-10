# The agent container of the per-task sandbox (T4.10, topology A-prime). No Docker CLI and no socket: the worker owns Docker.
# The Supabase CLI is pinned to the version in the repo's devDependencies (spike S2 found a skew: 2.109.1 on the host vs 3.0.0).
FROM node:24-slim
ARG SUPABASE_CLI_VERSION=2.109.1
ARG PNPM_VERSION=11.21.0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl postgresql-client \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g supabase@${SUPABASE_CLI_VERSION} pnpm@${PNPM_VERSION} --loglevel=error \
  && git config --system user.name sandbox && git config --system user.email sandbox@example.invalid \
  && git config --system --add safe.directory '*'
# runs as uid 1000 (the built-in `node` user); the run arguments pass --user 1000:1000, --read-only and tmpfs for HOME and /tmp
USER 1000:1000
