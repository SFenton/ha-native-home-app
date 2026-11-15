import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: any };
const find = (value: any, id: string): any => { if (!value || typeof value !== 'object') return undefined; if (value.id === id) return value; for (const child of Object.values(value)) { const hit = find(child, id); if (hit) return hit; } };
/** The fixture with a light tile on the Home page, so the light is one tap away. */
function withLightOnHome() {
  const document = structuredClone(fixture.document);
  const light = structuredClone(find(document.pages, 'hc-lights-demo-room-1-item-1'));
  const parentOf = (value: any): any => { if (!value || typeof value !== 'object') return undefined; if (Array.isArray(value.children) && value.children.some((child: any) => child.type === 'action-tile')) return value; for (const child of Object.values(value)) { const hit = parentOf(child); if (hit) return hit; } };
  const guests = parentOf(document.pages[0]);
  guests.children.push({ ...light, id: 'demo-hall-light', title: 'Hall light' });
  return document;
}
test.beforeEach(async ({ request }) => { await seed(request, withLightOnHome()); });

/** Home Assistant's entities, named the way a person names them; the ids are the fixture's own lights. */
async function stubHouse(page: Page) {
  const named: Record<number, [string, string]> = { 308: ['Hall lamp', 'Hallway'], 309: ['Reading lamp', 'Study'], 310: ['Desk lamp', 'Study'] };
  const states = Object.entries(named).map(([at, [name]]) => ({ entityId: `light.demo_entity_${at}`, name, state: 'on' }));
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}

/** The entity the saved draft's node reads. */
async function savedEntity(page: Page, nodeId: string): Promise<string | undefined> {
  const { document } = await (await page.request.get('/native/api/draft')).json();
  let found: any;
  const walk = (value: any) => { if (!value || typeof value !== 'object') return; if (value.id === nodeId && value.props) found = value; Object.values(value).forEach(walk); };
  walk(document.pages);
  const source = document.dataSources.find((item: any) => item.id === (found?.binding?.sourceId ?? found?.props?.sourceId));
  return source?.inputs?.entityId?.value ?? source?.entityId?.value;
}

test('the entity field names the light, searches by name, and rebinds the tile to another light as one undo step', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Hall light');
  const field = panel.locator('[data-field-path$="props/sourceId"]');
  const button = field.getByRole('button', { name: 'Entity' });
  await expect(button).toContainText('Hall lamp');
  await expect(button).toContainText('light.demo_entity_308');
  await expect(panel.locator('select').filter({ hasText: 'Choose a source' })).toHaveCount(0);
  await button.click();
  const search = page.getByRole('searchbox', { name: 'Search entities' });
  await expect(search).toBeVisible();
  await search.fill('lamp');
  await expect(page.locator('[data-entity]')).toHaveCount(3);
  await search.fill('reading');
  const option = page.locator('[data-entity="light.demo_entity_309"]');
  await expect(option).toBeVisible();
  await snap(page, isPhone(page) ? 'phone-entity-picker' : 'desktop-entity-picker');
  await option.click();
  await expect(button).toContainText('Reading lamp');
  await expect.poll(() => savedEntity(page, 'demo-hall-light')).toBe('light.demo_entity_309');
  await page.getByRole('button', { name: 'Undo' }).click();
  // On a phone the undo returns to the preview, so the field is only read back where the panel stays open.
  if (!isPhone(page)) await expect(button).toContainText('Hall lamp');
  await expect.poll(() => savedEntity(page, 'demo-hall-light')).toBe('light.demo_entity_308');
});

test('a tile that reads a model lists its models in a Models group, without an entity list', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  await panel.locator('[data-field-path$="sourceId"]').first().getByRole('button', { name: 'Entity' }).click();
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.locator('[data-entity]')).toHaveCount(0);
  expect(await page.locator('[role=option][data-choice]').count()).toBeGreaterThan(1);
});

/** A house with lights, switches and input booleans, so the picker could offer a wrong kind. */
async function stubMixedHouse(page: Page) {
  const states = [['light.lamp_15', 'Lamp 15'], ['light.demo_entity_308', 'Hall lamp'], ['switch.plug_1', 'Plug 1'], ['input_boolean.guest_mode', 'Guest mode'], ['sensor.hall_temperature', 'Hall temperature']]
    .map(([entityId, name]) => ({ entityId, name, state: 'on' }));
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}

for (const width of [390, 430]) {
  test(`at ${width} px a Toggle Power tile lists only switches and input booleans, so no pick leaves the draft invalid`, async ({ page }) => {
    test.skip(!isPhone(page) && width !== 390, 'the second width is a phone width');
    await page.setViewportSize({ width: isPhone(page) ? width : 1440, height: isPhone(page) ? 844 : 900 });
    await stubMixedHouse(page);
    await openWorkspace(page);
    const toggle = await selectTile(page, 'Demo Guests 1');
    await toggle.locator('[data-field-path$="binding/sourceId"]').getByRole('button', { name: 'Entity' }).click();
    await expect(page.locator('[data-entity="switch.plug_1"]')).toBeVisible();
    await expect(page.locator('[data-entity="input_boolean.guest_mode"]')).toBeVisible();
    await expect(page.locator('[data-entity="light.lamp_15"]')).toHaveCount(0);
    await expect(page.locator('[data-entity="sensor.hall_temperature"]')).toHaveCount(0);
    // Searching for the light finds nothing, and a typed light id is not offered either.
    const search = page.getByRole('searchbox', { name: 'Search entities' });
    await search.fill('lamp');
    await expect(page.locator('[data-entity]')).toHaveCount(0);
    await search.fill('light.lamp_15');
    await expect(page.getByRole('option', { name: /Use/ })).toHaveCount(0);
    await expect(page.locator('[data-restricted]')).toContainText('switch and input boolean only');
    await snap(page, `entity-restricted-${width}`);
    await search.fill('plug');
    await page.locator('[data-entity="switch.plug_1"]').click();
    await expect(page.getByText('Not Saved')).toHaveCount(0);
    await expect.poll(() => savedEntity(page, 'hc-home-guest-0')).toBe('switch.plug_1');
  });

  test(`at ${width} px a light tile lists lights, switches and input booleans but not sensors`, async ({ page }) => {
    test.skip(!isPhone(page) && width !== 390, 'the second width is a phone width');
    await page.setViewportSize({ width: isPhone(page) ? width : 1440, height: isPhone(page) ? 844 : 900 });
    await stubMixedHouse(page);
    await openWorkspace(page);
    const panel = await selectTile(page, 'Hall light');
    await panel.locator('[data-field-path$="props/sourceId"]').getByRole('button', { name: 'Entity' }).click();
    await expect(page.locator('[data-entity="light.lamp_15"]')).toBeVisible();
    await expect(page.locator('[data-entity="switch.plug_1"]')).toBeVisible();
    await expect(page.locator('[data-entity="sensor.hall_temperature"]')).toHaveCount(0);
    await page.locator('[data-entity="light.lamp_15"]').click();
    await expect(page.getByText('Not Saved')).toHaveCount(0);
    await expect.poll(() => savedEntity(page, 'demo-hall-light')).toBe('light.lamp_15');
  });
}
