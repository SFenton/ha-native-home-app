import { expect, test, type Page } from '@playwright/test';

/** A phone-width window of the device fixtures, in Use unless a test says otherwise. */
const story = (page: Page, surface: string, mode = 'use') => page.goto(`/?preview2=1&fixture=devices&panel=0&bezel=0&mode=${mode}&surface=page:${surface}`);
const menu = (page: Page) => page.getByRole('menu');
const patient = { timeout: 20_000 };

/** Every request that could reach Home Assistant: the Studio's own API is the only thing the preview may call, and never a service. */
function watchServiceCalls(page: Page) {
  const calls: string[] = [];
  page.on('request', request => { if (/call_service|\/api\/services|\/ha\/service|websocket/i.test(request.url()) && request.method() !== 'GET') calls.push(`${request.method()} ${request.url()}`); });
  return calls;
}

// Native: `UKVacuumSettingRow` (apple/Sources/HassUI/UIKitPort/Features/Vacuums/UKVacuumComponents.swift:176-206) is a button with
// `showsMenuAsPrimaryAction` whose `UIMenu` lists the select's options and checks the current one.
for (const [title, from, to, shown] of [['Mode', 'Vacuum and Mop', 'Mop', ['Vacuum', 'Mop', 'Vacuum and Mop']], ['Fan', 'Max', 'Quiet', ['Quiet', 'Balanced', 'Turbo', 'Max']],
  ['Water', 'Medium', 'High', ['Low', 'Medium', 'High']], ['Passes', '2x', '3x', ['1x', '2x', '3x']]] as const) {
  test(`the vacuum's ${title} row opens a pull-down of its options and a pick changes the simulated value only`, async ({ page }) => {
    const calls = watchServiceCalls(page);
    await story(page, 'page-vacuum');
    const row = page.getByRole('button', { name: title, exact: true });
    await expect(row).toContainText(from, patient);
    await row.click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('menuitemradio')).toHaveText([...shown]);
    await expect(menu(page).getByRole('menuitemradio', { name: from, exact: true })).toHaveAttribute('aria-checked', 'true');
    await menu(page).getByRole('menuitemradio', { name: to, exact: true }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(row).toContainText(to);
    await row.click();
    await expect(menu(page).getByRole('menuitemradio', { name: to, exact: true })).toHaveAttribute('aria-checked', 'true');
    expect(calls, 'no service reached Home Assistant').toEqual([]);
  });
}

test('the thermostat hub opens its Mode and Fan menus and a pick updates the simulated state', async ({ page }) => {
  const calls = watchServiceCalls(page);
  await story(page, 'page-climate');
  const hub = page.locator('[data-type=climate-control]').filter({ hasText: 'Thermostat Hub' });
  await expect(hub).toBeVisible(patient);
  await hub.getByRole('button', { name: 'Mode', exact: true }).click();
  await expect(menu(page).getByRole('menuitemradio', { name: 'Heat' })).toHaveAttribute('aria-checked', 'true');
  await menu(page).getByRole('menuitemradio', { name: 'Cool' }).click();
  await expect(hub.getByRole('button', { name: 'Mode', exact: true })).toContainText('Cool');
  await hub.getByRole('button', { name: 'Fan', exact: true }).click();
  const fans = await menu(page).getByRole('menuitemradio').allTextContents();
  expect(fans.length).toBeGreaterThan(1);
  await menu(page).getByRole('menuitemradio').last().click();
  await expect(hub.getByRole('button', { name: 'Fan', exact: true })).toContainText(fans.at(-1)!);
  expect(calls).toEqual([]);
});

test('the lighting mode row opens a menu of the modes', async ({ page }) => {
  await story(page, 'page-lights');
  const row = page.getByRole('button', { name: 'Lighting Mode', exact: true });
  await row.click();
  await expect(menu(page).getByRole('menuitemradio')).toHaveText(['Warm White', 'Holiday', 'Custom']);
  await menu(page).getByRole('menuitemradio', { name: 'Custom' }).click();
  await expect(row).toContainText('Custom');
});

test('Esc and a press outside close a menu without a pick, and the menu stays inside the screen', async ({ page }) => {
  await story(page, 'page-vacuum');
  const row = page.getByRole('button', { name: 'Fan', exact: true });
  await row.click();
  const box = (await menu(page).boundingBox())!, screen = (await page.locator('.sh-layer').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(screen.x);
  expect(box.x + box.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(screen.y);
  expect(box.y + box.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(row).toContainText('Max');
  await row.click();
  await page.mouse.click(screen.x + 12, screen.y + screen.height / 2);
  await expect(menu(page)).toHaveCount(0);
  await expect(row).toContainText('Max');
});

test('in Edit a press on the row selects it and opens nothing', async ({ page }) => {
  await story(page, 'page-vacuum', 'edit');
  await page.getByRole('button', { name: 'Fan', exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.sh-page[data-current] [data-selected]')).toHaveCount(1);
});
