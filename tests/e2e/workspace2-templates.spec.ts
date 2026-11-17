import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * Templates (templates spec, SA1): the Templates group, the phone Add sheet's Templates segment, a placed template's settings-first form, Set Per Place,
 * parameter labels and the edit question. The fixtures are home-domains with a template of two state tiles ("Lamp Pair") used in two places; the second has
 * its entity set per place. Every entity is invented.
 */
const lamps = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps.json', import.meta.url), 'utf8')) as { document: object };
const lampsSet = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps-set.json', import.meta.url), 'utf8')) as { document: object };
const sizes = [[390, 844], [669, 951], [951, 669], [820, 1180], [1180, 820], [1440, 900]] as const;

const panel = (page: Page) => page.getByLabel('Properties');
/** On a phone the properties sheet opens part way; the form is read at full height. */
const fullSheet = async (page: Page) => { if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))); };
/** On a phone the open properties sheet covers the preview: it is closed before the next selection. */
const clearSheet = async (page: Page) => { if (isPhone(page) && await panel(page).count()) { await panel(page).getByRole('button', { name: 'Close' }).first().click(); await expect(panel(page)).toHaveCount(0); } };
/** Selects a place of the template by its header in the preview (`at` is the first or second place). */
async function selectPlace(page: Page, at = 0) {
  await clearSheet(page);
  await previewRoot(page).getByText('Demo Lamps', { exact: true }).nth(at).click();
  await expect(panel(page).getByRole('heading', { name: 'Lamp Pair', exact: true })).toBeVisible();
  await fullSheet(page);
}
/** Selects a tile inside a place, which shows its own fields under the template's banner. */
async function selectInner(page: Page, title: string, at = 0) {
  await clearSheet(page);
  await previewRoot(page).getByText(title, { exact: true }).nth(at).click();
  await expect(panel(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
  await fullSheet(page);
}
const question = (page: Page) => page.getByTestId('linked-question');
const templateRow = (page: Page) => panel(page).getByRole('button', { name: /^Lamp Pair, template, used in 2 places$/ });
/** Answers the edit question with Update Template. */
async function update(page: Page) {
  await expect(question(page)).toBeVisible();
  await question(page).getByRole('button', { name: 'Update Template' }).click();
  await expect(question(page)).toHaveCount(0);
}

test('the Templates group lists a saved template with its use count, and the empty line shows with none', async ({ page, request }) => {
  test.skip(isPhone(page), 'The library is the wide layout; a phone lists templates in the Add sheet');
  await seed(request);
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  const group = page.locator('[data-group="saved"]');
  await expect(group.getByRole('heading', { name: /Templates/ })).toBeVisible();
  await expect(group.getByTestId('saved-empty')).toHaveText('No templates yet. Choose Save as Template from a component’s More menu.');
  await snap(page, 'desktop-templates-empty');
  await seed(request, lampsSet.document);
  await page.reload();
  await openLibrary(page, 'Components');
  const row = page.locator('[data-group="saved"]').getByTestId('saved-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Lamp Pair');
  await expect(row).toContainText('Used in 2 places');
  await expect(page.getByRole('list', { name: 'Templates' })).toBeVisible();
  await snap(page, 'desktop-templates-group');
});

test('on a phone, Add then Templates lists the template and a tap adds a place', async ({ page, request }) => {
  test.skip(!isPhone(page), 'The Templates segment is the phone Add sheet');
  await seed(request, lamps.document);
  await openWorkspace(page);
  await expect(previewRoot(page).getByText('Demo Lamp', { exact: true })).toHaveCount(2);
  await page.locator('.w2-bottom-add').click();
  const picker = page.getByTestId('add-picker');
  const segment = picker.getByRole('group', { name: 'Kind' });
  await expect(segment.getByRole('button')).toHaveText(['Tiles', 'Templates', 'Entities']);
  await expect(picker.getByRole('searchbox', { name: 'Search tiles, templates and entities' })).toBeVisible();
  await snap(page, 'phone-add-tiles');
  await segment.getByRole('button', { name: 'Templates' }).click();
  const row = picker.getByTestId('saved-row');
  await expect(row).toContainText('Lamp Pair');
  await expect(row).toContainText('Used in 2 places');
  await snap(page, 'phone-add-templates');
  await row.getByRole('button', { name: /^Lamp Pair\./ }).click();
  await expect(picker).toHaveCount(0);
  await expect(previewRoot(page).getByText('Demo Lamp', { exact: true })).toHaveCount(3);
  await expect(panel(page).getByRole('heading', { name: 'Lamp Pair', exact: true })).toBeVisible();
});

test('a placed template shows its settings first, under their labels, and the template row closed', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectPlace(page);
  const settings = panel(page).getByTestId('component-settings');
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Entity' })).toContainText('switch.demo_lamp');
  const row = templateRow(page);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toContainText('Template · Used in 2 places');
  await expect(panel(page).getByTestId('component-parameters')).toHaveCount(0);
  const a = (await settings.boundingBox())!, b = (await row.boundingBox())!;
  expect(a.y, 'the settings come before the template row').toBeLessThan(b.y);
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-form-closed`);
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).getByTestId('linked-line')).toHaveText('A change here asks first.');
  await expect(panel(page).getByTestId('component-parameters')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-form-open`);
});

