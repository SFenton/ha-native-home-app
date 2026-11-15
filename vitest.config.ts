import { defineConfig } from 'vitest/config';

// Pin the zone and locale before workers spawn: date snapshots (History dialog) format with
// toLocaleString(), so they must not depend on the machine running the suite.
process.env.TZ = 'America/Los_Angeles';
process.env.LC_ALL = 'en_US.UTF-8';
process.env.LANG = 'en_US.UTF-8';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    environment: 'node',
  },
});
