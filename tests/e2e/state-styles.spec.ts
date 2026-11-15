import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The Styles section of the native composition workspace, over synthetic fixtures. Home Assistant is never contacted: the
 * entity routes are answered here, and the dev server runs in sample mode.
 */
const entities = [
  { entityId: 'lock.fixture_front', name: 'Fixture front lock', state: 'locked' },
  { entityId: 'sensor.fixture_level', name: 'Fixture level', state: '21' },
];

/**
 * The native composition API needs an authenticated session, so this file runs its own Studio on a free port with a synthetic token and
 * an empty data directory. The default Studio (and anyone else's) is never touched.
 */
const token = 'studio-e2e-synthetic-token-0000000000';
let origin = '';
let studio: ChildProcess | undefined;

test.beforeAll(async () => {
  const port = await new Promise<number>(resolve => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => resolve(port)); });
  });
  origin = `http://127.0.0.1:${port}`;
  studio = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: mkdtempSync(join(tmpdir(), 'studio-styles-')), STUDIO_AUTH_TOKEN: token },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { await fetch(`${origin}/api/auth`, { method: 'GET' }); return; } catch { await new Promise(done => setTimeout(done, 500)); }
  }
  throw new Error('The style editor test Studio did not start');
});
test.afterAll(() => { studio?.kill(); });

async function open(page: Page) {
  const signedIn = await page.request.post(`${origin}/api/auth`, { data: { token } });
  expect(signedIn.ok()).toBeTruthy();
  await page.route('**/native/api/ha/entities', route => route.fulfill({ json: entities }));
  await page.route('**/native/api/ha/entity-states**', route => route.fulfill({ json: {
    entityId: 'lock.fixture_front', openEnded: false, history: ['jammed'],
    states: [{ state: 'locked', name: 'Locked' }, { state: 'open', name: 'Open' }],
  } }));
  await page.route('**/native/api/ha/exists**', route => route.fulfill({ json: { exists: new URL(route.request().url()).searchParams.get('id') === 'script.fixture_known' } }));
  await page.goto(`${origin}/`);
  await page.getByRole('button', { name: 'Native composition' }).click();
  await page.getByRole('navigation', { name: 'Native composition sections' }).getByRole('button', { name: 'Styles' }).click();
  await expect(page.getByRole('heading', { name: 'Styles', level: 1 })).toBeVisible();
}

test('the library lists the built-ins read-only, and Duplicate makes a saved style that can be renamed and deleted', async ({ page }) => {
  await open(page);
  const library = page.getByRole('region', { name: 'Style library' });
  await expect(library.getByRole('listitem')).toHaveCount(8);
  await expect(library.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await library.getByRole('button', { name: 'Duplicate Robot' }).click();
  await expect(library.getByRole('listitem')).toHaveCount(9);
  await expect(library.getByText('Used by 0 tiles')).toBeVisible();
  await library.getByRole('button', { name: 'Rename Robot copy' }).click();
  await library.getByLabel('New name for Robot copy').fill('Tidy robot');
  await page.keyboard.press('Enter');
  await expect(library.getByRole('button', { name: 'Delete Tidy robot' })).toBeVisible();
  await library.getByRole('button', { name: 'Delete Tidy robot' }).click();
  await expect(library.getByRole('listitem')).toHaveCount(8);
});

test('the state-map editor offers the arc only without an action, names the iOS 17 fallbacks, and keeps unavailable unknown', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Duplicate Lock' }).click();
  const indicator = page.getByLabel('Indicator for locked');
  await expect(indicator.locator('option[value="arc-spinner"]')).toBeDisabled();
  await expect(indicator.locator('option[value="arc-spinner"]')).toContainText('No arc while this state has an action');
  await expect(indicator.locator('option[value="breathe"]')).toContainText('iOS 17 plays Pulse');
  await expect(indicator.locator('option[value="wiggle"]')).toContainText('iOS 17 plays Bounce');
  await expect(page.getByLabel('Class for unavailable, unknown')).toBeDisabled();
  await indicator.selectOption('pulse');
  await expect(indicator).toHaveValue('pulse');
  await page.getByLabel('Add a state').fill('charging');
  await page.getByRole('button', { name: 'Add state' }).click();
  await expect(page.getByRole('listitem', { name: 'Rule: charging' })).toBeVisible();
});

