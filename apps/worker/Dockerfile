# Build context: the repository root (see docker-compose.worker.yml).
FROM node:24-slim

RUN corepack enable
WORKDIR /repo

# install only what the worker needs, from the lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps
COPY packages ./packages
COPY modules ./modules
RUN pnpm install --frozen-lockfile --prod --filter "@aziz-hq/worker..." --ignore-scripts \
  && chown -R node:node /repo

USER node
ENV NODE_ENV=production
# tsx is a dependency of the worker package, so resolve it from there
WORKDIR /repo/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
