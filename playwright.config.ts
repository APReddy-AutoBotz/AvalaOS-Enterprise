import { defineConfig, devices } from '@playwright/test';
import { CSP_REPORTS_FILE } from './tests/e2e/cspReports.ts';

// Browser tests for the process journey. They build the app with the in-browser store
// (VITE_JOURNEY_STORE=memory) so they need no server; database rules are tested in supabase/tests.
export default defineConfig({
  testDir: 'tests/e2e',
  // Every page runs under the site's content security policy; the run fails on a breach no test made on
  // purpose (tests/e2e/cspReports.ts, the preview server's reports in vite.config.ts).
  globalSetup: './tests/e2e/cspSetup.ts',
  globalTeardown: './tests/e2e/cspTeardown.ts',
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
    command: 'npm run build:e2e && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort',
    env: { VITE_JOURNEY_STORE: 'memory', CSP_REPORTS_FILE },
    url: 'http://127.0.0.1:4173/signin',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
