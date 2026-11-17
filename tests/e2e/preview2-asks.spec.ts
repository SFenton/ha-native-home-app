import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/** Where the evidence screenshots go; override with STUDIO_EVIDENCE_DIR. */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'asks-evidence');
const viewports = [['iphone', 390, 844], ['duo-portrait', 669, 951], ['duo-landscape', 951, 669], ['ipad-portrait', 820, 1180], ['ipad-landscape', 1180, 820]] as const;

/** The conditions story page before the rules (`plain=1`) and after, at every device size: the fill, the badge and the disabled tile. */
for (const [name, width, height] of viewports) {
  test(`the fill, the badge and the disabled tile at ${name} (${width}x${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mkdir(evidence, { recursive: true });
    for (const [phase, query] of [['before', '&plain=1'], ['after', '']] as const) {
      await page.goto(`/?preview2=1&fixture=asks&mode=use&bezel=0&panel=0${query}`);
      await expect(page.locator('[data-sel="node:fill-tile"]')).toBeVisible();
      const fill = await page.locator('button[data-sel="node:fill-tile"], [data-sel="node:fill-tile"] button').first().evaluate(element => (element as HTMLElement).style.getPropertyValue('--fill'));
      const badge = page.locator('[data-sel="node:badge-tile"] [data-testid="badge"]');
      const door = page.locator('[data-sel="node:door-tile"] button, button[data-sel="node:door-tile"]').first();
      if (phase === 'after') {
        expect(fill).toBe('rgb(0 110 99)');
        await expect(badge).toHaveText('3');
        await expect(door).toBeDisabled();
      } else {
        expect(fill).not.toBe('rgb(0 110 99)');
        await expect(badge).toHaveCount(0);
        await expect(door).toBeEnabled();
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${evidence}/${phase}-${name}-${width}x${height}.png`, animations: 'disabled' });
    }
  });
}