test('the entity picker lists live entities, fills the map from their states and flags history-only states', async ({ page }) => {
  await open(page);
  await page.getByLabel('Search entities').fill('front');
  await expect(page.getByRole('list', { name: 'Entities' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: /Fixture front lock/ }).click();
  await expect(page.getByText('Filled a state map from Fixture front lock').first()).toBeVisible();
  await expect(page.getByText('Unclassified: jammed')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Rule: open' })).toBeVisible();
  await expect(page.getByLabel('Class for open')).toHaveValue('warning');
});

test('the request phase warns about a missing script or timer and installs nothing', async ({ page }) => {
  await open(page);
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/native/api/ha/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.getByRole('button', { name: 'Duplicate Robot' }).click();
  await page.getByRole('button', { name: 'Add a request phase' }).click();
  await page.getByLabel('Script', { exact: true }).fill('script.fixture_known');
  await page.getByLabel('Error timer').fill('timer.fixture_missing');
  await page.getByRole('button', { name: 'Check script.fixture_known' }).click();
  await expect(page.getByText('script.fixture_known exists in Home Assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Check timer.fixture_missing' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'does not exist in Home Assistant' })).toContainText('installs nothing');
  expect(writes).toEqual([]);
});

test('the preview shows iPhone, Duo and iPad tiles with the arc in the disc place and the dimmed VoiceOver value', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Duplicate Robot' }).click();
  const preview = page.getByRole('region', { name: 'Tile preview' }).first();
  await preview.getByLabel('Preview state').selectOption('returning');
  const tiles = preview.getByRole('figure');
  await expect(tiles).toHaveCount(3);
  const widths = await tiles.evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().width)));
  expect(widths[0]).toBeLessThan(widths[1]);
  expect(widths[1]).toBeLessThanOrEqual(widths[2]);
  await expect(tiles.nth(0)).toHaveAttribute('data-indicator', 'arc-spinner');
  await expect(preview.getByTestId('preview-arc').first()).toHaveCSS('opacity', '1');
  await expect(preview.getByTestId('preview-disc').first()).toHaveCSS('opacity', '0');
  await expect(preview.getByTestId('preview-disc').first()).toHaveCSS('transition', /0\.2s/);
  await expect(preview.getByTestId('preview-voiceover').first()).toHaveText('Returning, in progress, dimmed');
  await preview.getByLabel('Preview state').selectOption('paused');
  await expect(tiles.nth(0)).toHaveAttribute('data-indicator', 'pulse');
  await expect(preview.getByTestId('preview-disc').first()).toHaveCSS('opacity', '1');
  await expect(preview.getByTestId('preview-voiceover').first()).toHaveText('Paused, warning');
});

test('the library works from the keyboard and names every control for a screen reader', async ({ page }) => {
  await open(page);
  const duplicate = page.getByRole('button', { name: 'Duplicate Garage Door' });
  await duplicate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Rename Garage Door copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Garage Door copy' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('New name for Garage Door copy')).toBeFocused();
  // Every rule is a named list item; every control inside carries the rule's name.
  const rules = page.getByRole('listitem', { name: /^Rule: / });
  expect(await rules.count()).toBeGreaterThan(2);
  const unnamed = await page.locator('.style-rule select, .style-rule input').evaluateAll(items => items.filter(item => {
    const control = item as HTMLInputElement;
    return !control.labels?.length && !control.getAttribute('aria-label');
  }).length);
  expect(unnamed).toBe(0);
  await expect(page.getByRole('region', { name: 'Style library' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Request phase' })).toBeVisible();
});

test('a state tile is added from the UI with the built-in style its device class suggests, and appears in the tile bindings', async ({ page }) => {
  await open(page);
  await page.route('**/native/api/ha/entities', route => route.fulfill({ json: [...entities, { entityId: 'binary_sensor.fixture_smoke', name: 'Fixture smoke', state: 'off' }] }));
  await page.route('**/native/api/ha/entity-states**', route => route.fulfill({ json: { entityId: 'binary_sensor.fixture_smoke', deviceClass: 'smoke', openEnded: true, history: [], states: [] } }));
  await page.getByRole('button', { name: 'Add a state tile' }).click();
  await page.getByLabel('Find an entity for the tile').fill('smoke');
  await page.getByRole('list', { name: 'Candidates for the tile' }).getByRole('button', { name: /Fixture smoke/ }).click();
  await expect(page.getByText(/Added a state tile for Fixture smoke to .*Detector built-in style/)).toBeVisible();
  const tile = page.getByRole('region', { name: 'State tiles' }).getByRole('article');
  await expect(tile).toHaveCount(1);
  await expect(tile.getByText('binary_sensor.fixture_smoke')).toBeVisible();
  await expect(tile.getByLabel(/^Style for /)).toHaveValue('built:detector');
});
