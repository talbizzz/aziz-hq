import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true },
  // Playwright specs in e2e/ are run by `pnpm test:e2e`, not by Vitest.
  test: { exclude: ['e2e/**', '**/node_modules/**'] },
});
