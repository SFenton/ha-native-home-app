import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, railButton, seed, snap } from './workspace2-helpers';
import { newFlow, updateFlow } from '../../src/workspace2/data/flow';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import type { NativeSnapshot } from '../../src/shared/native-state';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };

/** The fixture with an invented Data Flow ("Overdue Chores", a live to-do list) and a List on the Climate page that reads it. No house data. */
function withList(): CompositionDocument {
  const base = fixture.document;
  const made = newFlow(base, 'live-list', { entityId: 'todo.example_chores', title: 'Overdue Chores' });
  const document = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'filter-1', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['status'] }, right: { type: 'literal', value: 'needs_action' } } }] }));
  const list = { id: 'list-chores', title: 'Chores', type: 'row-collection', layout: { span: 1 }, props: { providerId: made.id, loadingText: 'Loading…', emptyText: 'All Caught Up', unavailableText: 'Not Available', errorText: 'Unable to Load', staleText: 'May Be Out of Date' } };
  const tab = document.navigation.tabs.find(item => item.id === 'hc-tab-climate');
  const pageId = tab?.pageId ?? 'page-climate';
  return { ...document, navigation: { ...document.navigation, initialTabId: 'hc-tab-climate', initialPageId: pageId },
    pages: document.pages.map(page => page.id === pageId ? { ...page, components: page.components.map(node => node.id === 'hc-whole-home' ? { ...node, children: [...(node as { children: unknown[] }).children, list] } : node) } : page) } as CompositionDocument;
}

