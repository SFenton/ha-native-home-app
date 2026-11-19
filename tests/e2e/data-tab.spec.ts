import { test, expect, panelDocument, haToken } from './data-tab-harness';
import { isPhone, openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';
import type { Page } from '@playwright/test';

async function openData(page: Page) {
  if (!isPhone(page)) return openLibrary(page, 'Data');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.locator('.w2-project-sheet').getByRole('button', { name: 'Data', exact: true }).click();
}

test.beforeEach(async ({ request, ha }) => {
  ha.setEntity('switch.demo_light_1', 'on');
  await seed(request, panelDocument());
});

test('Data is read-only, grouped by area, with live state and named readers', async ({ page, ha }) => {
  await openWorkspace(page);
  await openData(page);
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
  await panel.getByRole('searchbox', { name: 'Find an entity, device or area' }).fill('Loft');
  await expect(panel.getByRole('button', { name: 'Loft, 1' })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Loft Temperature', { exact: true })).toBeVisible();
  await expect(panel.getByText('24.3 C', { exact: true })).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Find an entity, device or area' }).fill('Entry Hub');
  await expect(panel.getByText('Hall Lamp', { exact: true })).toBeVisible();
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(haToken);
  await expect(panel.getByRole('region', { name: 'From Home Assistant', exact: true }).getByRole('button', { name: 'Source', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'App and model sources' }).getByRole('button', { name: 'Source', exact: true })).toBeVisible();
  const search = panel.getByRole('searchbox');
  await expect(search).toHaveAttribute('placeholder', 'Find an entity or area');
  expect(await search.evaluate(input => {
    const style = getComputedStyle(input), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    context.font = style.font;
    return context.measureText(input.getAttribute('placeholder')!).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  })).toBe(true);
});

test('App and Models remain editable and Source creation opens its fields', async ({ page }) => {
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  await panel.getByRole('button', { name: 'App, 1' }).click();
  await panel.getByRole('button', { name: /^Clock, source,/ }).click();
  await expect(page.locator('[data-field-path^="dataSources/"]').first()).toBeVisible();
  if (isPhone(page)) await page.locator('.w2-back').click();
  await panel.getByRole('region', { name: 'App and model sources' }).getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Weather', exact: true }).click();
  const editor = isPhone(page) ? page.getByRole('dialog', { name: 'Project', exact: true }) : page.getByRole('complementary', { name: 'Properties' });
  await expect(editor.getByRole('heading', { name: 'Weather', exact: true })).toBeVisible();
  const value = editor.getByRole('textbox', { name: 'Value', exact: true });
  await value.fill('weather.demo_forecast');
  await value.press('Tab');
  await expect(value).toHaveValue('weather.demo_forecast');
});

test('area groups remember expansion and a selected component reveals the entities it reads', async ({ page }) => {
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  const kitchen = panel.getByRole('button', { name: 'Kitchen, 2' });
  await kitchen.click();
  await page.reload();
  if (isPhone(page)) await openData(page);
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await kitchen.click();
  if (isPhone(page)) return;
  await openLibrary(page, 'Flows');
  const flows = page.getByTestId('flows-panel');
  await flows.getByRole('button', { name: /^Inside a Field, / }).click();
  await flows.getByRole('region', { name: 'Inside a Field' }).getByRole('button', { name: /^Lights · / }).first().click();
  await openData(page);
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
});

test('Data disclosures still work when localStorage is denied', async ({ page }) => {
  await page.addInitScript(() => { for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { value() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel'), kitchen = panel.getByRole('button', { name: 'Kitchen, 2' });
  await expect(kitchen).toHaveAttribute('aria-expanded', 'false');
  await kitchen.click();
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
  const preview = panel.locator('.w2-group-preview').first();
  expect(await preview.evaluate(element => getComputedStyle(element).textAlign)).toBe('start');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Data panel evidence in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    await openData(page);
    const panel = page.getByTestId('data-panel');
    await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
    await panel.getByRole('button', { name: 'Hall, 2' }).click();
    if (!isPhone(page)) await snap(page, `desktop-${scheme}-data`);
  });
}
