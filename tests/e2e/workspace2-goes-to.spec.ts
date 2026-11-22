import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seed, snap } from './workspace2-helpers';
import { documentWithLevels } from '../support/levels-document';

/**
 * "Show <Name>" on a tile's Goes to (`sl-goes-to`): it applies the editor as Done does, then shows the destination in the simulator. The document is the global-chrome demo
 * (a sheet with two levels beneath it). No check reads a font metric: each is a label, an attribute, a count, or (the long name) whether a box stays inside the panel's box.
 */
type Loose = { modals: Record<string, any>[]; pages: Record<string, any>[]; levels: Record<string, any>[] };
/** The levels demo plus a full-screen modal and a sheet with the proposal's long name, both made up. */
function documentWithTargets(): Loose {
  const document = documentWithLevels() as Loose;
  const sheetBase = document.modals.find(item => item.id === 'demo_sheet')!;
  const modal = structuredClone(sheetBase);
  Object.assign(modal, { id: 'demo_modal', title: 'Demo Modal', components: [] });
  modal.presentation = { ...modal.presentation, fullScreen: true };
  const long = structuredClone(sheetBase);
  Object.assign(long, { id: 'demo_long', title: 'Advanced Controls Protection Settings', components: [] });
  document.modals.push(modal, long);
  return document;
}
test.beforeEach(async ({ request }) => { await seed(request, documentWithTargets()); });

const sheet = (page: Page) => page.locator('.sh-sheet');

/** Opens the demo sheet in Use, then Edit, and selects its tile that opens level A. */
async function selectSheetTile(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.locator('[data-sel="node:demo_home_to_sheet"]').first().click();
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Sheet');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
  await expect(page.getByLabel('Properties')).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) test(`Show on a level goes into it inside its sheet, and Back returns to the sheet (${scheme})`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: scheme });
  await selectSheetTile(page);
  const panel = page.getByLabel('Properties');
  // The closed row names the level by its title, never its id.
  const row = panel.getByRole('button', { name: /When tapped/ });
  await expect(row).toContainText('Opens Demo Level A');
  await expect(row).not.toContainText('demo_level_a');
  await row.click();
  await panel.getByRole('button', { name: 'Goes to' }).click();
  await page.getByRole('option', { name: 'Demo Level B' }).click();
  const show = panel.getByRole('button', { name: 'Show Demo Level B' });
  await expect(show).toBeVisible();
  await snap(page, `goes-to-1-show-level-${info.project.name}-${scheme}`);
  await show.click();
  // The pick was applied, the editor is closed, and the simulator is in the level inside the tile's sheet.
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level B');
  await expect(page.getByLabel('Properties')).toHaveCount(0);
  await snap(page, `goes-to-2-in-level-${info.project.name}-${scheme}`);
  const back = sheet(page).getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('title', 'Back to Demo Sheet');
  await back.click();
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Sheet');
  // The tile now opens Demo Level B: the pick was kept.
  await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
  await expect(page.getByLabel('Properties').getByRole('button', { name: /When tapped/ })).toContainText('Opens Demo Level B');
});

for (const scheme of ['light', 'dark'] as const) test(`Show on a page shows that page, with nothing selected (${scheme})`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: scheme });
  await selectSheetTile(page);
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await panel.getByRole('button', { name: 'Goes to' }).click();
  await page.getByRole('option', { name: 'Security', exact: true }).click();
  await panel.getByRole('button', { name: 'Show Security' }).click();
  await expect(page.locator('.sh-page[data-current]')).toHaveAttribute('data-page', 'page-security');
  await expect(page.locator('[data-preview-root] [data-selected]')).toHaveCount(0);
  await snap(page, `goes-to-3-show-page-${info.project.name}-${scheme}`);
});

