import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';
import { expandLogic } from '../../src/shared/composition/logic-library';
import type { CompositionDocument } from '../../src/shared/composition/schema';

const gallery = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/logic-gallery.json', import.meta.url), 'utf8')) as { document: CompositionDocument };

test.beforeEach(async ({ request, page }) => {
  await seed(request, gallery.document);
  await stubHouse(page);
});

/** The demo house behind the gallery: three lights and the door on, the window off, two people, and Sam signed in. Nothing here is a real entity. */
async function stubHouse(page: Page) {
  const states = [['switch.demo_light_1', 'on'], ['switch.demo_light_2', 'on'], ['switch.demo_light_3', 'on'], ['switch.demo_door', 'on'], ['switch.demo_window', 'off'], ['person.demo_sam', 'home'], ['person.demo_alex', 'home']]
    .map(([entityId, state]) => ({ entityId, name: entityId.split('.')[1].replace('demo_', '').replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()), state }));
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, currentUser: { id: 'u-sam', isAdmin: true, personEntityId: 'person.demo_sam' }, states } }));
}

/** The inspector: the Properties panel, or the Project sheet on a phone. */
const inspector = (page: Page) => page.getByLabel('Properties').or(page.locator('.w2-project-sheet')).first();
const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
/** The saved draft, read from the server once the autosave has landed. */
const saved = async (page: Page): Promise<CompositionDocument> => (await (await page.request.get('/native/api/draft')).json()).document;
const refs = (document: unknown, id: string) => (JSON.stringify(document).match(new RegExp(`"logicId":"${id}"`, 'g')) ?? []).length;

