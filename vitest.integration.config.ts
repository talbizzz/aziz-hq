import { defineConfig } from 'vitest/config';

// Integration tests run against the local Supabase stack (`pnpm db:start && pnpm db:reset`) and spawn real workers.
export default defineConfig({
  test: {
    include: ['apps/**/test/**/*.integration.ts', 'supabase/functions/**/*.integration.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
