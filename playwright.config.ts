import { defineConfig, devices } from '@playwright/test';

/** Port and data directory are overridable so parallel runs never collide; the defaults are the shared test studio. */
const port = process.env.STUDIO_E2E_PORT ?? '4801';
const dataDir = process.env.STUDIO_E2E_DATA_DIR ?? './test-results/studio-data';

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Phone-sized touch run of the preview-edge checks only.
    { name: 'phone', testMatch: /preview-edge\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: `PORT=${port} DATA_DIR=${dataDir} npm run dev`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