/** Opens Data: the library's Data item when there is a rail, Project > Data on a phone. */
async function openData(page: Page) {
  await openWorkspace(page);
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Data$/ }).click();
    return page.locator('.w2-data');
  }
  await openLibrary(page, 'Flows');
  const panel = page.getByTestId('flows-panel');
  const group = panel.getByRole('button', { name: /^Templates, \d+$/ });
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  return panel;
}
/** A tile's Subtitle value, opened in its editor. */
async function openSubtitle(page: Page, tile: string): Promise<Locator> {
  const panel = await selectTile(page, tile);
  await full(page);
  await panel.getByRole('button', { name: /^Subtitle/ }).or(panel.getByRole('button', { name: /Count or All/ })).first().click();
  return page.getByLabel('Properties').or(page.locator('.w2-project-sheet')).first();
}
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Logic Templates, ${scheme}`, () => {
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ colorScheme: scheme }); });

    test('the Data panel lists the three templates, and a template opens with its settings, body and uses', async ({ page }) => {
      const panel = await openData(page);
      const group = panel.getByTestId('logic-group');
      await expect(group.getByRole('heading', { name: isPhone(page) ? 'Logic Templates' : /^Templates,/ })).toBeVisible();
      await expect(group.getByRole('button', { name: /^Count or All/ })).toContainText(`${isPhone(page) ? 'Value' : 'Words'} · Used by 3`);
      await expect(group.getByRole('button', { name: /^Night Hours/ })).toContainText(`${isPhone(page) ? 'Condition' : 'Yes or No'} · Used by 3`);
      await snap(page, `${prefix(page)}-${scheme}-logic-group`);
      await group.getByRole('button', { name: /^Count or All/ }).click();
      const editor = page.getByTestId('logic-editor');
      await expect(editor).toBeVisible();
      await expect(editor.getByTestId('logic-settings')).toBeVisible();
      await expect(editor.getByTestId('logic-body')).toBeVisible();
      await expect(editor.getByTestId('used-by')).toBeVisible();
      await snap(page, `${prefix(page)}-${scheme}-logic-editor`);
    });

    test('Delete asks, because the template is used, and Cancel keeps it', async ({ page }) => {
      const panel = await openData(page);
      await panel.getByTestId('logic-group').getByRole('button', { name: /^Night Hours/ }).click();
      await page.getByTestId('logic-editor').getByTestId('logic-delete').click();
      const question = page.getByTestId('logic-question');
      await expect(question).toContainText('Delete “Night Hours”?');
      await expect(question).toContainText('It is used by 3. Each use keeps its logic, unlinked.');
      await snap(page, `${prefix(page)}-${scheme}-logic-delete`);
      await question.getByRole('button', { name: 'Cancel' }).click();
      await expect(question).toHaveCount(0);
    });
  });
}

test('a template is added from Data and its name is edited', async ({ page }) => {
  const panel = await openData(page);
  await panel.getByRole('button', { name: 'Logic Template', exact: true }).click();
  await page.getByRole(isPhone(page) ? 'button' : 'menuitem', { name: 'Value', exact: true }).click();
  const name = page.getByTestId('logic-name').getByRole('textbox');
  await expect(name).toBeVisible();
  await name.fill('Door Words');
  await name.blur();
  await expect(page.getByTestId('logic-editor')).toBeVisible();
});

test('there is no horizontal scroll with the editor open', async ({ page }) => {
  const panel = await openData(page);
  await panel.getByTestId('logic-group').getByRole('button', { name: /^Yours or Theirs/ }).click();
  await expect(page.getByTestId('logic-editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

const plainDocument = (): CompositionDocument => { const { logicLibrary: _gone, ...rest } = expandLogic(gallery.document).document as CompositionDocument & { logicLibrary?: unknown }; return rest as CompositionDocument; };

test('with no template the group says what to do', async ({ page, request }) => {
  await seed(request, plainDocument());
  const panel = await openData(page);
  await expect(panel.getByTestId('logic-empty')).toHaveText('No logic templates yet. Choose Save as Logic Template from a value’s or a condition’s More menu.');
  await snap(page, `${prefix(page)}-logic-group-empty`);
});

test('Save as Logic Template lifts a value out, names it, and leaves a use in its place', async ({ page, request }) => {
  await seed(request, plainDocument());
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  await full(page);
  await panel.getByRole('button', { name: /^Subtitle/ }).click();
  await page.getByLabel('Properties').or(page.locator('.w2-project-sheet')).first().getByRole('button', { name: 'More', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Save as Logic Template…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as Logic Template' });
  await expect(dialog.getByText('Each use sets')).toBeVisible();
  await dialog.getByLabel('Name').fill('Lights Words');
  await snap(page, `${prefix(page)}-logic-save`);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved Lights Words.')).toBeVisible();
  await expect(page.getByTestId('logic-use')).toContainText('Lights Words · Logic Template');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await saved(page)).logicLibrary?.map(entry => entry.name)).toEqual(['Lights Words']);
  await expect.poll(async () => refs(await saved(page), 'lights-words')).toBe(1);
});

test('a use shows its settings, changes the tile, opens its template with a way back, and unlinks', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  await full(page);
  await panel.getByRole('button', { name: /Count or All/ }).first().click();
  const use = page.getByTestId('logic-use');
  await expect(use).toContainText('Count or All · Logic Template');
  await use.getByLabel('Word').fill('Lit');
  await use.getByLabel('Word').press('Enter');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(previewRoot(page)).toContainText('3 Lit');
  await inspector(page).getByRole('button', { name: /Count or All/ }).first().click();
  await page.getByTestId('logic-use').getByRole('button', { name: 'Open Template' }).click();
  await expect(page.getByTestId('logic-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Lights' }).click();
  await expect(inspector(page).getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
  await inspector(page).getByRole('button', { name: /Count or All/ }).first().click();
  await page.getByTestId('logic-use').getByRole('button', { name: 'Unlink From Template' }).click();
  await expect(page.getByText('Unlinked from Count or All.')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => refs(await saved(page), 'count-or-all')).toBe(2);
});

/** The value picker's "Logic Templates" group lists the templates by name; a pick adds a use. */
const pickTemplate = (page: Page, name: string) => page.getByRole('region', { name: 'Logic Templates' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const useChips = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}, logic template`) });

