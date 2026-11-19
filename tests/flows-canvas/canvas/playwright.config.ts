import { defineConfig } from '@playwright/test';
import path from 'node:path';
import base from '../../../playwright.config';

if (process.env.STUDIO_E2E_PORT !== '4822' || process.env.STUDIO_E2E_DATA_DIR !== './test-results/studio-data/w2-c') {
  throw new Error('Canvas tests require STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c');
}
export default defineConfig({
  ...base, testDir: path.resolve('tests/e2e'), testMatch: 'workspace2-flows-canvas.spec.ts', globalSetup: undefined,
  projects: base.projects?.map(project => ({ ...project, testDir: path.resolve('tests/e2e'), testMatch: 'workspace2-flows-canvas.spec.ts' })),
  webServer: {
    cwd: path.resolve('.'),
    command: 'npx vite --host 127.0.0.1 --port 4822 --strictPort',
    url: 'http://127.0.0.1:4822/tests/flows-canvas/canvas/harness.html',
    reuseExistingServer: false,
  },
});
