import { defineConfig } from '@playwright/test';
import path from 'node:path';
import base from '../../../playwright.config';

const port = Number(process.env.STUDIO_E2E_PORT ?? '4822');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIO_E2E_PORT must be a valid TCP port.');
const dataDir = process.env.STUDIO_E2E_DATA_DIR ?? process.env.STUDIO_E2E_DATA ?? './test-results/studio-data/w2-c';
export default defineConfig({
  ...base, testDir: path.resolve('tests/e2e'), testMatch: 'workspace2-flows-canvas.spec.ts', globalSetup: undefined,
  projects: base.projects?.map(project => ({ ...project, testDir: path.resolve('tests/e2e'), testMatch: 'workspace2-flows-canvas.spec.ts' })),
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    cwd: path.resolve('.'),
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/flows-canvas/canvas/harness.html`,
    env: { STUDIO_E2E_PORT: String(port), STUDIO_E2E_DATA_DIR: dataDir },
    reuseExistingServer: false,
  },
});