test('an entity setting opens the entity list with the default\'s domain chip pressed, and a pick changes this place only and asks nothing', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectPlace(page, 1);
  const settings = panel(page).getByTestId('component-settings');
  await expect(settings.getByRole('button', { name: 'Entity' })).toContainText('switch.demo_fan');
  await settings.getByRole('button', { name: 'Entity' }).click();
  const list = page.locator('.w2-entity-list');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: 'Switch', pressed: true })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-entity-setting`);
  await list.getByRole('searchbox', { name: 'Search entities' }).fill('switch.demo_other');
  await list.getByRole('option', { name: /switch\.demo_other/ }).first().click();
  await expect(question(page)).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Entity' })).toContainText('switch.demo_other');
  // the other place still has its own
  await selectPlace(page, 0);
  await expect(panel(page).getByTestId('component-settings').getByRole('button', { name: 'Entity' })).toContainText('switch.demo_lamp');
});

test('Set Per Place on an entity field of a template with two places asks, then every place has the setting', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  const line = panel(page).getByTestId('per-place-line');
  await expect(line.getByRole('button', { name: 'Set Per Place: Entity' })).toHaveText('Set Per Place');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-per-place-off`);
  await line.getByRole('button', { name: 'Set Per Place: Entity' }).click();
  await expect(question(page)).toBeVisible();
  await expect(question(page).getByRole('heading', { name: 'Update “Lamp Pair” everywhere?' })).toBeVisible();
  await expect(question(page)).toContainText('It is also used in 1 other place:');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-question`);
  await update(page);
  await expect(panel(page).getByTestId('per-place-line')).toContainText('Set per place as Entity.');
  for (const at of [0, 1]) {
    await selectPlace(page, at);
    await expect(panel(page).getByTestId('component-settings').getByRole('button', { name: 'Entity' })).toContainText('switch.demo_lamp');
  }
});

test('Set Per Place with a setting of that kind offers Use and New Setting, and Use fills both fields from one setting', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Fan');
  const line = panel(page).getByTestId('per-place-line');
  await line.getByRole('button', { name: 'Set Per Place: Entity' }).click();
  const menu = page.getByTestId('per-place-menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Use Entity', 'New Setting']);
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-per-place-menu`);
  await menu.getByRole('menuitem', { name: 'Use Entity' }).click();
  await update(page);
  await selectPlace(page, 0);
  await templateRow(page).click();
  await panel(page).getByTestId('component-parameters').getByRole('button', { name: /^Entity/ }).click();
  await expect(panel(page).getByTestId('component-parameters')).toContainText('Fills Entity of Demo Lamp and 1 more');
  // one setting, two fields: the second place's entity reaches both tiles
  await expect(panel(page).getByTestId('component-settings').getByRole('button')).toHaveCount(1);
});

