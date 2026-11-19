import { test, expect, panelDocument, haToken } from './data-tab-harness';
import { openLibrary, openWorkspace, seed } from './workspace2-helpers';

test.beforeEach(async ({ request, ha }) => {
  ha.setEntity('switch.demo_light_1', 'on');
  await seed(request, panelDocument());
});

test('Data is read-only, grouped by entity area then device area, with live state and named readers', async ({ page, ha, request }) => {
  const response = await request.get('/native/api/ha/areas');
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain(haToken);
  await openWorkspace(page);
  await openLibrary(page, 'Data');
  const panel = page.getByTestId('data-panel');
  await expect(panel.getByText('From Home Assistant · read only')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'In Use · 5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Everything · 8' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Kitchen, 2' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'Hall, 2' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'No Area, 1' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'Kitchen, 2' })).toContainText('Desk Lamp, Kitchen Lamp');
  await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
  const lamp = panel.locator('.w2-ha-entity').filter({ hasText: 'Kitchen Lamp' });
  await expect(lamp.locator('.w2-ha-state')).toHaveText('on');
  await expect(lamp.locator('.w2-ha-readers')).toContainText('Lights');
  await expect(lamp.locator('.w2-ha-readers')).toContainText('Kitchen Lights');
  ha.setEntity('switch.demo_light_1', 'off');
  await expect(lamp.locator('.w2-ha-state')).toHaveText('off');
  await expect(panel).not.toContainText('demo-light-1');
  await expect(panel).not.toContainText('switch.demo_light_1');
  await expect(panel.getByRole('region', { name: 'Logic Templates' })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Data Flows' })).toHaveCount(0);
  await expect(panel.getByText('Listed while a tile or flow reads it. Nothing to add or clean up.')).toBeVisible();
  await panel.getByRole('button', { name: 'Everything · 8' }).click();
  await expect(panel.getByRole('button', { name: 'Loft, 1' })).toHaveAttribute('aria-expanded', 'false');
  await panel.getByPlaceholder('Find an entity, device or area').fill('Loft');
  await expect(panel.getByRole('button', { name: 'Loft, 1' })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Loft Temperature', { exact: true })).toBeVisible();
  await expect(panel.getByText('24.3 C', { exact: true })).toBeVisible();
  await panel.getByPlaceholder('Find an entity, device or area').fill('Entry Hub');
  await expect(panel.getByText('Hall Lamp', { exact: true })).toBeVisible();
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(haToken);
});

test('area groups remember expansion and a selected component reveals the entities it reads', async ({ page }) => {
  await openWorkspace(page);
  await openLibrary(page, 'Data');
  const panel = page.getByTestId('data-panel');
  const kitchen = panel.getByRole('button', { name: 'Kitchen, 2' });
  await kitchen.click();
  await page.reload();
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await kitchen.click();
  await openLibrary(page, 'Flows');
  const flows = page.getByTestId('flows-panel');
  await flows.getByRole('button', { name: /^Inside a Field, / }).click();
  await flows.getByRole('region', { name: 'Inside a Field' }).getByRole('button', { name: /^Lights · / }).first().click();
  await openLibrary(page, 'Data');
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Data panel evidence in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    await openLibrary(page, 'Data');
    const panel = page.getByTestId('data-panel');
    await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
    await panel.getByRole('button', { name: 'Hall, 2' }).click();
    await page.screenshot({ path: `test-results/lane-b/data-${scheme}.png`, animations: 'disabled' });
  });
}
