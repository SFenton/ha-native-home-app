import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewTile, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

/** Stubs Home Assistant's entities with a house of `count` entities, so the pickers have a live list. */
async function stubHouse(page: Page, count = 60) {
  const states = Array.from({ length: count }, (_, at) => {
    const domain = ['light', 'switch', 'sensor', 'binary_sensor', 'scene'][at % 5];
    return { entityId: `${domain}.demo_${at}`, name: `${domain === 'light' ? 'Lamp' : domain === 'switch' ? 'Plug' : domain === 'scene' ? 'Scene' : 'Sensor'} ${at}`, state: domain === 'sensor' ? '21' : 'on' };
  });
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}

test('the A key opens the picker, and choosing a tile adds it after the selection, selects it and opens its properties', async ({ page }) => {
  test.skip(isPhone(page), 'The keyboard route is wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  await page.keyboard.press('a');
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  await snap(page, 'desktop-add-picker');
  await picker.getByRole('listitem').filter({ hasText: 'Row' }).first().click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New row' })).toBeVisible();
});

test('add a button, set it to call a service on an entity, without typing an id', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  let steps = 0;
  const step = async <T,>(action: () => Promise<T>) => { steps += 1; return action(); };
  if (isPhone(page)) await step(() => page.locator('.w2-bottom-add').click());
  else await step(() => page.locator('.w2-add-slot').last().click());
  const picker = page.getByTestId('add-picker');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-add-picker`);
  await step(() => picker.getByRole('listitem').filter({ hasText: 'Button' }).first().click());
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'New button' })).toBeVisible();
  await step(() => panel.getByRole('button', { name: /When tapped/ }).click());
  const editor = page.getByTestId('action-editor');
  await expect(editor).toBeVisible();
  await step(() => editor.getByRole('button', { name: 'Call a Service' }).click());
  await step(() => editor.getByRole('button', { name: 'Service', exact: true }).click());
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-service-picker`);
  await step(() => page.getByRole('option', { name: /Light: Turn on/ }).first().click());
  await step(() => editor.getByRole('button', { name: 'Target', exact: true }).click());
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-entity-picker`);
  await step(() => page.getByRole('option', { name: /Lamp 0/ }).first().click());
  await expect(editor.locator('[data-target="light.demo_0"]')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-action-editor`);
  await step(() => page.getByRole('button', { name: 'Done', exact: true }).click());
  await expect(panel.getByRole('button', { name: /When tapped/ })).toContainText('light.turn_on');
  console.log(`STEPS ${isPhone(page) ? 'phone' : 'desktop'}: ${steps}`);
});
