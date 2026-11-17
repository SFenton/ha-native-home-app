import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The generic parts the vacuum and climate atoms are rebuilt from (TC3): a choice that reads its options from an entity, a tile button whose symbol and
 * label follow rules, a grid that keeps two columns, a toggle row with its parts and a toggle drawn as a check row. Each is authored in the inspector.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; components: unknown[] }[]; dataSources: unknown[] } };
type J = Record<string, any>;
const lit = (value: unknown): J => ({ type: 'literal', value });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const is = (sourceId: string, ...states: string[]): J => ({ type: 'state', sourceId, path: ['state'], in: states });
const service = (domain: string, name: string, entity: string, data?: J): J => ({ type: 'call-service', domain, service: name, feedback: 'policy', target: { entity_id: lit(entity) }, ...(data ? { data } : {}) });
const node = (id: string, title: string, type: string, rest: J): J => ({ id, title, type, layout: {}, ...rest });

const pending = (id: string): J => ({ id, icon: symbol('play.fill'), label: 'Start', action: service('vacuum', 'start', 'vacuum.demo_robot') });
const robot = (id: string, title: string, discs: J[]): J => node(id, title, 'state-tile', { icon: symbol('fan'), binding: { entityId: 'vacuum.demo_robot', builtIn: 'robot' }, props: { discs } });
const ruled: J = { id: 'start-pause', label: { type: 'expr', value: { type: 'choose', otherwise: lit('Start'), cases: [{ when: is('robot', 'cleaning'), then: lit('Pause') }] } },
  icon: { type: 'conditional', cases: [{ when: is('robot', 'cleaning'), then: symbol('pause.fill') }], otherwise: symbol('play.fill') },
  action: service('vacuum', 'start', 'vacuum.demo_robot') };
const toggle = (id: string, title: string, props: J, rest: J = {}): J => node(id, title, 'bound-control', {
  props: { kind: 'toggle', isOn: is('clean', 'on'), unavailableText: 'Unavailable', ...props },
  onAction: service('input_boolean', 'toggle', 'input_boolean.demo_clean'), offAction: service('input_boolean', 'toggle', 'input_boolean.demo_clean'), ...rest });
const fallback = ['quiet', 'standard'].map(id => ({ id, label: id === 'quiet' ? 'Quiet' : 'Standard', selectedWhen: is('speed', id), action: service('select', 'select_option', 'select.demo_fan_speed', { type: 'object', fields: { option: lit(id) } }) }));

const components = [
  node('robots', 'Robots', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' },
    children: [robot('main-floor', 'Main Floor', [ruled]), robot('upstairs', 'Upstairs', [pending('go')])] }),
  node('speed-choice', 'Fan Speed', 'bound-control', { props: { kind: 'choice', options: fallback, unavailableText: 'Unavailable' } }),
  toggle('auto-clean', 'Auto-Clean', {}, { icon: symbol('clock.arrow.circlepath') }),
  toggle('room-check', 'Master Bedroom', {}),
];
const document = { ...fixture.document, pages: fixture.document.pages.map((page, at) => at === 0 ? { ...page, components } : page),
  dataSources: [...fixture.document.dataSources,
    { id: 'robot', kind: 'ha-entity', entityId: lit('vacuum.demo_robot') }, { id: 'speed', kind: 'ha-entity', entityId: lit('select.demo_fan_speed') },
    { id: 'clean', kind: 'ha-entity', entityId: lit('input_boolean.demo_clean') }] };

test.beforeEach(async ({ request, page }) => {
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: [
    { entityId: 'vacuum.demo_robot', name: 'Robot', state: 'cleaning' },
    { entityId: 'select.demo_fan_speed', name: 'Fan Speed Select', state: 'max_plus', options: ['quiet', 'standard', 'max_plus'] },
    { entityId: 'input_boolean.demo_clean', name: 'Auto-Clean Switch', state: 'on' },
  ] } }));
});
test.use({ actionTimeout: 8000 });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
const node$ = (page: Page, id: string) => previewRoot(page).locator(`[data-sel="node:${id}"]`).first();
/** Selects a node the preview draws, by the words it shows, and opens the inspector as far as a phone allows. */
async function select(page: Page, title: string): Promise<Locator> {
  const panel = await selectTile(page, title);
  await full(page);
  return panel;
}
/** On a phone the inspector is a sheet over the preview: close it to reach another node. Elsewhere nothing is in the way. */
async function release(page: Page, panel: Locator) {
  if (isPhone(page)) { await page.getByLabel('Properties').getByRole('button', { name: 'Close', exact: true }).first().click(); await expect(panel).toBeHidden(); }
}
/** The pushed page's back button: on a phone a page opened from the inspector replaces it. */
const back = (page: Page) => page.locator('.w2-back').last();
/** An optional field is an "Add" row, named by the field and "None"; pressing it adds the field with its control. */
const add = (panel: Locator, name: string) => panel.getByText(name, { exact: true }).first().click();

