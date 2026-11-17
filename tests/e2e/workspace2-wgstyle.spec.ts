import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * The generic style parts in the Studio (lane `wg-s1`): the Add picker offers Stack, Shape and Symbol (and Text, whose style rows grew), each lands as
 * a part that compiles, and the inspector shows the rows that part's schema gives it, with an Opacity on every color and a dark-mode switch.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

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

test('the Add picker offers the generic parts', async ({ page }) => {
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  for (const name of ['Stack', 'Shape', 'Symbol']) await expect(picker.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) }).first()).toBeVisible();
  await snap(page, `${prefix(page)}-wgstyle-add-picker`);
});

test('a stack shows its direction, spacing, surface, lines between and collapse rows', async ({ page }) => {
  await openWorkspace(page);
  const panel = await add(page, 'Stack', 'New stack');
  for (const label of ['Direction', 'Spacing', 'Lines between', 'Collapse to a column']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
  await snap(page, `${prefix(page)}-wgstyle-inspector-stack`);
});

test('a shape shows its form, size and a color with Opacity and a dark-mode switch', async ({ page }) => {
  await openWorkspace(page);
  const panel = await add(page, 'Shape', 'New shape');
  for (const label of ['Shape', 'Height']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
  await expect(panel.getByRole('spinbutton', { name: 'Color opacity' })).toHaveValue('100');
  const toggle = panel.getByRole('switch', { name: 'Color differs in dark mode' });
  await toggle.scrollIntoViewIfNeeded();
  await snap(page, `${prefix(page)}-wgstyle-inspector-shape`);
  await toggle.click();
  await expect(panel.getByRole('spinbutton', { name: 'Color in dark mode opacity' })).toBeAttached();
  await snap(page, `${prefix(page)}-wgstyle-inspector-shape-pair`);
});

test('a symbol shows its name, size, colors and a spoken-name row', async ({ page }) => {
  await openWorkspace(page);
  const panel = await add(page, 'Symbol', 'New symbol');
  for (const label of ['Symbol', 'Points', 'Colors', 'Turn']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
  await snap(page, `${prefix(page)}-wgstyle-inspector-symbol`);
});

test('a text shows the font, color, lines and overflow rows the style adds', async ({ page }) => {
  await openWorkspace(page);
  const panel = await add(page, 'Text', 'New text');
  for (const label of ['Font', 'Color', 'Most lines', 'When it does not fit']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
  await snap(page, `${prefix(page)}-wgstyle-inspector-text`);
  await expect(previewRoot(page)).toBeVisible();
});
