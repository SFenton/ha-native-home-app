import path from 'node:path';
import { defineConfig } from '@playwright/test';
import config from '../../playwright.config';

export default defineConfig({
  ...config,
  testDir: path.resolve('tests/e2e'),
  testMatch: /(?:flows-tab|data-tab).*\.spec\.ts/,
  outputDir: path.resolve('test-results/lane-b-run'),
  globalSetup: undefined,
  webServer: undefined,
  projects: config.projects?.filter(project => project.name === 'desktop'),
});
