import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { integrationDocument, integrationSnapshot } from '../flows-canvas/integration/fixture';
import { isPhone, openLibrary, seed, waitForWorkspace } from './workspace2-helpers';

const evidence = path.resolve('docs/evidence/w3');
const harness = '/tests/flows-canvas/canvas/harness.html';
async function screenshot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${isPhone(page) ? 'phone' : 'desktop'}-dark-${name}.png`, animations: 'disabled' });
}
async function closePalette(page: Page) {
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}
async function openFormula(page: Page) {
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
  await panel.getByRole('button', { name: /^Existing formula/ }).first().click();
  await page.getByTestId('flow-editor').getByTestId('request-section').getByRole('button', { name: 'Edit in Canvas', exact: true }).click();
  await closePalette(page);
}
test('B7 annotation Apply survives real server save, reload, and canvas reopen', async ({ page, request }) => {
  await seed(request, integrationDocument());
  await page.route('**/api/native-home', route => route.fulfill({ json: integrationSnapshot }));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/'); await waitForWorkspace(page);
  await openFormula(page);
  const header = page.getByRole('button', { name: /^Select Add / });
  await header.click();
  await page.getByRole('button', { name: /^Close (data peek|Data peek:)/ }).click();
  await page.getByRole('button', { name: 'Rename or describe Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill('Room total');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Combine the two configured room values.');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Select Room total, Add / })).toBeVisible();
  await expect(page.locator('.w2-canvas-node-note')).toHaveText('Combine the two configured room values.');
  await screenshot(page, 'annotated-block');
  const actionsFit = await page.locator('.w2-canvas-node[data-selected]').evaluate(card => {
    const bounds = card.getBoundingClientRect();
    return [...card.querySelectorAll('.w2-canvas-node-actions button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom; });
  });
  expect(actionsFit).toBe(true);
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.locator('.w2-canvas-footer [role=status]')).toContainText('Edits applied to the draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.w2-canvas-footer [role=status]')).toContainText('Draft saved');
  await expect.poll(async () => JSON.stringify((await (await request.get('/native/api/draft')).json()).document.studioCanvas)).toContain('Room total');
  await page.reload(); await waitForWorkspace(page);
  await openFormula(page);
  await expect(page.getByRole('button', { name: /^Select Room total, Add / })).toBeVisible();
  await expect(page.locator('.w2-canvas-node-note')).toHaveText('Combine the two configured room values.');
});
test('B7 observed rows peek, captured comparison, overflow and real measured Tidy Up', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route(`**${harness}*`, async route => {
    const response = await route.fetch(), html = await response.text();
    await route.fulfill({ response, body: html.includes('src="/src/main.tsx"') ? html.replace('src="/src/main.tsx"', 'src="/tests/flows-canvas/canvas/harness.tsx"').replace('</head>', '<style>body{margin:0}</style></head>') : html });
  });
  await page.goto(`${harness}?fixture=w3`);
  await closePalette(page);
  await page.getByRole('button', { name: /^Select Rows / }).click();
  const peek = page.getByRole('dialog');
  await expect(peek).toContainText('+4 more rows');
  await expect(peek).toContainText('Milk');
  await expect(peek).not.toContainText('{"');
  await screenshot(page, 'peek');
  await peek.getByRole('button', { name: 'Compare in full', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare Rows', exact: true });
  await expect(comparison.getByRole('heading', { name: 'Compare Rows', exact: true })).toBeFocused();
  await expect(comparison.getByRole('columnheader', { name: 'Row Title', exact: true })).toBeVisible();
  await expect(comparison.getByRole('status')).toHaveText('7 of 7 matching rows');
  await expect(comparison.locator('pre')).toHaveCount(0);
  await screenshot(page, 'compare-in-full');
  await comparison.getByRole('searchbox').fill('Milk');
  await expect(comparison.getByRole('status')).toHaveText('1 of 7 matching rows');
  await comparison.getByRole('searchbox').fill('no match');
  await expect(comparison.getByRole('status')).toHaveText('0 of 7 matching rows');
  await expect(comparison.getByText('No matching rows', { exact: true })).toBeVisible();
  await comparison.getByRole('searchbox').fill('');
  await comparison.getByText('Raw JSON · Off', { exact: true }).click();
  await expect(comparison.getByText('Raw JSON · On', { exact: true })).toBeVisible();
  await expect(comparison.locator('pre').last()).toContainText('"Milk"');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Compare in full', exact: true })).toBeVisible();
  if (isPhone(page)) await expect(page.getByRole('heading', { name: 'Data peek: Rows', exact: true })).toBeFocused();
  else await expect(page.getByRole('button', { name: 'Compare in full', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^Close (data peek|Data peek:)/ }).click();
  const tidy = page.getByRole('button', { name: 'Tidy Up', exact: true });
  await tidy.click();
  await expect(page.locator('.w2-canvas-footer [role=status]')).toHaveText(/Tidied: wire crossings \d+ → 0/);
  await expect(tidy).toBeFocused();
  await page.getByRole('button', { name: 'More canvas controls', exact: true }).click();
  await page.getByRole('button', { name: 'Fit all', exact: true }).click();
  await screenshot(page, 'tidied-graph');
  if (!isPhone(page)) {
    const bounds = await page.locator('.w2-canvas-node').evaluateAll(cards => cards.map(card => { const rect = card.getBoundingClientRect(); return { right: rect.right, bottom: rect.bottom }; }));
    const viewport = await page.locator('.w2-canvas-viewport').boundingBox();
    expect(viewport).not.toBeNull();
    expect(Math.max(...bounds.map(rect => rect.right))).toBeLessThan(viewport!.x + viewport!.width - 10);
    expect(Math.max(...bounds.map(rect => rect.bottom))).toBeLessThan(viewport!.y + viewport!.height - 20);
  }
});
test('review: the data peek stays beside its block after the canvas is scrolled', async ({ page }) => {
  test.skip(isPhone(page), 'Phones use the bottom-sheet peek, which is not anchored to the scrolled board.');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route(`**${harness}*`, async route => {
    const response = await route.fetch(), html = await response.text();
    await route.fulfill({ response, body: html.includes('src="/src/main.tsx"') ? html.replace('src="/src/main.tsx"', 'src="/tests/flows-canvas/canvas/harness.tsx"').replace('</head>', '<style>body{margin:0}</style></head>') : html });
  });
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`${harness}?fixture=w3`);
  await closePalette(page);
  await page.locator('.w2-canvas-viewport').evaluate(viewport => viewport.scrollTo(240, 180));
  const header = page.getByRole('button', { name: /^Select Rows / });
  await header.scrollIntoViewIfNeeded();
  await header.click();
  const peek = page.locator('.w2-canvas-peek');
  await expect(peek).toBeVisible();
  const [card, popup, viewport] = await Promise.all([
    page.locator('.w2-canvas-node[data-selected]').boundingBox(), peek.boundingBox(), page.locator('.w2-canvas-viewport').boundingBox(),
  ]);
  expect(card && popup && viewport).toBeTruthy();
  expect(popup!.x).toBeGreaterThanOrEqual(viewport!.x);
  expect(popup!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width + 1);
  const beside = popup!.x >= card!.x + card!.width || popup!.x + popup!.width <= card!.x;
  const stacked = popup!.y >= card!.y + card!.height || popup!.y + popup!.height <= card!.y;
  expect(beside || stacked).toBe(true);
});
