import { chromium, type FullConfig } from '@playwright/test';

/**
 * Loads the workspace once before any test runs. The first browser request to a fresh dev server makes Vite pre-bundle its dependencies and
 * transform the whole app (and may reload the page once when it finds more to bundle), which takes longer than a test's five-second wait for
 * the Publish button; whichever test ran first on a cold start failed there. The wait here is for the real condition, the app drawn with its
 * draft, with the whole test timeout as its limit, and it runs before the clock of any test starts. A production build has nothing to warm.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const { baseURL, extraHTTPHeaders } = config.projects[0].use;
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ baseURL, extraHTTPHeaders })).newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Publish' }).waitFor({ state: 'visible', timeout: 60_000 });
  } finally { await browser.close(); }
}
