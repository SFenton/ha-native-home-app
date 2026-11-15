import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

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
  const source = document.dataSources.find((item: any) => item.id === found?.props?.sourceId);
  return source?.inputs?.entityId?.value ?? source?.entityId?.value;
}

test('the entity field names the light, searches by name, and rebinds the tile to another light as one undo step', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Device 1');
  const field = panel.locator('[data-field-path$="props/sourceId"]');
  const button = field.getByRole('button', { name: 'Entity' });
  await expect(button).toContainText('Hall lamp');
  await expect(button).toContainText('light.demo_entity_308');
  await expect(panel.locator('select').filter({ hasText: 'Choose a source' })).toHaveCount(0);
  await button.click();
  const search = page.getByRole('searchbox', { name: 'Search entities' });
  await expect(search).toBeVisible();
  await search.fill('study');
  await expect(page.locator('[data-entity]')).toHaveCount(2);
  await search.fill('reading');
  const option = page.locator('[data-entity="light.demo_entity_309"]');
  await expect(option).toBeVisible();
  await snap(page, isPhone(page) ? 'phone-entity-picker' : 'desktop-entity-picker');
  await option.click();
  await expect(button).toContainText('Reading lamp');
  await expect.poll(() => savedEntity(page, 'hc-lights-demo-room-1-item-1')).toBe('light.demo_entity_309');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(button).toContainText('Hall lamp');
  await expect.poll(() => savedEntity(page, 'hc-lights-demo-room-1-item-1')).toBe('light.demo_entity_308');
});

test('a tile that reads a model lists its models in a Models group, without an entity list', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  await panel.locator('[data-field-path$="sourceId"]').first().getByRole('button', { name: 'Entity' }).click();
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.locator('[data-entity]')).toHaveCount(0);
  expect(await page.locator('[role=option][data-choice]').count()).toBeGreaterThan(1);
});