test('Choices from an entity: reads the select\'s options, says what it reads, follows the words, and stops', async ({ page }) => {
  await openWorkspace(page);
  const panel = await select(page, 'Fan Speed');
  const radios = () => node$(page, 'speed-choice').getByRole('radio');
  await expect(radios()).toHaveText(['Quiet', 'Standard']);
  await panel.getByRole('button', { name: 'Read Choices From an Entity…' }).click();
  await page.getByRole('option', { name: /Fan Speed Select/ }).first().click();
  await expect(panel.getByText('Reads 3 choices now.')).toBeVisible();
  await expect(radios()).toHaveText(['Quiet', 'Standard', 'Max Plus']);
  await expect(radios().nth(2)).toHaveAttribute('aria-checked', 'true');
  await snap(page, `${prefix(page)}-parts-options-read`);
  await panel.getByRole('group', { name: 'Choice words' }).getByRole('button', { name: 'As Written' }).click();
  await expect(radios()).toHaveText(['quiet', 'standard', 'max_plus']);
  await expect(panel.getByText('The choices above are used while the entity reports fewer than two options.')).toBeVisible();
  await panel.getByRole('button', { name: 'Stop Reading Choices' }).click();
  await expect(radios()).toHaveText(['Quiet', 'Standard']);
  await expect(panel.getByRole('button', { name: 'Read Choices From an Entity…' })).toBeVisible();
});

test('A tile button: its symbol and label show as rules, a plain label turns into a text slot, and "Say the tile\'s title too" names the tile', async ({ page }) => {
  await openWorkspace(page);
  let panel = await select(page, 'Main Floor');
  // The button that follows rules: the robot is cleaning, so the preview reads Pause.
  const disc = (id: string) => node$(page, id).locator('.sh-tile-disc');
  await expect(disc('main-floor')).toHaveAttribute('aria-label', 'Pause');
  await panel.getByRole('button', { name: /^Button, / }).first().click();
  const buttonPage = page.getByTestId('button-page');
  await expect(buttonPage.getByRole('button', { name: /^Icon: 1 rule/ })).toBeVisible();
  await expect(buttonPage.getByRole('button', { name: /^Label: 1 rule/ })).toBeVisible();
  await snap(page, `${prefix(page)}-parts-disc-rules`);
  await add(buttonPage, 'Say the tile’s title too');
  const names = buttonPage.getByRole('switch', { name: 'Say the tile’s title too' }).or(buttonPage.getByRole('checkbox', { name: 'Say the tile’s title too' }));
  await names.check();
  await expect(disc('main-floor')).toHaveAttribute('aria-label', 'Pause Main Floor');
  await snap(page, `${prefix(page)}-parts-disc-names-tile`);
  await names.uncheck();
  await expect(disc('main-floor')).toHaveAttribute('aria-label', 'Pause');
  // A plain label is a fixed value; editing it stores a text slot and the preview follows.
  if (isPhone(page)) { await back(page).click(); await page.getByLabel('Properties').getByRole('button', { name: 'Close', exact: true }).first().click(); }
  panel = await select(page, 'Upstairs');
  await panel.getByRole('button', { name: /^Start, / }).first().click();
  const label = page.getByTestId('button-page').getByRole('textbox', { name: 'Label' });
  await expect(label).toHaveValue('Start');
  await label.fill('Go Upstairs');
  await label.blur();
  await expect(disc('upstairs')).toHaveAttribute('aria-label', 'Go Upstairs');
});

test('Least columns: two robot tiles with buttons sit side by side, and without it each takes the row', async ({ page }) => {
  await openWorkspace(page);
  // The grid has no words of its own: its gap between two tiles is the grid.
  const row = () => node$(page, 'robots').locator('.sh-grid').first();
  const tiles = row().locator('.sh-tile-parts');
  await expect(tiles).toHaveCount(2);
  const [first, second] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
  await page.mouse.click(first!.x + first!.width / 2, (first!.y + first!.height + second!.y) / 2);
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'Robots', exact: true })).toBeVisible();
  await full(page);
  const boxes = async () => {
    return Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
  };
  // Without a floor the tiles with buttons want more than half the page, so each takes a row.
  await expect.poll(async () => { const [a, b] = await boxes(); return Boolean(a && b && b.y > a.y + 10); }).toBe(true);
  await panel.getByRole('button', { name: 'Add Least columns' }).click();
  await snap(page, `${prefix(page)}-parts-least-columns-field`);
  await expect.poll(async () => { const [a, b] = await boxes(); return Boolean(a && b && Math.abs(b.y - a.y) < 4 && b.x > a.x + 40); }).toBe(true);
  await snap(page, `${prefix(page)}-parts-least-columns`);
});