test.describe('inserting a use', () => {
  test('in a text: the value picker lists Logic Templates, and a pick adds a use to the line', async ({ page }) => {
    await openWorkspace(page);
    const panel = await selectTile(page, 'Lights');
    await full(page);
    await panel.getByRole('button', { name: /Count or All/ }).first().click();
    await expect(useChips(page, 'Count or All')).toHaveCount(1);
    await inspector(page).getByRole('button', { name: 'Insert a Value' }).click();
    await expect(page.getByRole('region', { name: 'Logic Templates' }).getByRole('button')).toHaveCount(2);
    await snap(page, `${prefix(page)}-logic-picker`);
    await pickTemplate(page, 'Count or All');
    await expect(useChips(page, 'Count or All')).toHaveCount(2);
  });

  test('in a rule’s Then', async ({ page }) => {
    await openWorkspace(page);
    const panel = await selectTile(page, 'Doors');
    await full(page);
    await panel.getByRole('button', { name: /Count or All/ }).first().click();
    await inspector(page).getByRole('radio', { name: 'Rules' }).or(inspector(page).getByRole('tab', { name: 'Rules' })).click();
    await inspector(page).getByRole('button', { name: 'Add Rule' }).click();
    await expect(useChips(page, 'Count or All')).toHaveCount(1);
    await inspector(page).getByRole('button', { name: 'Insert a Value' }).click();
    await pickTemplate(page, 'Count or All');
    await expect(useChips(page, 'Count or All')).toHaveCount(2);
  });

  test('in a comparison: Compare With a Value lists the templates, and the rule names the one picked', async ({ page }) => {
    await openWorkspace(page);
    const panel = await selectTile(page, 'Doors');
    await full(page);
    await panel.getByRole('button', { name: /^Only show when/ }).click();
    await inspector(page).getByRole('radio', { name: 'Logic' }).click();
    await inspector(page).getByRole('button', { name: 'Add Condition' }).click();
    await page.getByRole('button', { name: 'Time of day' }).click();
    const row = inspector(page).getByRole('button', { name: /^Condition 1:/ });
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
    await page.getByRole('button', { name: 'Compare With a Value…' }).click();
    await pickTemplate(page, 'Count or All');
    await expect(inspector(page).getByRole('button', { name: /Time of day is above Count or All|Time is above Count or All/ })).toBeVisible();
  });
});

test('+ Template adds a condition template as a rule, and Done keeps it', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Doors');
  await full(page);
  await panel.getByRole('button', { name: /^Only show when/ }).click();
  await inspector(page).getByRole('radio', { name: 'Logic' }).click();
  await inspector(page).getByRole('button', { name: 'Add a Logic Template' }).click();
  await page.getByRole('button', { name: /^Night Hours/ }).click();
  await expect(inspector(page).getByRole('button', { name: /^Condition 1: Night Hours/ })).toBeVisible();
  await snap(page, `${prefix(page)}-logic-condition-use`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => refs(await saved(page), 'night-hours')).toBe(4);
});

test('Show Uses lists where a template is used and goes to the node', async ({ page }) => {
  const panel = await openData(page);
  const row = panel.getByRole('button', { name: /^More for Count or All/ });
  await row.click();
  await page.getByRole('menuitem', { name: 'Show Uses' }).click();
  if (isPhone(page)) {
    const used = page.getByTestId('used-by');
    await expect(used).toBeVisible();
    await expect(used.getByRole('button')).toHaveCount(3);
    return;
  }
  const uses = page.getByTestId('logic-uses');
  await expect(uses).toContainText('Used by 3');
  await expect(uses.getByRole('button')).toHaveCount(3);
  await snap(page, `${prefix(page)}-logic-uses`);
  await uses.getByRole('button', { name: /Lights/ }).click();
  await expect(inspector(page).getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
});

test('a Person setting is picked from the people', async ({ page }) => {
  const panel = await openData(page);
  await panel.getByTestId('logic-group').getByRole('button', { name: /^Yours or Theirs/ }).click();
  const editor = page.getByTestId('logic-editor');
  await editor.getByRole('button', { name: /^Person, Person/ }).click();
  await expect(editor.getByRole('group', { name: 'Person' })).toBeVisible();
  await editor.getByRole('group', { name: 'Person' }).getByRole('combobox', { name: 'Try With' }).click();
  await page.getByRole('option', { name: 'Alex' }).click();
  await expect(editor.getByRole('button', { name: /^Person, Person, tried with Alex/ })).toBeVisible();
  await snap(page, `${prefix(page)}-logic-person`);
});

test('a setting is put into a template body as a token from the picker\u2019s Settings group', async ({ page }) => {
  const panel = await openData(page);
  await panel.getByRole('button', { name: 'Logic Template', exact: true }).click();
  await page.getByRole(isPhone(page) ? 'button' : 'menuitem', { name: 'Value', exact: true }).click();
  const fresh = page.getByTestId('logic-editor');
  await fresh.getByRole('button', { name: 'Add Setting…' }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await fresh.getByTestId('logic-body').click();
  // An untouched body opens in Rules: Otherwise is the value every case falls to, and it holds the token.
  await page.getByRole('button', { name: /^Otherwise/ }).click();
  await page.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('region', { name: 'Settings' }).getByRole('button', { name: 'Text' }).click();
  await expect(page.getByRole('button', { name: /^Setting, Text/ })).toBeVisible();
  await snap(page, `${prefix(page)}-logic-setting-token`);
});
