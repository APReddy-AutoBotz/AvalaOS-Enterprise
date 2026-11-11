import { defineConfig, devices } from '@playwright/test';

// Browser tests for the process journey. They build the app with the in-browser store
// (.env.e2e) so they need no server; database rules are tested in supabase/tests.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:e2e && npx vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/signin',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
