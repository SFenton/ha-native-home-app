import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed } from './workspace2-helpers';

/**
 * The pairing step (lane `tile-templates-strings`): a place of a template whose Source setting reads one entity shows an Entity row. Choosing an entity
 * makes or finds the model source and sets only that place; Undo takes it back in one step. The fixture is the home-domains house with a Light Tile
 * template used in two places; every entity is invented. Runs on the desktop and phone projects.
 */
const fixture = JSON.parse(readFileSync(new URL('../fixtures/templates-light-tile.json', import.meta.url), 'utf8')) as { document: object };
const panel = (page: Page) => page.getByLabel('Properties');
const NEW_ENTITY = 'light.demo_pair_new';

type Place = { id: string; args?: Record<string, string> };
async function places(request: APIRequestContext): Promise<{ places: Place[]; sources: { id: string; entity?: string }[] }> {
  const { document } = await (await request.get('/native/api/draft')).json();
  const refs = (document.pages[0].components as Place[]).filter(node => node.id.startsWith('demo-light-'));
  const sources = (document.dataSources as { id: string; inputs?: { entityId?: { value?: string } } }[]).map(source => ({ id: source.id, entity: source.inputs?.entityId?.value }));
  return { places: refs, sources };
}

test('the Entity row of a place makes the source for a new entity, sets only that place, and Undo restores it', async ({ page, request }) => {
  await seed(request, fixture.document);
  await openWorkspace(page);
  await previewRoot(page).getByText('Demo Light B', { exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Demo Light B', exact: true })).toBeVisible();
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  const before = await places(request);

  const row = panel(page).getByRole('button', { name: 'Entity', exact: true });
  await expect(row).toContainText('light.demo_entity_308');
  await expect(panel(page).getByRole('button', { name: /Data source/ })).toHaveCount(0);
  await row.click();
  const search = page.getByRole('searchbox', { name: 'Search entities' });
  await search.fill(NEW_ENTITY);
  await search.press('Enter');

  await expect.poll(async () => (await places(request)).sources.some(source => source.entity === NEW_ENTITY)).toBe(true);
  const after = await places(request);
  const made = after.sources.find(source => source.entity === NEW_ENTITY)!;
  expect(after.places.find(place => place.id === 'demo-light-b')!.args!.light).toBe(made.id);
  expect(after.places.find(place => place.id === 'demo-light-a')).toEqual(before.places.find(place => place.id === 'demo-light-a'));
  await expect(panel(page).getByRole('button', { name: 'Entity', exact: true })).toContainText(NEW_ENTITY);

  // On a phone the open properties sheet covers the toolbar.
  if (isPhone(page)) { await panel(page).getByRole('button', { name: 'Close' }).first().click(); await expect(panel(page)).toHaveCount(0); }
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => (await places(request)).places.find(place => place.id === 'demo-light-b')!.args!.light).toBe(before.places.find(place => place.id === 'demo-light-b')!.args!.light);
  expect((await places(request)).sources.some(source => source.entity === NEW_ENTITY)).toBe(false);
});

test('choosing an entity that already has a source shares it and adds none', async ({ page, request }) => {
  await seed(request, fixture.document);
  await openWorkspace(page);
  await previewRoot(page).getByText('Demo Light B', { exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Demo Light B', exact: true })).toBeVisible();
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  const before = await places(request);
  await panel(page).getByRole('button', { name: 'Entity', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search entities' });
  await search.fill('light.demo_entity_307');
  await search.press('Enter');
  await expect.poll(async () => (await places(request)).places.find(place => place.id === 'demo-light-b')!.args!.light).toBe('hc-light-light-demo-entity-307');
  expect((await places(request)).sources.length).toBe(before.sources.length);
});