test.beforeEach(async ({ request }) => { await seed(request, withList()); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
/** Opens Flows: its rail item on desktop, Project > Flows on a phone. */
const sheetPath = (page: Page) => (page.viewportSize()?.width ?? 1440) < 600;
async function openData(page: Page) {
  await openWorkspace(page);
  if (sheetPath(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    return page.locator('.w2-data');
  }
  await openLibrary(page, 'Flows');
  const panel = page.getByTestId('flows-panel');
  const group = panel.getByRole('button', { name: /^Flows, \d+$/ });
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  return panel;
}
const inspector = (page: Page) => isPhone(page) ? page.locator('.w2-project-sheet') : page.getByLabel('Properties');

test.describe('the Data rail item and panel', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'A phone has no rail; Project > Data is below');
  test('the rail has Flows before Data as its eighth item', async ({ page }) => {
    await openWorkspace(page);
    const buttons = page.getByTestId('library-rail').getByRole('button');
    await expect(buttons).toHaveCount(8);
    await expect(buttons.nth(6)).toHaveText('Flows');
    await expect(buttons.last()).toHaveText('Data');
    await expect(railButton(page, 'Data')).toBeVisible();
  });
  test('the panel lists Data Flows with "Used by n", counts what is there, and Find data filters', async ({ page }) => {
    const panel = await openData(page);
    await expect(panel.getByText(/1 flow · \d+ fields with logic$/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Flows, 1' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Overdue Chores, data flow, used by 1, live' })).toBeVisible();
    await panel.getByRole('searchbox', { name: 'Find a flow' }).fill('zzz');
    await expect(panel.getByRole('button', { name: /Overdue Chores/ })).toHaveCount(0);
    await panel.getByRole('searchbox', { name: 'Find a flow' }).fill('chores');
    await expect(panel.getByRole('button', { name: /Overdue Chores/ })).toBeVisible();
    await snap(page, `${prefix(page)}-data-panel`);
  });
  test('a flow opens in the inspector with its run bar, Request, Steps and Output; the panel shows its outline', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Overdue Chores/ }).click();
    const props = inspector(page);
    await expect(props.getByRole('heading', { name: 'Overdue Chores' })).toBeVisible();
    await expect(props.getByTestId('run-bar')).toContainText('Demo Data');
    await expect(props.getByRole('region', { name: 'Request' })).toBeVisible();
    await expect(props.getByRole('region', { name: 'Steps' })).toBeVisible();
    await expect(props.getByRole('region', { name: 'Output' })).toBeVisible();
    // A live list has no Refresh section.
    await expect(props.getByRole('region', { name: 'Refresh' })).toHaveCount(0);
    await snap(page, `${prefix(page)}-data-flow`);
  });
  test('a source row (an entity, an app topic or a model) opens its fields in the inspector, and a second click closes it', async ({ page }) => {
    await openWorkspace(page);
    await openLibrary(page, 'Data');
    const panel = page.getByTestId('data-panel');
    await panel.getByRole('button', { name: /^Models, \d+$/ }).click();
    const row = panel.getByRole('region', { name: 'Models' }).getByRole('button', { name: /, source, / }).first();
    await expect(row).toHaveAttribute('aria-label', /, source, (used by \d+|not used)$/);
    await row.click();
    const props = inspector(page);
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(props.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(props.locator('[data-field-path]').first()).toBeVisible();
    // A flow's own Request, Steps and Output belong to flows only.
    await expect(props.getByRole('region', { name: 'Steps' })).toHaveCount(0);
    await snap(page, `${prefix(page)}-data-source`);
    await row.click();
    await expect(row).not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('the flow editor', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The phone path is below');
  test('+ Data Flow offers the five choices; a group of entities has no Refresh and no Run', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: 'New Flow', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Get data from' });
    await expect(menu.getByRole('menuitem')).toHaveText([/A Service/, /An Entity's Attribute/, /A Live List/, /A Group of Entities/, /Nothing/]);
    await menu.getByRole('menuitem', { name: /A Group of Entities/ }).click();
    const props = page.getByLabel('Properties');
    await expect(props.getByRole('heading', { name: 'Data Flow', exact: true })).toBeVisible();
    await expect(props.getByTestId('run-bar')).toContainText('Made-up values, not yours. Follows the entities when Home Assistant is connected.');
    await expect(props.getByTestId('run-bar')).not.toContainText('Nothing to run.');
    await expect(props.getByRole('region', { name: 'Refresh' })).toHaveCount(0);
    await expect(props.getByRole('button', { name: /^Run/ })).toHaveCount(0);
    await expect(props.getByRole('button', { name: 'Entities' })).toBeVisible();
    await expect(props.getByRole('button', { name: 'Also read' })).toBeVisible();
  });
  test('Nothing has one Value row and says it is worked out on the phone', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: 'New Flow', exact: true }).click();
    await page.getByRole('menuitem', { name: /Nothing/ }).click();
    const props = page.getByLabel('Properties');
    await expect(props.getByTestId('run-bar')).toContainText('Worked out on the phone. Nothing to run.');
    await expect(props.getByRole('textbox', { name: 'Value' })).toBeVisible();
  });
  test('a Filter edits one check inline and opens compound logic in the canvas, without legacy cards', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Overdue Chores/ }).click();
    const props = page.getByLabel('Properties');
    await props.getByRole('button', { name: /^Step 2, Filter/ }).click();
    await expect(props.getByTestId('filter-page')).toBeVisible();
    await expect(props.getByRole('heading', { name: 'Keep items when', exact: true })).toBeVisible();
    await expect(props.getByRole('radiogroup', { name: 'Condition view' })).toHaveCount(0);
    await expect(props.getByTestId('flow-simple-filter')).toBeVisible();
    await expect(props.getByText(/If it can/)).toHaveCount(0);
    await expect(props.getByTestId('filter-result')).toContainText(/Keeps \d+ of \d+ items\./);
    await props.getByRole('button', { name: '+ And…', exact: true }).click();
    const canvas = page.locator('.w2-logic-overlay');
    await expect(canvas).toBeVisible();
    await expect(canvas.getByText('of these are true')).toHaveCount(0);
    await canvas.getByRole('button', { name: 'Close canvas', exact: true }).click();
    await snap(page, `${prefix(page)}-data-filter`);
    await props.getByRole('button', { name: 'Cancel' }).click();
  });
  test('Add Step lists only what fits, Move Down and Remove are one undo step each', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Overdue Chores/ }).click();
    const props = page.getByLabel('Properties');
    await props.getByRole('button', { name: 'Add Step' }).click();
    await expect(page.getByRole('menu', { name: 'Add a step' }).getByRole('menuitem').first()).toHaveText('Filter');
    await page.getByRole('menuitem', { name: 'Count' }).click();
    await expect(props.getByRole('button', { name: /^Step 3, Count/ })).toBeVisible();
    await props.getByRole('button', { name: 'More for step 3, Count' }).click();
    await page.getByRole('menuitem', { name: 'Move Up' }).click();
    await expect(props.getByRole('button', { name: /^Step 2, Count/ })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(props.getByRole('button', { name: /^Step 3, Count/ })).toBeVisible();
  });
  test('Average is selectable and says it needs a newer app', async ({ page }) => {
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Overdue Chores/ }).click();
    const props = page.getByLabel('Properties');
    await props.getByRole('button', { name: 'Add Step' }).click();
    await page.getByRole('menuitem', { name: 'Average · Needs a newer app', exact: true }).click();
    await props.getByRole('button', { name: /^Step 3, Average/ }).click();
    const field = props.getByTestId('logic-field').filter({ hasText: 'Average of' });
    await expect(field.getByRole('button', { name: 'Edit in Canvas', exact: true })).toBeVisible();
    await expect(props.getByText('Needs a newer app. Publishing it waits for an app update.')).toBeVisible();
    await props.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('empty live output explanations', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The expanded Flows library preview is desktop-only');

  test('four lights read and filtered out have the same explanation in the run bar and Flows preview', async ({ page, request }) => {
    const entityIds = ['light.demo_one', 'light.demo_two', 'light.demo_three', 'light.demo_four'];
    const made = newFlow(fixture.document, 'group', { entityIds, title: 'Demo lights on' });
    const document = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [
      { id: 'filter-on', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: 'on' } } },
    ] }));
    const snapshot: NativeSnapshot = { mode: 'live', houseConfig: { schema: 2, hash: 'demo-empty-flow', config: {} }, states: entityIds.map(entityId => ({ entityId, name: 'Demo light', state: 'off' })) };
    await seed(request, document);
    await page.route('**/api/native-home', route => route.fulfill({ json: snapshot }));
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Demo lights on, data flow/ }).click();
    const props = inspector(page);
    const summary = 'Live · Read 4 lights · none left after Filter (state is on) · Output 0 items';
    await expect(props.getByTestId('run-bar').getByRole('status')).toHaveAccessibleName(new RegExp(`^${summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await expect(panel.getByTestId('empty-live-summary')).toHaveText(summary);
    await expect(props.getByRole('button', { name: 'Step 1, Filter, state is on, 4 → 0' })).toBeVisible();
    await expect(panel.getByText('Output · 0 items', { exact: true })).toBeVisible();
    await expect(props.getByTestId('run-bar')).not.toContainText('Nothing to run');
    await expect(props.getByTestId('empty-live-hint')).toContainText('Edit Flow in Canvas, then Simulation · Studio only');
  });

  test('a live to-do list with no items is an answered empty list, not an unanswered request', async ({ page, request }) => {
    const made = newFlow(fixture.document, 'live-list', { entityId: 'todo.demo_list', title: 'Demo empty list' });
    const snapshot: NativeSnapshot = { mode: 'live', houseConfig: { schema: 2, hash: 'demo-empty-list', config: {} }, states: [{ entityId: 'todo.demo_list', name: 'Demo list', state: '0' }] };
    await seed(request, made.document);
    await page.route('**/api/native-home', route => route.fulfill({ json: snapshot }));
    await page.route('**/native/api/ha/flow-run', route => route.fulfill({ json: { source: 'live', at: '2026-11-21T20:00:00.000Z', response: { items: [] }, output: [], items: 0 } }));
    const panel = await openData(page);
    await panel.getByRole('button', { name: /^Demo empty list, data flow/ }).click();
    const props = inspector(page);
    const summary = 'Live · Read 0 items from the list · Output 0 items';
    await expect(props.getByTestId('run-bar')).toContainText(summary);
    await expect(panel.getByTestId('empty-live-summary')).toHaveText(summary);
    await expect(props.getByTestId('run-bar')).toContainText('Home Assistant answered at');
    await expect(props.getByTestId('run-bar')).not.toContainText('none left after');
    await expect(panel.getByText(/^Try it:/)).toContainText('Simulation · Studio only');
  });
});

test.describe('the List', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The phone path is covered by the Project sheet specs');
  test('one inspector: Rows from, Row tapped, Pull to refresh stays hidden for a live flow, Only show when, and the States', async ({ page }) => {
    await openWorkspace(page);
    await previewRoot(page).getByLabel('Chores').first().click({ position: { x: 4, y: 4 } });
    const props = page.getByLabel('Properties');
    await expect(props.getByRole('heading', { name: 'Chores' })).toBeVisible();
    await expect(props.getByRole('button', { name: 'Rows from' })).toContainText('Overdue Chores');
    await expect(props.getByRole('button', { name: 'Edit Data Flow' })).toBeVisible();
    await expect(props.getByRole('button', { name: /^Row tapped/ })).toBeVisible();
    await expect(props.getByRole('switch', { name: 'Pull to refresh' })).toHaveCount(0);
    await expect(props.getByRole('button', { name: /^Only show when:/ })).toBeVisible();
    for (const label of ['Show state', 'Loading text', 'Empty text', 'Empty message', 'Out-of-date text', 'Error text', 'Unavailable text']) await expect(props.getByLabel(label).first()).toBeVisible();
    await props.getByRole('button', { name: /^Only show when:/ }).click();
    await expect(props.getByTestId('simple-condition')).toBeVisible();
    await props.getByRole('button', { name: 'Done', exact: true }).click();
    await snap(page, `${prefix(page)}-data-list`);
  });
  test('Show state draws the Empty state, with the message under the title; focusing a text announces its state', async ({ page }) => {
    await openWorkspace(page);
    await previewRoot(page).getByLabel('Chores').first().click({ position: { x: 4, y: 4 } });
    const props = page.getByLabel('Properties');
    await props.getByLabel('Empty message').first().fill('No chores are overdue.');
    await props.getByLabel('Empty message').first().blur();
    await props.getByLabel('Empty text').focus();
    await expect(props.getByText('Showing the Empty state')).toBeAttached();
    await expect(previewRoot(page).getByText('All Caught Up')).toBeVisible();
    await expect(previewRoot(page).getByTestId('list-empty-message')).toHaveText('No chores are overdue.');
    await snap(page, `${prefix(page)}-data-list-empty`);
  });
  test('Edit Data Flow opens the flow and a node selection closes it', async ({ page }) => {
    await openWorkspace(page);
    await previewRoot(page).getByLabel('Chores').first().click({ position: { x: 4, y: 4 } });
    const props = page.getByLabel('Properties');
    await props.getByRole('button', { name: 'Edit Data Flow' }).click();
    await expect(props.getByTestId('flow-editor')).toBeVisible();
    await expect(props.getByRole('heading', { name: 'Overdue Chores' })).toBeVisible();
    await previewRoot(page).getByLabel('Chores').first().click({ position: { x: 4, y: 4 } });
    await expect(props.getByTestId('flow-editor')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 700, 'The phone path');
  test('Project > Flows is a pushed page that lists Data Flows and opens one', async ({ page }) => {
    await openData(page);
    const sheet = page.getByRole('dialog', { name: 'Project' });
    await expect(sheet.getByRole('heading', { name: 'Data Flows' })).toBeVisible();
    await sheet.getByRole('button', { name: /Overdue Chores/ }).click();
    await expect(sheet.getByTestId('flow-editor')).toBeVisible();
    await expect(sheet.getByRole('region', { name: 'Steps' })).toBeVisible();
    await snap(page, 'phone-data-flow');
  });
});

// MARK: - Every family: names, roles, no horizontal scroll, 44 px targets, Reduce Motion

const families = [
  { name: 'iPhone', width: 390, height: 844 }, { name: 'Duo folded', width: 669, height: 951 }, { name: 'Duo wide', width: 951, height: 669 },
  { name: 'iPad portrait', width: 820, height: 1180 }, { name: 'iPad landscape', width: 1180, height: 820 }, { name: 'Desktop', width: 1440, height: 900 },
];

/** Every control inside `root` that is on screen and has no accessible name. */
const unnamed = (root: Locator) => root.evaluate(element => {
  const out: string[] = [];
  for (const control of element.querySelectorAll<HTMLElement>('button, [role=radio], [role=combobox], [role=textbox], input, [role=switch], [role=treeitem]')) {
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height || control.closest('[hidden], [inert], [aria-hidden=true]')) continue;
    const name = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || (control as HTMLInputElement).placeholder;
    if (!name) out.push(control.outerHTML.slice(0, 80));
  }
  return out;
});
const overflowOf = (root: Locator) => root.evaluate(element => {
  const scroller = element.closest<HTMLElement>('.w2-sheet-content, .w2-inspector, [role=complementary], [role=dialog]') ?? element;
  return Math.max(element.scrollWidth - element.clientWidth, scroller.scrollWidth - scroller.clientWidth);
});

for (const family of families) {
  test(`${family.name} ${family.width}x${family.height}: the Data panel and the flow editor have names, roles, no horizontal scroll and 44 px targets`, async ({ page }) => {
        await page.setViewportSize({ width: family.width, height: family.height });
    const panel = await openData(page);
    expect(await unnamed(panel)).toEqual([]);
    expect(await overflowOf(panel)).toBeLessThanOrEqual(1);
    await panel.getByRole('button', { name: /Overdue Chores/ }).first().click();
    const editor = sheetPath(page) ? page.getByRole('dialog', { name: 'Project' }) : page.getByLabel('Properties');
    await expect(editor.getByTestId('flow-editor')).toBeVisible();
    await expect(editor.getByTestId('run-bar').getByRole('status')).toBeVisible();
    for (const name of ['Request', 'Steps', 'Output']) await expect(editor.getByRole('region', { name })).toBeVisible();
    expect(await unnamed(editor)).toEqual([]);
    expect(await overflowOf(editor.getByTestId('flow-editor'))).toBeLessThanOrEqual(1);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const small = await editor.evaluate(element => [...element.querySelectorAll<HTMLElement>('button, [role=radio], [role=combobox]')].filter(control => { const box = control.getBoundingClientRect(); return box.width > 0 && (box.height < 43.5 || box.width < 43.5); }).map(control => control.getAttribute('aria-label') ?? control.textContent?.trim()));
      expect(small).toEqual([]);
    }
    await snap(page, `d-viewport-${family.width}x${family.height}`);
  });
}

test('with Reduce Motion no transform transition runs in the Data panel or the flow editor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openData(page);
  await panel.getByRole('button', { name: /Overdue Chores/ }).first().click();
  const moving = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.w2-data *, .w2-flow *')]
    .filter(item => /transform/.test(getComputedStyle(item).transitionProperty) && parseFloat(getComputedStyle(item).transitionDuration) > 0).map(item => item.className));
  expect(moving).toEqual([]);
});
