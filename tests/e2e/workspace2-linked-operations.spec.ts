import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, seed } from './workspace2-helpers';
import { draftDocument } from '../flows-canvas/draft/fixtures';
import type { CompositionDocument } from '../../src/shared/composition/schema';

/**
 * Changes that drop linked values say so first (docs/flows-canvas.md, "Declared operations"): Import says it replaces the
 * whole draft, and Remove Setting names how many tiles lose the value they fill in. Cancel changes nothing.
 */

/** Two tiles whose Subtitle uses "Tile label", each filling its Source setting in from the tile's own entity. */
const linked = (): CompositionDocument => {
  const document = draftDocument();
  return { ...document, logicLibrary: [{ ...document.logicLibrary[0], params: [{ name: 'source', kind: 'source-id', sample: 'source-b' }] }] } as unknown as CompositionDocument;
};
const saved = async (page: Page): Promise<CompositionDocument> => (await (await page.request.get('/native/api/draft')).json()).document;

test.beforeEach(async ({ request, page }) => {
  await seed(request, linked());
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} },
    currentUser: { id: 'u-demo', isAdmin: true }, states: [{ entityId: 'sensor.demo_0', name: 'Demo 0', state: 'on' }, { entityId: 'sensor.demo_1', name: 'Demo 1', state: 'off' }] } }));
});
test.use({ actionTimeout: 8000 });

test('Import says it replaces the whole draft; Cancel keeps it, Replace takes the imported document', async ({ page }) => {
  await openWorkspace(page);
  await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Import…', exact: true }).click();
  else await page.getByRole('menuitem', { name: 'Import…', exact: true }).click();
  await expect(page.getByTestId('import-replaces')).toHaveText('Importing replaces this whole draft, including its linked values and saved canvas layouts.');
  const imported = { ...linked(), name: 'Imported house', logicUseBindings: undefined };
  await page.getByLabel('Paste JSON').fill(JSON.stringify(imported));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const question = page.getByRole('dialog', { name: 'Replace the Draft?' });
  await expect(question).toContainText('The imported document replaces everything in this draft, including its linked values and saved canvas layouts. Undo brings it back.');
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toHaveCount(0);
  expect((await saved(page)).logicUseBindings).toHaveLength(2);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog', { name: 'Replace the Draft?' }).getByRole('button', { name: 'Replace' }).click();
  await expect.poll(async () => (await saved(page)).name, { timeout: 15_000 }).toBe('Imported house');
  expect((await saved(page)).logicUseBindings).toBeUndefined();
});

test('Remove Setting names the tiles that lose the value; Cancel keeps it, Remove Setting removes their links', async ({ page }) => {
  await openWorkspace(page);
  let panel;
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    panel = page.locator('.w2-data');
  } else {
    await openLibrary(page, 'Flows');
    panel = page.getByTestId('flows-panel');
    const group = panel.getByRole('button', { name: /^Templates, \d+$/ });
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  }
  await panel.getByTestId('logic-group').getByRole('button', { name: /^Tile label/ }).click();
  const settings = page.getByTestId('logic-editor').getByTestId('logic-settings');
  await settings.getByRole('button', { name: /^source, Entity/ }).click();
  await settings.getByRole('button', { name: 'Remove Setting' }).click();
  const question = page.getByTestId('link-loss-question');
  await expect(question).toContainText('Remove “source”?');
  await expect(question).toContainText('2 tiles that fill it in will lose that value.');
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toHaveCount(0);
  await expect(settings.getByRole('button', { name: /^source, Entity/ })).toBeVisible();
  expect((await saved(page)).logicUseBindings).toHaveLength(2);
  await settings.getByRole('button', { name: /^source, Entity/ }).click();
  await settings.getByRole('button', { name: 'Remove Setting' }).click();
  await page.getByTestId('link-loss-question').getByRole('button', { name: 'Remove Setting' }).click();
  await expect(settings.getByRole('button', { name: /^source, Entity/ })).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).logicUseBindings ?? [], { timeout: 15_000 }).toEqual([]);
  expect((await saved(page)).logicLibrary?.[0].params).toEqual([]);
});
