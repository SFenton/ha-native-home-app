import { defineConfig, devices } from '@playwright/test';

/**
 * The Studio's browser tests. The native API always authenticates, so they run their own server with a test token on
 * their own port and data directory. Both are overridable so parallel runs never collide; `STUDIO_E2E_DATA` is the
 * older name of the data override and still works.
 */
const port = process.env.STUDIO_E2E_PORT ?? '4815';
const dataDir = process.env.STUDIO_E2E_DATA_DIR ?? process.env.STUDIO_E2E_DATA ?? './test-results/studio-data';
const token = 'e2e-token-for-workspace2-tests-0001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', extraHTTPHeaders: { Authorization: `Bearer ${token}` } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // The workspace specs also run at phone size with touch; the preview story page is a desktop study.
    { name: 'phone', testMatch: /workspace2-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `STUDIO_AUTH_TOKEN=${token} PORT=${port} DATA_DIR=${dataDir} npm run dev`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
