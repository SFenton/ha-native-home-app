import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mapctlStory, type MapctlScenario } from '../../src/preview2/fixtures/mapctl-story';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import { openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * vacuum-map-ctl in the inspector: a map's Orientation and Map Buttons groups, the flip writing the vacuum source (and mirroring the simulator), a button's
 * page ringing it in the preview, and the warning that a smaller family puts buttons behind More.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const story = (scenario: MapctlScenario) => mapctlStory(fixture.document, scenario).document;
test.use({ actionTimeout: 8000 });
const select = (page: import('@playwright/test').Page) => previewRoot(page).locator('[data-sel="node:demo-map"]').first().click();

for (const scheme of ['light', 'dark'] as const) {
  test(`the map's inspector: orientation, buttons and a page (${scheme})`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await seed(request, story('row-of-three'));
    await openWorkspace(page);
    await select(page);
    const panel = page.getByLabel('Properties');
    await expect(panel.getByRole('switch', { name: 'Flip Horizontally' })).toBeVisible();
    await expect(panel.getByRole('group', { name: 'Top Trailing', exact: true })).toBeVisible();
    await panel.getByRole('switch', { name: 'Flip Horizontally' }).check();
    await expect(previewRoot(page).locator('.sh-dv-map').first()).toHaveAttribute('data-flip', 'horizontal');
    await expect(previewRoot(page).locator('.sh-dv-ctl[data-corner="top-trailing"]')).toBeVisible();
    await snap(page, `inspector-${scheme}`);
    await panel.getByRole('button', { name: /^Kitchen Lights:/ }).click();
    await expect(previewRoot(page).locator('[data-control="lights"]')).toHaveAttribute('data-ringed', '');
    await snap(page, `inspector-button-${scheme}`);
  });
}

test('a click on a button in the simulator while editing opens its page', async ({ page, request }) => {
  await seed(request, story('row-of-three'));
  await openWorkspace(page);
  await select(page);
  await previewRoot(page).locator('[data-control="lights"]').click();
  await expect(page.getByTestId('map-button-page')).toBeVisible();
});

test('two rows of four warn about the iPhones that need More, and refuse nothing', async ({ page, request }) => {
  await seed(request, story('more'));
  await openWorkspace(page);
  await select(page);
  await expect(page.getByTestId('map-overflow')).toHaveText([
    'On the smallest iPhone, 4 buttons move into More (Top Leading, Top Trailing).', 'On the iPhone, 4 buttons move into More (Top Leading, Top Trailing).']);
});
