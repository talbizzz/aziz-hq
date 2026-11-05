import { defineConfig } from '@playwright/test';
import { localSupabase } from './e2e/local-supabase';

const supabase = localSupabase();

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: supabase.url,
      VITE_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
    },
  },
});
