FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
RUN corepack enable && corepack prepare pnpm@latest --activate \
  && npm install -g supabase
RUN git config --system user.name sandbox && git config --system user.email sandbox@example.invalid \
  && git config --system --add safe.directory '*'