/** Opens the tile's When tapped editor, picks `name` under Goes to, and returns the Show button for it. */
async function pickDestination(page: Page, name: string) {
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await panel.getByRole('button', { name: 'Goes to' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  return panel.getByRole('button', { name: `Show ${name}` });
}

for (const scheme of ['light', 'dark'] as const) for (const [state, name, label] of [['4-show-sheet', 'Lights', 'Lights'], ['5-show-modal', 'Demo Modal', 'Demo Modal']] as const) {
  test(`Show for ${state === '4-show-sheet' ? 'a sheet' : 'a modal'} shows it with nothing selected (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await selectSheetTile(page);
    const show = await pickDestination(page, name);
    await snap(page, `goes-to-${state}-before-${info.project.name}-${scheme}`);
    await show.click();
    await expect(sheet(page)).toHaveAttribute('aria-label', label);
    await expect(page.locator('[data-preview-root] [data-selected]')).toHaveCount(0);
    await expect(page.getByLabel('Properties')).toHaveCount(0);
    await snap(page, `goes-to-${state}-${info.project.name}-${scheme}`);
  });
}

test('a tile inside a level shows another level, and Back reads Back to that level', async ({ page }, info) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.locator('[data-sel="node:demo_home_to_sheet"]').first().click();
  await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level A');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.locator('.sh-sheet [data-sel="node:demo_level_a_to_demo_level_b"]').first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await panel.getByRole('button', { name: 'Show Demo Level B' }).click();
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level B');
  await expect(sheet(page).getByRole('button', { name: 'Back', exact: true })).toHaveAttribute('title', 'Back to Demo Level A');
  await snap(page, `goes-to-6-from-level-${info.project.name}-light`);
});

test('Show from a rule\'s page applies the change, closes the inspector and leaves no editor page behind', async ({ page, request }, info) => {
  const document = documentWithTargets();
  const tile = document.modals.find(item => item.id === 'demo_sheet')!.components[0];
  const literal = (value: number) => ({ type: 'literal', value });
  tile.action = { type: 'conditional', cases: [{ when: { type: 'compare', op: 'above', left: literal(1), right: literal(0) }, then: tile.action }], otherwise: { type: 'none' } };
  await seed(request, document);
  await selectSheetTile(page);
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await panel.getByRole('button', { name: /^Rule 1 of 1/ }).click();
  await panel.getByRole('button', { name: 'Goes to' }).click();
  await page.getByRole('option', { name: 'Demo Level B', exact: true }).click();
  await snap(page, `goes-to-7-rule-page-${info.project.name}-light`);
  await panel.getByRole('button', { name: 'Show Demo Level B' }).click();
  await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level B');
  await expect(page.getByLabel('Properties')).toHaveCount(0);
  await expect(page.locator('.w2-pushed')).toHaveCount(0);
  // The change was applied: the rule now goes to Demo Level B.
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
  await page.getByLabel('Properties').getByRole('button', { name: /When tapped/ }).click();
  await page.getByLabel('Properties').getByRole('button', { name: /^Rule 1 of 1/ }).click();
  await expect(page.getByLabel('Properties').getByRole('button', { name: 'Goes to' })).toContainText('Demo Level B');
});

test('with the keyboard, focus is not left on the page body after Show', async ({ page }) => {
  await selectSheetTile(page);
  const show = await pickDestination(page, 'Demo Level B');
  // The picker hands focus back to its trigger as it closes, which can land between a focus and a key press. Wait for it to be gone, then focus the Show button and press Enter
  // on it (`press` focuses first), asking again until the simulator has moved: a press that missed the button changes nothing.
  await expect(page.getByRole('option', { name: 'Demo Level B', exact: true })).toHaveCount(0);
  await expect(async () => {
    if (await sheet(page).getAttribute('aria-label') !== 'Demo Level B') await show.press('Enter', { timeout: 1000 });
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level B', { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
});

for (const scheme of ['light', 'dark'] as const) test(`a long name stays inside the panel (${scheme})`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: scheme });
  await selectSheetTile(page);
  const show = await pickDestination(page, 'Advanced Controls Protection Settings');
  await expect(show).toBeVisible();
  const panel = page.getByLabel('Properties');
  const shape = await page.evaluate(() => {
    const root = document.querySelector('[aria-label="Properties"]')!, button = document.querySelector('[data-show-destination]')!;
    const a = root.getBoundingClientRect(), b = button.getBoundingClientRect();
    return { inside: b.left >= a.left - 1 && b.right <= a.right + 1, scrolls: root.scrollWidth > root.clientWidth + 1 };
  });
  expect(shape).toEqual({ inside: true, scrolls: false });
  await snap(page, `goes-to-8-long-name-${info.project.name}-${scheme}`);
  await expect(panel).toBeVisible();
});
