import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

const harness = '/tests/flows-canvas/canvas/harness.html';
const evidence = path.resolve('docs/evidence/w2-c');
test.skip(process.env.STUDIO_E2E_PORT !== '4822', 'Run with the isolated tests/flows-canvas/canvas/playwright.config.ts configuration.');
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 160; i++) {
    if (await target.evaluateAll(elements => elements.some(element => element === document.activeElement))) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard could not reach ${target}`);
}
async function activate(page: Page, target: Locator) { await tabTo(page, target); await page.keyboard.press('Enter'); }
async function selectBlock(page: Page, name: string) {
  await tabTo(page, page.getByRole('button', { name: /^Select / }));
  await page.keyboard.press('Home');
  for (let i = 0; i < 30; i++) {
    const target = page.getByRole('button', { name, exact: true });
    if (await target.evaluate(element => element === document.activeElement)) return target;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Cannot select ${name}`);
}
async function nodeControl(page: Page, name: string) {
  for (let i = 0; i < 12; i++) {
    const target = page.getByRole('button', { name, exact: true });
    if (await target.evaluateAll(elements => elements.some(element => element === document.activeElement))) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Cannot reach block control ${name}`);
}
async function addNumber(page: Page, ordinal: number) {
  if (await page.getByRole('button', { name: 'Add Block', exact: true }).getAttribute('aria-expanded') !== 'true') await activate(page, page.getByRole('button', { name: 'Add Block', exact: true }));
  await tabTo(page, page.getByRole('searchbox', { name: 'Find a block' }));
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('number');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `Select Number ${ordinal}`, exact: true })).toBeFocused();
}
for (const view of ['Graph', 'Outline'] as const) test(`C-keyboard ${view}: add, connect, replace, move, delete and restore focus without pointer input`, async ({ page }) => {
  await page.goto(harness);
  if (view === 'Outline') await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
  await addNumber(page, 4);
  await page.keyboard.press('Enter');
  await nodeControl(page, 'Move Number');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'moved to X 40' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Number 4', exact: true })).toBeFocused();
  await activate(page, page.getByText('Connections (2)', { exact: true }));
  await activate(page, page.getByRole('button', { name: /Number Value, number, to Add Value 1; disconnect/ }));
  await expect(page.getByRole('button', { name: /Add, Value 1 input, number.*required, unconnected/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await selectBlock(page, 'Select Number 4');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  const connect = page.getByRole('dialog');
  await expect(connect).toBeVisible();
  await activate(page, connect.getByRole('button', { name: /Add 1, Value 1 input, number/ }));
  await activate(page, connect.getByRole('button', { name: 'Confirm connection', exact: true }));
  await expect(page.getByRole('button', { name: /Add, Value 1 input, number.*connected to Number/ })).toBeFocused();
  await addNumber(page, 5);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await activate(page, page.getByRole('dialog').getByRole('button', { name: /Add 1, Value 1 input, number/ }));
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Replace connection', exact: true }));
  await expect(page.getByRole('status').filter({ hasText: 'Connection replaced' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add, Value 1 input, number.*connected to Number/ })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Select Number 5', exact: true }) }).getByRole('button', { name: /^Number, Value output/ })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('Escape');
  await selectBlock(page, 'Select Number 4');
  await page.keyboard.press('Delete');
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Confirm delete', exact: true }));
  await expect(page.getByRole('button', { name: /^Select Number / })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Select /, pressed: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Select Number 4', exact: true })).toBeFocused();
});
test('C-wire: cycles and incompatible types explain refusal accessibly', async ({ page }) => {
  await page.goto(harness);
  await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  await selectBlock(page, 'Select Add 1');
  await page.keyboard.press('Enter');
  await nodeControl(page, 'Add, Value output, number, operand, unconnected');
  await page.keyboard.press('Enter');
  const cycle = page.getByRole('dialog').getByRole('button', { name: /Add 1, Value 1 input/ });
  await expect(cycle).toHaveAttribute('aria-disabled', 'true');
  await expect(cycle).toContainText('cycle');
  await activate(page, cycle);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('cycle');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Add, Value output/ })).toBeFocused();
  await activate(page, page.getByRole('button', { name: 'Add Block', exact: true }));
  await tabTo(page, page.getByRole('searchbox', { name: 'Find a block' }));
  await page.keyboard.type('literal.text'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  const mismatch = page.getByRole('dialog').getByRole('button', { name: /Add 1, Value 1 input/ });
  await expect(mismatch).toHaveAttribute('aria-disabled', 'true');
  await expect(mismatch).toContainText('Types do not match');
});
test('C-themes: light, dark, custom HA tokens and narrow palette/canvas/summary evidence', async ({ page }, testInfo) => {
  for (const scheme of ['light', 'dark', 'custom'] as const) {
    await page.emulateMedia({ colorScheme: scheme === 'custom' ? 'light' : scheme, reducedMotion: 'reduce' });
    await page.goto(`${harness}${scheme === 'custom' ? '?theme=custom' : ''}`);
    const palette = page.getByRole('complementary', { name: 'Block palette' });
    await expect(palette).toBeVisible();
    expect(await palette.getByRole('list', { name: 'Values blocks' }).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await expect(page.getByRole('button', { name: 'Add Number, number', exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-palette.png`, fullPage: true });
    await activate(page, page.getByRole('button', { name: 'Close block palette' }));
    await expect(page.getByRole('list', { name: 'Flow graph blocks' })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-canvas.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
    await expect(page.getByRole('list', { name: 'Flow outline blocks' })).toBeVisible();
    await page.goto(`${harness}?fixture=summary${scheme === 'custom' ? '&theme=custom' : ''}`);
    await activate(page, page.getByRole('button', { name: 'Close block palette' }));
    await selectBlock(page, 'Select All Of 1'); await page.keyboard.press('Enter');
    await nodeControl(page, 'Inspect All Of'); await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Block inspector' })).toContainText('And / Or are edited on the canvas');
    await expect(page.getByRole('button', { name: 'Edit in Canvas', exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-summary.png`, fullPage: true });
  }
});
test('C-meter: above-threshold screenshot is derived from the checker fixture, never estimated', async ({ page }, testInfo) => {
  await page.goto(`${harness}?fixture=meter`);
  await expect(page.getByLabel('Limits above 75 percent')).toContainText('52 / 64');
  await activate(page, page.getByText('Limits', { exact: true }));
  await expect(page.getByRole('meter', { name: 'Expression nodes, output', exact: true })).toHaveAttribute('value', '52');
  await page.screenshot({ path: `${evidence}/${testInfo.project.name}-meter.png`, fullPage: true });
});
