import { expect, test, type Page } from '@playwright/test';
import { compileCompositionDocument } from '../../src/shared/composition/compiler';
import { createCompositionDocument } from '../../src/shared/composition/workspace';
import { todoFlowInputs } from '../flows-canvas/simulation/per-item-fixture';
import { isPhone, openLibrary, seed, waitForWorkspace } from './workspace2-helpers';

async function openTodoCanvas(page: Page) {
  let panel;
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    panel = page.locator('.w2-data');
  } else {
    await openLibrary(page, 'Flows');
    panel = page.getByTestId('flows-panel');
  }
  const group = panel.getByRole('button', { name: /^Flows, \d+$/ });
  if (await group.count() && await group.getAttribute('aria-expanded') === 'false') await group.click();
  await panel.getByRole('button', { name: /^Past Due Tasks/ }).first().click();
  await page.getByTestId('flow-editor').getByRole('button', { name: 'Edit Flow in Canvas', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}
const closePeek = (page: Page) => page.getByRole('button', { name: /^Close (data peek|Data peek:)/ }).click();

for (const empty of [true, false]) test(`todo per-item values with ${empty ? 'no items' : 'items'} use the current clock and explain their context`, async ({ page, request }) => {
  const document = compileCompositionDocument({
    ...createCompositionDocument('demo-per-item'), name: 'Demo todo observations',
    dataSources: [{ id: 'demo-todo-rows', kind: 'model', model: 'pipeline@1', inputs: todoFlowInputs() }],
  }).document;
  await seed(request, document);
  const items = empty ? [] : [
    { uid: 'demo-first', summary: 'First task', status: 'needs_action', due: '2026-11-20' },
    { uid: 'demo-second', summary: 'Older task', status: 'needs_action', due: '2026-11-19' },
  ];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/native-home', route => route.fulfill({ json: {
    mode: 'live', houseConfig: { schema: 2, hash: 'demo-per-item', config: {} },
    states: [{ entityId: 'todo.demo_past_due', name: 'Demo todo list', state: String(items.length) }],
    currentUser: { id: 'demo-owner', name: 'Demo owner', isOwner: true, isAdmin: true },
  } }));
  await page.route('**/native/api/ha/flow-run', route => route.fulfill({ json: {
    source: 'live', at: '2026-11-21T20:34:56Z', response: { items }, output: [], items: [],
  } }));
  await page.clock.setFixedTime(new Date('2026-11-21T20:34:56Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForWorkspace(page);
  await openTodoCanvas(page);
  const filter = page.getByRole('button', { name: /^Select Filter \d+/ });
  await filter.click();
  await closePeek(page);
  await page.getByRole('button', { name: 'Rename or describe Filter', exact: true }).click();
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill('Keep overdue tasks');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  const today = page.locator('.w2-canvas-node').filter({ has: page.locator('.w2-canvas-node-title strong', { hasText: /^Today$/ }) }).first();
  await expect(today.locator('[data-direction=output] .w2-canvas-port-value')).toHaveText('Today');
  await today.getByRole('button', { name: 'Show data peek for Today', exact: true }).click();
  let peek = page.getByRole('dialog', { name: isPhone(page) ? 'Data peek: Today' : 'Today', exact: true });
  await expect(peek.getByText('Result', { exact: true })).toHaveCount(1);
  await expect(peek.locator('.w2-canvas-value')).toHaveText('Today');
  await expect(peek.locator('.w2-canvas-value')).toHaveAttribute('title', 'Today (2026-11-21)');
  await expect(peek.getByText('Live', { exact: true })).toBeVisible();
  await expect(peek).not.toContainText('Not observed');
  await closePeek(page);
  const dependent = page.getByRole('button', { name: /^Select This Item \d+/ }).first();
  await dependent.click();
  peek = page.getByRole('dialog', { name: isPhone(page) ? 'Data peek: This Item' : 'This Item', exact: true });
  const chip = page.locator('.w2-canvas-node[data-selected] [data-direction=output] .w2-canvas-port-value');
  const expected = empty ? "Didn't run: no items reached Keep overdue tasks" : 'Needs action';
  await expect(chip).toHaveText(empty ? 'No items' : 'Needs action');
  await expect(peek.getByText(expected, { exact: true })).toBeVisible();
  await expect(peek).not.toContainText('Not observed');
  if (!empty) {
    await expect(page.locator('.w2-canvas-node[data-selected] .w2-canvas-item-context')).toHaveText('Item 1 of 2');
    await expect(peek.getByText('Item 1 of 2', { exact: true })).toBeVisible();
  }
  await peek.getByRole('button', { name: 'Compare in full', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare This Item', exact: true });
  await expect(comparison.getByText(expected, { exact: true })).toBeVisible();
  if (!empty) await expect(comparison.getByText('Item 1 of 2', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await closePeek(page);
  await page.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Discard canvas edits', exact: true }).click();
  expect(errors).toEqual([]);
});
