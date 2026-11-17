import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addStateTile, duplicateStyle, newStateTile } from '../../src/shared/composition/state-style-library';
import { builtInStyle } from '../../src/shared/composition/state-styles';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

/**
 * TC5, the tile ink (`sh.tile-ink@1`), in the inspector and the preview: a state tile's "Icon color" and "Button icon color" (an exact color, or a Light and a
 * Dark one) and a style state's "Words on fill". The tile beside it keeps the default grey icon and white buttons.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; components: unknown[] }[]; dataSources: unknown[] } };
type J = Record<string, any>;
const lit = (value: unknown): J => ({ type: 'literal', value });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, title: string, type: string, rest: J): J => ({ id, title, type, layout: {}, ...rest });
const start: J = { id: 'start', icon: symbol('play.fill'), label: 'Start', action: { type: 'call-service', domain: 'vacuum', service: 'start', feedback: 'policy', target: { entity_id: lit('vacuum.demo_robot') } } };
const robot = (id: string, title: string): J => node(id, title, 'state-tile', { icon: symbol('fan'), binding: { entityId: 'vacuum.demo_robot', builtIn: 'robot' }, props: { discs: [start] } });
const components = [node('robots', 'Robots', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page', minimumColumns: 2 },
  children: [robot('main-floor', 'Main Floor'), robot('upstairs', 'Upstairs')] })];
const document = { ...fixture.document, pages: fixture.document.pages.map((page, at) => at === 0 ? { ...page, components } : page),
  dataSources: [...fixture.document.dataSources, { id: 'robot', kind: 'ha-entity', entityId: lit('vacuum.demo_robot') }] };
const house = (state: string) => ({ mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: [{ entityId: 'vacuum.demo_robot', name: 'Robot', state }] });

test.use({ actionTimeout: 8000 });
const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
const node$ = (page: Page, id: string) => previewRoot(page).locator(`[data-sel="node:${id}"]`).first();
/** On a phone the color picker is a page pushed over the inspector: go back to the fields. */
const back = async (page: Page) => { if (isPhone(page)) await page.locator('.w2-back').last().click(); else await page.keyboard.press('Escape'); };
const add = (panel: Locator, name: string) => panel.getByText(name, { exact: true }).first().click();
/** The computed color of an element, as the sheet or the preview draws it, optionally under a forced color scheme. */
const colorOf = (target: Locator, scheme?: 'light') => target.evaluate((element, forced) => {
  if (forced) (element as HTMLElement).style.colorScheme = forced;
  const color = getComputedStyle(element).color;
  (element as HTMLElement).style.colorScheme = '';
  return color;
}, scheme);
const lineColor = (target: Locator) => target.evaluate(element => getComputedStyle(element).color);

test('Icon color: a state tile draws its icon in the color, a Light and a Dark one, and the tile beside it stays grey', async ({ page, request }) => {
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: house('docked') }));
  await openWorkspace(page);
  const glyph = (id: string) => node$(page, id).locator('.sh-tile-glyph').first();
  const grey = await colorOf(glyph('upstairs'));
  expect(await colorOf(glyph('main-floor'))).toBe(grey);
  const panel = await selectTile(page, 'Main Floor');
  await full(page);
  await expect(panel.getByText('Icon color', { exact: true }).first()).toBeVisible();
  await add(panel, 'Icon color');
  await panel.getByRole('button', { name: 'Icon color', exact: true }).click();
  await page.getByRole('radio', { name: 'Indigo' }).click();
  await back(page);
  await expect.poll(() => colorOf(glyph('main-floor'))).toBe('rgb(88, 86, 214)');
  const sw = panel.getByRole('switch', { name: 'Icon color differs in dark mode' });
  await expect(sw).not.toBeChecked();
  await sw.check();
  await panel.getByRole('button', { name: 'Icon color in dark mode' }).click();
  await page.getByRole('radio', { name: 'Purple' }).click();
  await back(page);
  await expect(panel.getByRole('button', { name: 'Icon color in light mode' })).toContainText('Indigo');
  await expect(panel.getByRole('button', { name: 'Icon color in dark mode' })).toContainText('Purple');
  // The preview is dark: the Dark color. Under a light color-scheme the same icon draws the Light one. The other tile is unchanged.
  await expect.poll(() => colorOf(glyph('main-floor'))).toBe('rgb(175, 82, 222)');
  expect(await colorOf(glyph('main-floor'), 'light')).toBe('rgb(88, 86, 214)');
  expect(await colorOf(glyph('upstairs'))).toBe(grey);
  await snap(page, `${prefix(page)}-tile-ink-icon-color`);
  // Removing the field returns the icon to grey.
  await panel.getByRole('button', { name: 'Remove Icon color' }).click();
  await expect.poll(() => colorOf(glyph('main-floor'))).toBe(grey);
});

test('Button icon color: the buttons of a tile on a dark face draw their symbol in the color, and white without it', async ({ page, request }) => {
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: house('docked') }));
  await openWorkspace(page);
  const disc = (id: string) => node$(page, id).locator('.sh-tile-disc').first();
  expect(await colorOf(disc('main-floor'))).toBe('rgb(255, 255, 255)');
  const panel = await selectTile(page, 'Main Floor');
  await full(page);
  await add(panel, 'Button icon color');
  await panel.getByRole('button', { name: 'Button icon color', exact: true }).click();
  await page.getByRole('radio', { name: 'Orange' }).click();
  await back(page);
  await expect.poll(() => colorOf(disc('main-floor'))).toBe('rgb(255, 149, 0)');
  expect(await colorOf(disc('upstairs'))).toBe('rgb(255, 255, 255)');
  await expect(panel.getByRole('switch', { name: 'Button icon color differs in dark mode' })).not.toBeChecked();
  await snap(page, `${prefix(page)}-tile-ink-button-color`);
});

