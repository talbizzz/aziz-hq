import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'modules/*',
      'apps/*',
      { test: { name: 'scripts', include: ['scripts/**/*.test.ts'] } },
      { test: { name: 'functions', include: ['supabase/functions/**/*.test.ts'] } },
    ],
  },
});
