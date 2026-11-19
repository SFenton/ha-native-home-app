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
  globalSetup: './tests/e2e/warm-up.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // CI shards write blob reports that one job merges into one HTML report.
  reporter: process.env.CI ? [['blob'], ['list']] : 'list',
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', extraHTTPHeaders: { Authorization: `Bearer ${token}` } },
  projects: [
    // STUDIO_E2E_GPU=1 runs the desktop project on the machine's GPU (ANGLE over Metal) instead of the software renderer CI uses; frame pacing is judged there.
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(process.env.STUDIO_E2E_GPU ? { launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } } : {}) } },
    // S1 (`sim-blank`): the Duo rig in WebKit, on demand only (`STUDIO_E2E_WEBKIT=1 npx playwright test --project=webkit`); CI keeps Chromium.
    ...(process.env.STUDIO_E2E_WEBKIT ? [{ name: 'webkit', testMatch: /preview2-(duo-webkit|rails-evidence)\.spec\.ts/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }] : []),
    // The workspace specs also run at phone size with touch; the preview story page is a desktop study.
    { name: 'phone', testMatch: /(?:workspace2-.*|flows-tab.*|data-tab.*)\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    // STUDIO_E2E_PROD=1 runs the built app (after `npm run build`): frame pacing is measured on it, not on React's development build.
    command: `STUDIO_AUTH_TOKEN=${token} PORT=${port} DATA_DIR=${dataDir} npm run ${process.env.STUDIO_E2E_PROD ? 'start' : 'dev'}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