test('Icon color: an unavailable tile ignores it and draws the grey icon at half opacity', async ({ page, request }) => {
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: house('unavailable') }));
  await openWorkspace(page);
  const panel = await selectTile(page, 'Main Floor');
  await full(page);
  await add(panel, 'Icon color');
  const glyph = node$(page, 'main-floor').locator('.sh-tile-glyph').first();
  await expect(glyph).toHaveCSS('opacity', '0.5');
  await expect(glyph).toHaveCSS('color', 'rgb(142, 142, 147)');
  // The untinted tile beside it draws the same grey at the same 50%: the tint changes nothing while unavailable.
  await expect(node$(page, 'upstairs').locator('.sh-tile-glyph').first()).toHaveCSS('color', 'rgb(142, 142, 147)');
  await snap(page, `${prefix(page)}-tile-ink-unavailable`);
});

test('Words on fill: a state with a fill chooses white or soft white, and a state without one cannot', async ({ page, request }) => {
  const home = fixture.document as unknown as { pages: { id: string }[] };
  const copy = duplicateStyle(undefined, builtInStyle('garage-door')!, 'Garage look');
  const garage = { ...newStateTile('cover.demo_garage', 'Demo Garage', 'garage', undefined)!, id: 'demo-garage', binding: { entityId: 'cover.demo_garage', styleId: copy.id, builtIn: 'garage-door' as const } };
  await seed(request, { ...(addStateTile(home as never, home.pages[0].id, garage as never) as object), stateStyles: copy.library });
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} },
    states: [{ entityId: 'cover.demo_garage', name: 'Demo Garage', state: 'closed', deviceClass: 'garage' }] } }));
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'State Styles' }).or(page.getByRole('button', { name: 'State Styles' })).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /^Garage look/ }).click();
  await panel.getByRole('button', { name: /^Closed/ }).click();
  const line = previewRoot(page).locator('[data-sel="node:demo-garage"] .sh-tile-line').first();
  const ink = panel.getByRole('combobox', { name: 'Words on fill' });
  await expect(ink).toBeDisabled();
  await expect(panel.getByText('Needs a fill. Without one, the words keep the ink of the face.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByRole('radio', { name: 'Teal' }).click();
  await back(page);
  await expect(ink).toBeEnabled();
  await expect(ink).toContainText('White');
  await expect.poll(() => lineColor(line)).toBe('rgb(255, 255, 255)');
  await ink.click();
  await expect(page.getByRole('option')).toHaveText(['White', 'Soft WhiteWhite at 92%.']);
  await page.getByRole('option', { name: /Soft White/ }).click();
  await expect(ink).toContainText('Soft White');
  await expect.poll(() => lineColor(line)).toBe('rgba(255, 255, 255, 0.92)');
  await snap(page, `${prefix(page)}-tile-ink-fill-ink`);
  // Clearing the fill takes the ink with it.
  await panel.getByRole('button', { name: 'Clear Fill' }).click();
  await expect(ink).toBeDisabled();
  await expect(ink).toContainText('White');
});

test('In a taller cell: a tile keeps its own height at the top of the row, which stays as tall as its tallest cell', async ({ page, request }) => {
  const tall = { ...robot('upstairs', 'Upstairs'), props: { discs: [start], subtitle: lit('A long line of words under the title that wraps onto several lines of the tile, so this cell is the tallest one in the row.') } };
  const grid = { ...components[0], props: { ...components[0].props, equalRowHeights: true }, children: [robot('main-floor', 'Main Floor'), tall] };
  await seed(request, { ...document, pages: document.pages.map((item, at) => at === 0 ? { ...item, components: [grid] } : item) });
  await page.route('**/api/native-home', route => route.fulfill({ json: house('docked') }));
  await openWorkspace(page);
  const box = (id: string) => node$(page, id).boundingBox();
  const tileBox = (id: string) => node$(page, id).locator('.sh-tile-parts').first().boundingBox();
  // The row's height is read again with each try: the grid measures its columns first, and the cells settle a moment after.
  const gap = async () => { const [mine, cell] = await Promise.all([tileBox('main-floor'), box('upstairs')]); return cell!.height - mine!.height; };
  await expect.poll(gap).toBeLessThan(10);
  const row = (await box('upstairs'))!;
  const panel = await selectTile(page, 'Main Floor');
  await full(page);
  await add(panel, 'In a taller cell');
  const fit = panel.getByRole('combobox', { name: 'In a taller cell' });
  await expect(fit).toContainText('Fill the cell');
  await fit.click();
  await page.getByRole('option', { name: 'Keep its height' }).click();
  await expect.poll(async () => (await tileBox('main-floor'))!.height).toBeLessThan(row.height - 30);
  const [natural, cell] = await Promise.all([tileBox('main-floor'), box('upstairs')]);
  expect(Math.abs(natural!.y - cell!.y)).toBeLessThan(4);
  expect((await box('main-floor'))!.height).toBeLessThan(row.height - 30);
  await snap(page, `${prefix(page)}-tile-ink-cell-fit`);
  await fit.click();
  await page.getByRole('option', { name: 'Fill the cell' }).click();
  await expect.poll(gap).toBeLessThan(10);
});
