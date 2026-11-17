import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addStateTile, duplicateStyle, newStateTile } from '../../src/shared/composition/state-style-library';
import { builtInStyle } from '../../src/shared/composition/state-styles';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

const home = (JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string }[]; stateStyles?: unknown } }).document;
const copy = duplicateStyle(undefined, builtInStyle('garage-door')!, 'Garage look');
const garage = { ...newStateTile('cover.demo_garage', 'Demo Garage', 'garage', undefined)!, id: 'demo-garage', binding: { entityId: 'cover.demo_garage', styleId: copy.id, builtIn: 'garage-door' as const } };
const document = { ...(addStateTile(home as never, home.pages[0].id, garage as never) as object), stateStyles: copy.library };

test.beforeEach(async ({ request, page }) => {
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} },
    states: [{ entityId: 'cover.demo_garage', name: 'Demo Garage', state: 'closed', deviceClass: 'garage' }] } }));
});
test.use({ actionTimeout: 8000 });

const tile = (page: Page) => previewRoot(page).locator('[data-sel="node:demo-garage"] .sh-state-tile, [data-sel="node:demo-garage"].sh-state-tile').first();
const well = (page: Page) => page.getByLabel('Custom Color…');

/** Opens the saved style "Garage look" from Project, State Styles. */
async function openStyle(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'State Styles' }).or(page.getByRole('button', { name: 'State Styles' })).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /^Garage look/ }).click();
  return panel;
}

test('a state’s Fill is a color field that paints the tile in that state, and Clear Fill puts the class face back', async ({ page }) => {
  const panel = await openStyle(page);
  await panel.getByRole('button', { name: /^Closed/ }).click();
  await expect(panel.getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await expect(panel.getByText('Without a fill the tile draws the face of its class.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await well(page).evaluate((input: HTMLInputElement) => { input.value = '#336699'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(async () => tile(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(51, 102, 153)');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-state-fill`);
  // On a phone the color picker is a pushed page: go back to the state to reach Clear Fill.
  if (isPhone(page)) await page.locator('.w2-back').last().click();
  await page.getByRole('button', { name: 'Clear Fill' }).click();
  await expect.poll(async () => tile(page).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(51, 102, 153)');
});

test('Hidden words are a labelled field on the style, kept when left, and cleared when emptied', async ({ page }) => {
  const panel = await openStyle(page);
  const field = panel.getByRole('textbox', { name: 'Hidden words' });
  await expect(field).toHaveAttribute('placeholder', 'Same as the state');
  await expect(panel.getByText(/instead of the state’s words/)).toBeVisible();
  await field.fill('Hidden');
  await field.blur();
  await expect(field).toHaveValue('Hidden');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-hidden-words`);
  await field.fill('');
  await field.blur();
  await expect(field).toHaveValue('');
});

test('a built-in style shows both fields disabled', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'State Styles' }).or(page.getByRole('button', { name: 'State Styles' })).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /^Garage door/ }).click();
  await expect(panel.getByRole('textbox', { name: 'Hidden words' })).toBeDisabled();
});