test('Same Everywhere removes the setting from the form', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  const line = panel(page).getByTestId('per-place-line');
  await expect(line).toContainText('Set per place as Entity.');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-template-per-place-on`);
  await line.getByRole('button', { name: 'Same Everywhere: Entity' }).click();
  await update(page);
  await expect(panel(page).getByTestId('per-place-line').getByRole('button', { name: 'Set Per Place: Entity' })).toBeVisible();
  await selectPlace(page, 0);
  await expect(panel(page).getByTestId('component-settings')).toHaveCount(0);
});

test('a parameter\'s label can be changed and the form shows it', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectPlace(page, 0);
  await templateRow(page).click();
  const parameters = panel(page).getByTestId('component-parameters');
  await parameters.getByRole('button', { name: /^Entity/ }).click();
  const label = parameters.getByRole('textbox', { name: 'Label' });
  await expect(label).toHaveAttribute('maxlength', '80');
  await label.fill('Light');
  await label.press('Enter');
  await update(page);
  await expect(panel(page).getByTestId('component-settings').getByRole('button', { name: 'Light' })).toBeVisible();
  await expect(panel(page).getByTestId('component-settings').getByRole('button', { name: 'Entity', exact: true })).toHaveCount(0);
});

test('the group, the form, the open template row and the questions fit at every size', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectPlace(page);
  const inside = async (locator: ReturnType<Page['locator']>, width: number, height: number, what: string) => {
    const box = (await locator.boundingBox())!;
    expect(box.x, `${width}: ${what} left`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${width}: ${what} right`).toBeLessThanOrEqual(width + 1);
    expect(box.height, `${width}: ${what} has height`).toBeGreaterThan(0);
    void height;
  };
  for (const [width, height] of sizes) {
    if (isPhone(page) && width !== 390) continue;
    await page.setViewportSize({ width, height });
    await expect(templateRow(page)).toBeVisible();
    // A resize can redraw the panel while the row scrolls: try again on the new element.
    await expect(async () => { await templateRow(page).scrollIntoViewIfNeeded({ timeout: 2000 }); }).toPass();
    await inside(templateRow(page), width, height, 'template row');
    await inside(panel(page).getByTestId('component-settings'), width, height, 'settings');
    if (await templateRow(page).getAttribute('aria-expanded') !== 'true') await templateRow(page).click();
    await inside(panel(page).getByTestId('component-parameters'), width, height, 'parameters');
    // the edit question: Remove Setting on a template of two places
    const list = panel(page).getByTestId('component-parameters');
    if (!(await list.getByRole('button', { name: 'Remove Setting' }).count())) await list.getByRole('button', { name: /^Entity/ }).click();
    await list.getByRole('button', { name: 'Remove Setting' }).click();
    const dialog = question(page);
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x, `${width}: question left`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${width}: question right`).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height, `${width}: question bottom`).toBeLessThanOrEqual(height + 1);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow`).toBe(true);
    if (width >= 700) {
      await openLibrary(page, 'Components');
      await inside(page.locator('[data-group="saved"]'), width, height, 'Templates group');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow with the library`).toBe(true);
      await page.keyboard.press('Escape');
    }
  }
});

test('the template row, the per-place buttons and the settings are named for assistive technology', async ({ page, request }) => {
  await seed(request, lampsSet.document);
  await openWorkspace(page);
  await selectPlace(page);
  const row = templateRow(page);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toHaveAttribute('aria-controls', /.+/);
  await expect(panel(page).getByTestId('component-settings')).toHaveAttribute('aria-label', 'Settings');
  await expect(panel(page).getByTestId('component-settings').getByRole('button', { name: 'Entity' })).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).getByTestId('linked-line')).toHaveAttribute('role', 'note');
  await selectInner(page, 'Demo Lamp');
  const same = panel(page).getByRole('button', { name: 'Same Everywhere: Entity' });
  const described = await same.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${described}"]`)).toHaveText('Set per place as Entity.');
  await same.click();
  const dialog = page.getByRole('alertdialog', { name: 'Update “Lamp Pair” everywhere?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveText(['Update Template', 'Save as New Template…', 'Cancel']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await seed(request, lamps.document);
  await page.reload();
  await selectInner(page, 'Demo Fan');
  await expect(panel(page).getByRole('button', { name: 'Set Per Place: Entity' })).toHaveText('Set Per Place');
});
