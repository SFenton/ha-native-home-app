import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/** Where the evidence screenshots go; override with STUDIO_EVIDENCE_DIR. */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-devices');
/** A phone-width window, tall enough to show a whole fixture page without scrolling. */
test.use({ viewport: { width: 402, height: 3400 }, deviceScaleFactor: 2 });
// The tall window is slow to draw when the machine is busy.
test.beforeEach(() => { test.slow(); });
const patient = { timeout: 20_000 };

const pages = [
  ['settings', 'page-settings', 'Settings'], ['vacuum', 'page-vacuum', 'Vacuum'], ['custom-light', 'page-lights', 'Custom Lights'],
  ['climate', 'page-climate', 'Climate'], ['sprinkler', 'page-sprinklers', 'Sprinklers'], ['remote', 'page-remote', 'Remote'],
] as const;

for (const [name, page, title] of pages) {
  test(`the ${name} controls draw from the device fixture, are selectable in Edit and never show the placeholder`, async ({ page: browser }) => {
    await mkdir(evidence, { recursive: true });
    await browser.goto(`/?preview2=1&fixture=devices&panel=0&bezel=0&surface=page:${page}`);
    await expect(browser.locator('.sh-page[data-current] .sh-large-title')).toHaveText(title, patient);
    await expect(browser.locator('.sh-placeholder')).toHaveCount(0, patient);
    const first = browser.locator(`.sh-page[data-current] [data-type=${name}-control]`).first();
    await first.click();
    await expect(first).toHaveAttribute('data-selected', '', patient);
    await browser.waitForTimeout(400);
    await browser.getByTestId('preview2-host').screenshot({ path: `${evidence}/${name}-edit.png`, animations: 'disabled' });
  });
}
