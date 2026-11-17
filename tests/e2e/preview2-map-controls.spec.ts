import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mapctlScenarios } from '../../src/preview2/fixtures/mapctl-story';

/**
 * vacuum-map-ctl in the simulator: each scenario of the demo story on the iPhone, the Duo opened and the iPad, in light and dark. The groups sit where the app
 * puts them (44 pt buttons, 8 pt in), a flip mirrors the schematic and never a button, and eight buttons on the iPhone leave More. Screenshots go to
 * `STUDIO_EVIDENCE_DIR` when it is set.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'map-controls');
const windows = [['iphone', 'iPhone'], ['duo', 'Duo open, upright'], ['ipad', 'iPad upright']] as const;
test.use({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 2 });
test.beforeEach(() => { test.slow(); });
const patient = { timeout: 20_000 };

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const [short, name] of windows) for (const scenario of mapctlScenarios) {
      test(`${scenario} on the ${short}`, async ({ page }) => {
        await mkdir(evidence, { recursive: true });
        await page.goto(`/?preview2=1&fixture=mapctl&scenario=${scenario}&mode=use&panel=0&bezel=0&window=${encodeURIComponent(name)}`);
        const map = page.locator('.sh-dv-map').first();
        await expect(map).toBeVisible(patient);
        if (scenario === 'default') {
          await expect(page.locator('.sh-dv-ctl')).toHaveCount(1);
          // The simulator scales the device to its host, so measure in points: the button is 44 of them, and 8 in from the card's top and leading edges. Poll: the scale settles after layout.
          await expect.poll(async () => {
            const box = (await page.locator('.sh-dv-ctl').boundingBox())!, card = (await map.boundingBox())!, scale = box.width / 44;
            return Math.max(Math.abs(box.height / scale - 44), Math.abs((box.x - card.x) / scale - 8), Math.abs((box.y - card.y) / scale - 8));
          }, patient).toBeLessThan(.8);
        }
        if (scenario === 'row-of-three') await expect(page.locator('.sh-dv-ctl[data-corner="top-trailing"] button')).toHaveCount(3);
        if (scenario === 'column-of-two') await expect(page.locator('.sh-dv-map-tag')).toHaveAttribute('data-at', 'center');
        if (scenario.startsWith('flip')) await expect(map).toHaveAttribute('data-flip', scenario === 'flip-both' ? 'both' : scenario.slice(5));
        if (scenario === 'more' && short === 'iphone') await expect(page.getByRole('button', { name: 'More Map Controls' })).toHaveCount(2);
        await page.waitForTimeout(300);
        await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${scenario}-${short}-${scheme}.png`, animations: 'disabled' });
        if (scenario === 'more' && short === 'iphone') {
          await page.getByRole('button', { name: 'More Map Controls' }).last().click();
          await expect(page.getByRole('menuitemradio').first()).toBeVisible();
          await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/more-open-${short}-${scheme}.png`, animations: 'disabled' });
        }
      });
    }
  });
}
