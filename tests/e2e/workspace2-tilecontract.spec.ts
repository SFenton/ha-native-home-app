import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The tile contract lane in the inspector (task `sim-fidelity`): the State Words fold of a light group tile, the Swipe to Adjust row and page of a state tile, and the
 * Group by State row and page of a grid. Each is seen on the desktop and the phone layouts, light and dark.
 */
type J = Record<string, any>;
const lightTile = (id: string, title: string, props: J = {}): J => ({ id, title, type: 'light-group-tile', layout: {}, props: { sourceId: 'tc-src-lamp', ...props } });
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: J };
const lit = (value: unknown): J => ({ type: 'literal', value });
const lightSource = (id: string, entityId: string): J => ({ id, kind: 'model', model: 'home-light@1', inputs: { entityId: lit(entityId) } });
const control = { type: 'control' };
const grid = (id: string, title: string, children: J[], props: J = {}): J => ({ id, title, type: 'tile-grid', layout: { span: 1 }, children,
  props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page', ...props } });
const cover: J = {
  id: 'swipe-cover', title: 'Swipe Blinds', type: 'state-tile', layout: {}, icon: { type: 'sf-symbol', name: 'blinds.horizontal.open', rendering: 'canonical', unavailable: 'fallback' }, binding: { entityId: 'cover.demo_tc_blinds', builtIn: 'blind' },
  props: { swipe: { axis: 'horizontal', range: { min: 0, max: 100, step: 1 }, commit: 'release', detent: 10, label: 'position', format: '{value}%',
    value: { type: 'read', from: { type: 'source', sourceId: 'tc-e-blinds', path: ['attributes', 'current_position'] }, as: 'number', missing: 'unavailable' },
    action: { type: 'call-service', domain: 'cover', service: 'set_cover_position', target: { entity_id: lit('cover.demo_tc_blinds') }, data: { type: 'object', fields: { position: control } } } } },
};
const components = [
  grid('words-grid', 'Words grid', [lightTile('words-light', 'Words Light', { words: { off: 'All Dark', level: 'Glowing {value}%' } })]),
  grid('swipe-grid', 'Swipe grid', [cover]),
  grid('groups-grid', 'Groups grid', [lightTile('g-lamp', 'Group Lamp'), lightTile('g-other', 'Group Other', { sourceId: 'tc-src-dark' })], { groups: { by: 'state', items: [{ id: 'group-on', title: 'Lights On', states: ['active'] }, { id: 'group-off', title: 'Lights Off', states: ['idle', 'unavailable'] }] } }),
];
const document = { ...fixture.document, pages: fixture.document.pages.map((page: J, at: number) => at === 0 ? { ...page, components } : page),
  dataSources: [...fixture.document.dataSources, lightSource('tc-src-lamp', 'light.demo_tc_lamp'), lightSource('tc-src-dark', 'light.demo_tc_dark'), { id: 'tc-e-blinds', kind: 'ha-entity', entityId: lit('cover.demo_tc_blinds') }] };
const house = { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: [
  { entityId: 'light.demo_tc_lamp', state: 'on', name: 'Lamp', brightness: 128, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_tc_dark', state: 'off', name: 'Dark lamp', supportedColorModes: ['brightness'] },
  { entityId: 'cover.demo_tc_blinds', state: 'open', name: 'Blinds', currentPosition: 40 },
] };

test.use({ actionTimeout: 8000 });
const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
const schemes = ['dark', 'light'] as const;

async function open(page: Page, request: Parameters<typeof seed>[0], scheme: typeof schemes[number]) {
  await page.emulateMedia({ colorScheme: scheme });
  await seed(request, document);
  await page.route('**/api/native-home', route => route.fulfill({ json: house }));
  await openWorkspace(page);
}
/** A tile of the preview, by its node id (a title can repeat across the story). */
const select = async (page: Page, title: string): Promise<Locator> => selectTile(page, title);

for (const scheme of schemes) {
  test(`State Words: a closed fold with its summary, open one text row for each word, a cleared word is removed (${scheme})`, async ({ page, request }) => {
    await open(page, request, scheme);
    const panel = await select(page, 'Words Light');
    await full(page);
    const fold = panel.locator('[data-disclosure$="props/words"]');
    await expect(fold.getByRole('button', { name: /State Words/ })).toContainText('2 Changed');
    await snap(page, `${prefix(page)}-state-words-closed-${scheme}`);
    await fold.getByRole('button', { name: /State Words/ }).click();
    for (const label of ['When On', 'When Off', 'When Unavailable', 'Level Text']) await expect(fold.getByText(label, { exact: true })).toBeVisible();
    await expect(fold.getByText('Count Text', { exact: true })).toHaveCount(0);
    await expect(fold.getByLabel('When Off')).toHaveValue('All Dark');
    await expect(fold.getByLabel('When On')).toHaveAttribute('placeholder', 'On');
    await snap(page, `${prefix(page)}-state-words-open-${scheme}`);
    // The tile draws the word; clearing the field removes the key and the app's word returns.
    await expect(previewRoot(page).getByText('Glowing 50%', { exact: true })).toBeVisible();
    await fold.getByLabel('Level Text').fill('');
    await fold.getByLabel('Level Text').blur();
    await expect(fold.getByRole('button', { name: /State Words/ })).toContainText('1 Changed');
    await expect(previewRoot(page).getByText('50%', { exact: true }).first()).toBeVisible();
    // A word without its token says so under the row.
    await fold.getByLabel('Level Text').fill('Bright');
    await fold.getByLabel('Level Text').blur();
    await expect(fold.getByText('Level Text has no {value}.')).toBeVisible();
  });

  test(`Swipe to Adjust: the row says what it adjusts and its page shows the range, the ticks and the call (${scheme})`, async ({ page, request }) => {
    await open(page, request, scheme);
    const panel = await select(page, 'Swipe Blinds');
    await full(page);
    await expect(panel.getByTestId('swipe-row')).toContainText('Cover Position');
    await panel.getByTestId('swipe-row').click();
    const swipePage = page.getByTestId('swipe-page');
    await expect(swipePage.getByText('Tick Every', { exact: true })).toBeVisible();
    await expect(swipePage.getByTestId('swipe-release')).toContainText('set_cover_position');
    await snap(page, `${prefix(page)}-swipe-page-${scheme}`);
  });

  test(`Group by State: the row says how many groups, the page ticks each state into one group (${scheme})`, async ({ page, request }) => {
    await open(page, request, scheme);
    // A grid has no words of its own to click: its group heading is the grid's.
    await previewRoot(page).getByRole('heading', { name: 'Lights On' }).click();
    const panel = page.getByLabel('Properties');
    await expect(panel.getByRole('heading', { name: 'Groups grid', exact: true })).toBeVisible();
    await full(page);
    await expect(panel.getByTestId('groups-row')).toContainText('2 Groups');
    await panel.getByTestId('groups-row').click();
    const groupsPage = page.getByTestId('groups-page');
    await expect(groupsPage.getByTestId('group-card')).toHaveCount(2);
    await snap(page, `${prefix(page)}-groups-page-${scheme}`);
    // Ticking Off in the first group takes it from the second: one state, one group.
    await groupsPage.getByLabel('Off in Lights On').check();
    await expect(groupsPage.getByLabel('Off in Lights Off')).not.toBeChecked();
    await expect(groupsPage.getByLabel('Unavailable in Lights Off')).toBeChecked();
    // The preview regroups: the idle lamp now sits under Lights On.
    await expect(previewRoot(page).getByRole('heading', { name: 'Lights On' })).toBeVisible();
  });
}
