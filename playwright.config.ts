import { defineConfig, devices } from '@playwright/test';

/** The suite owns this port and data directory; `STUDIO_E2E_PORT` and `STUDIO_E2E_DATA` move it off a Studio someone else is running. */
const port = Number(process.env.STUDIO_E2E_PORT ?? 4801);
const data = process.env.STUDIO_E2E_DATA ?? './test-results/studio-data';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${port} DATA_DIR=${data} npm run dev`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
