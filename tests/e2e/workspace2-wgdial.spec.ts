import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * The gauge parts in the Studio (lane `wg-s4`): the Add picker offers Dial and Arc, each lands as a part that compiles, and the inspector shows the rows the
 * schema gives it, with an Opacity on every color. Desktop and phone, in a light and a dark color scheme.
 */
test.beforeEach(async ({ request, page }) => {
  await seed(request);
  // The first page of a cold dev server takes a while to compile: warm it, so the helpers' short waits are enough.
  await page.goto('/');
  await page.getByRole('button', { name: 'Publish' }).waitFor({ timeout: 45_000 }).catch(() => undefined);
});

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
async function add(page: Page, name: string, heading: string) {
  if (isPhone(page)) await page.locator('.w2-bottom-add').click();
  else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) }).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: heading })).toBeVisible();
  return panel;
}

test('the Add picker offers the dial and the arc', async ({ page }) => {
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  for (const name of ['Dial', 'Arc']) await expect(picker.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) }).first()).toBeVisible();
  await snap(page, `${prefix(page)}-wgdial-add-picker`);
});

for (const scheme of ['dark', 'light'] as const) {
  test(`a dial shows its sweep, scale, pointer, ticks and look rows in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    const panel = await add(page, 'Dial', 'New dial');
    for (const label of ['Value scale', 'Indicator', 'Text in the middle', 'Starts at', 'Length', 'How many', 'Inner end', 'Outer end', 'Color opacity', 'Every second tick', 'Skipped ticks', 'Letters', 'Flag', 'Size', 'Widest', 'Width over height', 'Centre down the height', 'Flip in right-to-left', 'Accessibility']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
    await expect(previewRoot(page)).toBeVisible();
    await snap(page, `${prefix(page)}-wgdial-inspector-dial-${scheme}`);
  });

  test(`an arc shows its curve, box, progress, line, horizon and marker rows in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    const panel = await add(page, 'Arc', 'New arc');
    for (const label of ['Box', 'Progress', 'Progress scale', 'Start', 'Bend toward', 'End', 'Size', 'Line color', 'Line color opacity', 'Line width', 'Dashes', 'Horizon', 'Widest', 'Flip in right-to-left', 'Accessibility']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
    await snap(page, `${prefix(page)}-wgdial-inspector-arc-${scheme}`);
  });
}

test('a dial added draws in the preview with the ticks and the lit tick it starts with', async ({ page }) => {
  await openWorkspace(page);
  await add(page, 'Dial', 'New dial');
  const dial = previewRoot(page).locator('.sh-dial').first();
  await expect(dial.locator('.sh-dial-ticks')).toHaveCount(1);
  expect(((await dial.locator('.sh-dial-ticks').getAttribute('d')) ?? '').match(/M/g)).toHaveLength(25);
  await expect(dial.locator('.sh-dial-lit')).toHaveCount(1);
});

test('an arc added draws its curve and its marker at half', async ({ page }) => {
  await openWorkspace(page);
  await add(page, 'Arc', 'New arc');
  const arc = previewRoot(page).locator('.sh-arc').first();
  await expect(arc.locator('.sh-arc-curve')).toHaveCount(1);
  await expect(arc.locator('.sh-arc-marker')).toHaveCount(1);
  await expect(arc.locator('.sh-arc-marker')).toHaveAttribute('data-t', '0.5');
});
