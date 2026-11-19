import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addStateTile, newStateTile } from '../../src/shared/composition/state-style-library';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

const home = (JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string }[] } }).document;
const garage = { ...newStateTile('cover.demo_garage', 'Demo Garage', 'garage', undefined)!, id: 'demo-garage' };
const lock = { ...newStateTile('lock.demo_front', 'Demo Front Lock', undefined, undefined)!, id: 'demo-front-lock' };
const robot = { ...newStateTile('vacuum.demo_robot', 'Demo Robot', undefined, undefined)!, id: 'demo-robot' };
const withTiles = addStateTile(addStateTile(addStateTile(home as never, home.pages[0].id, garage), home.pages[0].id, lock), home.pages[0].id, robot);

/** Stubs the tiles' entities: a closed garage door, a locked lock and a docked robot. */
async function stubHouse(page: Page) {
  const states = [{ entityId: 'cover.demo_garage', name: 'Demo Garage', state: 'closed', deviceClass: 'garage' }, { entityId: 'lock.demo_front', name: 'Demo Front Lock', state: 'locked' },
    { entityId: 'vacuum.demo_robot', name: 'Demo Robot', state: 'docked' }];
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}
test.beforeEach(async ({ request, page }) => { await seed(request, withTiles); await stubHouse(page); });
test.use({ actionTimeout: 8000 });

/** The tile as the preview draws it. */
const tile = (page: Page, id: string) => previewRoot(page).locator(`[data-sel="node:${id}"] .sh-state-tile, [data-sel="node:${id}"].sh-state-tile`).first();
/** Chooses a state in "Show state". */
async function show(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Show state' }).click();
  await page.getByRole('option', { name: new RegExp(`^${name}\\b`) }).click();
}

test('Robot draws the house while docked and the vacuum in every other state', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Demo Robot');
  const glyph = tile(page, 'demo-robot').locator('.sh-tile-glyph [data-icon]');
  await expect(glyph).toHaveAttribute('data-icon', 'house');
  for (const state of ['Idle', 'Cleaning', 'Mowing', 'Paused', 'Returning', 'Error', 'Unavailable', 'Unknown']) {
    await show(page, state);
    await expect(glyph).toHaveAttribute('data-icon', 'robotic.vacuum');
  }
  await show(page, 'Docked');
  await expect(glyph).toHaveAttribute('data-icon', 'house');
});

test('Show state draws the selected tile in that state, and deselecting restores it', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Demo Garage');
  await expect(page.getByRole('combobox', { name: 'Show state' })).toBeVisible();
  await show(page, 'Opening');
  await expect(tile(page, 'demo-garage')).toHaveClass(/sh-class-in-progress/);
  await expect(tile(page, 'demo-garage').locator('.sh-tile-line')).toHaveText('Opening');
  await show(page, 'Unavailable');
  await expect(tile(page, 'demo-garage')).toHaveClass(/sh-class-unknown/);
  await snap(page, isPhone(page) ? 'phone-states-group' : 'desktop-states-group');
  // Deselecting returns the tile to what the entity says.
  await page.getByLabel('Properties').getByRole('button', { name: 'Close' }).click();
  await expect(tile(page, 'demo-garage')).toHaveClass(/sh-class-resting/);
  await expect(tile(page, 'demo-garage').locator('.sh-tile-line')).toHaveText('Closed');
});

test('a layer override changes the tile at once, and Reset puts it back', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Demo Garage');
  await show(page, 'Closed');
  await page.getByRole('textbox', { name: 'Words' }).fill('Shut tight');
  await expect(tile(page, 'demo-garage')).toContainText('Shut tight');
  await page.getByRole('button', { name: 'Reset Words to the style' }).click();
  await expect(tile(page, 'demo-garage')).not.toContainText('Shut tight');
});

test('Sending and Didn’t Respond are states of the tap, drawn in the simulator', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Demo Front Lock');
  await show(page, 'Sending');
  await expect(tile(page, 'demo-front-lock')).toHaveClass(/sh-class-in-progress/);
  await expect(tile(page, 'demo-front-lock').getByTestId('state-arc')).toBeAttached();
  await show(page, 'Didn’t Respond');
  await expect(tile(page, 'demo-front-lock')).toHaveClass(/sh-class-error/);
  await page.getByRole('button', { name: /Request Settings/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Ignore taps for' })).toBeVisible();
});

test('State Styles opens in the inspector from the Project menu and lists the saved and built-in styles', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'State Styles' }).or(page.getByRole('button', { name: 'State Styles' })).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'Built-In' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /New Style From an Entity…/ })).toBeVisible();
  if (!isPhone(page)) await expect(page.getByRole('dialog')).toHaveCount(0);
  await panel.getByRole('button', { name: /^Garage door/ }).click();
  await expect(panel.getByText('Built-in styles can’t be changed.')).toBeVisible();
  await expect(panel.getByTestId('style-tile')).toBeVisible();
  await snap(page, isPhone(page) ? 'phone-state-style' : 'desktop-state-style');
});

test('a tap in Use mode shows the arc for about a second, then the entity’s state again', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const garageTile = tile(page, 'demo-garage');
  await garageTile.click();
  await expect(garageTile).toHaveClass(/sh-class-in-progress/);
  await expect(garageTile.getByTestId('state-arc')).toBeAttached();
  await expect(garageTile).not.toHaveClass(/sh-class-in-progress/, { timeout: 2500 });
});

test('with reduced motion no pulse or wiggle plays and the arc turns at half speed', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Demo Front Lock');
  await show(page, 'Open');
  const glyph = tile(page, 'demo-front-lock').locator('.sh-tile-glyph');
  await expect(glyph).toHaveCSS('animation-name', 'sh-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(glyph).toHaveCSS('animation-name', 'none');
  await show(page, 'Jammed');
  await expect(tile(page, 'demo-front-lock').locator('.sh-tile-glyph')).toHaveCSS('animation-name', 'none');
  await show(page, 'Locking');
  await expect(tile(page, 'demo-front-lock').getByTestId('state-arc')).toHaveCSS('animation-duration', '2s');
});

test('Advanced on a state tile holds the ID and the line of what the app fixes, and no state looks', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Garage');
  const fold = panel.getByRole('button', { name: 'Advanced' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(panel.getByTestId('fixed-line')).toContainText('Set by the app');
  await expect(panel.getByText('Overrides', { exact: true })).toHaveCount(0);
  await snap(page, isPhone(page) ? 'phone-advanced-fold' : 'desktop-advanced-fold');
});
