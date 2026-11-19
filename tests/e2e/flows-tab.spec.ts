import { test, expect, panelDocument } from './data-tab-harness';
import { openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';

// These assert the desktop library rail; the phone's pushed editors are covered by workspace2-data/logic and its Data sheet by data-tab.
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The library rail is desktop-only');
test.beforeEach(async ({ request }) => { await seed(request, panelDocument()); });

test('Flows is between Controls and Data and opens existing templates, flows and component fields', async ({ page }) => {
  await openWorkspace(page);
  const labels = await page.getByTestId('library-rail').getByRole('button').allTextContents();
  expect(labels.slice(-3)).toEqual(['Controls', 'Flows', 'Data']);
  await openLibrary(page, 'Flows');
  const panel = page.getByTestId('flows-panel');
  await expect(panel.getByText(/3 templates · 3 flows · \d+ fields with logic/)).toBeVisible();
  for (const name of ['Templates, 3', 'Flows, 3']) await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.w2-group-preview').first()).toContainText('Count or All, Yours or Theirs');
  await panel.getByRole('button', { name: 'Templates, 3' }).click();
  await panel.getByRole('button', { name: /^Count or All, logic template/ }).click();
  await expect(page.getByTestId('logic-editor')).toBeVisible();
  await panel.getByRole('button', { name: 'Flows, 3' }).click();
  await panel.getByRole('button', { name: /^Kitchen Lights, data flow/ }).click();
  await expect(page.getByTestId('flow-editor')).toBeVisible();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Kitchen Lights', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /^Inside a Field, / }).click();
  const field = panel.getByRole('region', { name: 'Inside a Field' }).getByRole('button', { name: /^Lights · / }).first();
  await field.click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path'))).toBe('pages/0/components/0/children/0/props/subtitle');
});

test('groups remember choices, reveal open items, and search expands matching groups temporarily', async ({ page }) => {
  await openWorkspace(page);
  await openLibrary(page, 'Flows');
  const panel = page.getByTestId('flows-panel'), templates = panel.getByRole('button', { name: 'Templates, 3' });
  await templates.click();
  await page.reload();
  await expect(templates).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('button', { name: /^Night Hours, logic template/ }).click();
  await templates.click();
  await expect(templates).toHaveAttribute('aria-expanded', 'false');
  await openLibrary(page, 'Data');
  await openLibrary(page, 'Flows');
  await expect(templates).toHaveAttribute('aria-expanded', 'true');
  await templates.click();
  await panel.getByPlaceholder('Find a flow').fill('Night Hours');
  await expect(panel.getByRole('button', { name: 'Templates, 1' })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: /^Night Hours, logic template/ })).toBeVisible();
  await panel.getByPlaceholder('Find a flow').clear();
  await expect(templates).toHaveAttribute('aria-expanded', 'false');
});

test('the panels work when localStorage is denied and retain the existing create paths', async ({ page }) => {
  await page.addInitScript(() => { for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { value() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await openWorkspace(page);
  await openLibrary(page, 'Flows');
  const panel = page.getByTestId('flows-panel');
  await panel.getByRole('button', { name: 'New Flow', exact: true }).click();
  await page.getByRole('menuitem', { name: /Nothing/ }).click();
  await expect(page.getByTestId('flow-editor')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Flows, 4' })).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('button', { name: 'Logic Template', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Condition', exact: true }).click();
  await expect(page.getByTestId('logic-editor')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Templates, 4' })).toHaveAttribute('aria-expanded', 'true');
  await openLibrary(page, 'Data');
  await page.getByTestId('data-panel').getByRole('button', { name: /^Everything/ }).click();
  await page.getByTestId('data-panel').getByRole('button', { name: 'Kitchen, 2' }).click();
  await expect(page.getByTestId('data-panel').getByText('Kitchen Lamp', { exact: true })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Flows panel evidence in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    await openLibrary(page, 'Flows');
    const panel = page.getByTestId('flows-panel');
    await panel.getByRole('button', { name: 'Templates, 3' }).click();
    await panel.getByRole('button', { name: 'Flows, 3' }).click();
    await snap(page, `desktop-${scheme}-flows`);
  });
}