test('A toggle row\'s parts: a subtitle, an icon color, a size, a hint and a failure caption', async ({ page }) => {
  await openWorkspace(page);
  const panel = await select(page, 'Auto-Clean');
  const row = node$(page, 'auto-clean');
  for (const name of ['Subtitle', 'Hint', 'Row size', 'If it fails', 'Icon color']) await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
  // Subtitle: a fixed value for the row.
  await add(panel, 'Subtitle');
  const subtitle = panel.getByRole('textbox', { name: 'Subtitle' });
  await subtitle.fill('Paused');
  await subtitle.blur();
  await expect(row.locator('.sh-row-secondary')).toHaveText('Paused');
  // Row size: Module is 52 tall, 60 with the subtitle, and drawn in the app's glyph column.
  await add(panel, 'Row size');
  await panel.getByRole('group', { name: 'Row size' }).getByRole('button', { name: 'Module' }).click();
  await expect(row.locator('.sh-control')).toHaveAttribute('data-metrics', 'module');
  await panel.getByRole('group', { name: 'Row size' }).getByRole('button', { name: 'Form' }).click();
  await expect(row.locator('.sh-control')).toHaveAttribute('data-metrics', 'form');
  // The hint is VoiceOver's: the switch is described by it.
  await add(panel, 'Hint');
  const hint = panel.getByRole('textbox', { name: 'Hint' });
  await hint.fill('Turns automatic cleaning on or off.');
  await hint.blur();
  await expect(row.getByRole('switch')).toHaveAccessibleDescription('Turns automatic cleaning on or off.');
  // The failure caption shows under the selected row in Edit.
  await add(panel, 'If it fails');
  const caption = panel.getByRole('textbox', { name: 'If it fails' });
  await caption.fill('Automatic cleaning did not respond.');
  await caption.blur();
  await expect(row.getByTestId('failure-caption')).toHaveText('Automatic cleaning did not respond.');
  await snap(page, `${prefix(page)}-parts-row-parts`);
});

test('A check face: a toggle drawn as a check row, which leaves out the icon, the subtitle and the row size', async ({ page }) => {
  await openWorkspace(page);
  const panel = await select(page, 'Auto-Clean');
  await expect(panel.getByText('Subtitle', { exact: true }).first()).toBeVisible();
  await panel.getByRole('group', { name: 'Toggle looks like' }).getByRole('button', { name: 'Check Mark' }).click();
  const row = node$(page, 'auto-clean');
  await expect(row.getByRole('checkbox')).toBeVisible();
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(row.locator('.sh-row-glyph')).toHaveCount(0);
  for (const name of ['Subtitle', 'Row size', 'Icon color']) await expect(panel.getByText(name, { exact: true })).toHaveCount(0);
  await add(panel, 'Check color');
  await panel.getByRole('group', { name: 'Check color' }).getByRole('button', { name: 'Success' }).click();
  await expect(row.locator('.sh-check-circle')).toHaveCSS('background-color', 'rgb(48, 209, 88)');
  await snap(page, `${prefix(page)}-parts-check-face`);
  // Back to a switch: the check color goes with it.
  await panel.getByRole('group', { name: 'Toggle looks like' }).getByRole('button', { name: 'Switch' }).click();
  await expect(row.getByRole('switch')).toBeVisible();
  await expect(panel.getByText('Check color', { exact: true })).toHaveCount(0);
});

test('Only a toggle row has the row parts: a Choice offers choices from an entity and no subtitle', async ({ page }) => {
  await openWorkspace(page);
  const panel = await select(page, 'Fan Speed');
  for (const name of ['Subtitle', 'Row size', 'If it fails', 'Toggle looks like']) await expect(panel.getByText(name, { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Read Choices From an Entity…' })).toBeVisible();
  await release(page, panel);
  const toggled = await select(page, 'Auto-Clean');
  await expect(toggled.getByRole('button', { name: 'Read Choices From an Entity…' })).toHaveCount(0);
});
