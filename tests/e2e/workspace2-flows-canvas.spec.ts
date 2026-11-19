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
async function overflow(page: Page, name: string) {
  await activate(page, page.getByRole('button', { name: 'More canvas controls', exact: true }));
  await activate(page, page.getByRole('button', { name, exact: true }));
}
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
  if (!await page.getByRole('complementary', { name: 'Block palette' }).isVisible()) await activate(page, page.getByRole('button', { name: 'Add Block', exact: true }));
  await tabTo(page, page.getByRole('searchbox', { name: 'Find a block' }));
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('literal.number');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `Select Number ${ordinal}`, exact: true })).toBeFocused();
}
for (const view of ['Graph', 'Outline'] as const) test(`C-keyboard ${view}: add, connect, replace, move, delete and restore focus without pointer input`, async ({ page }) => {
  await page.goto(harness);
  if (view === 'Outline') {
    await activate(page, page.getByRole('button', { name: 'Close block palette' }));
    await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
  }
  await addNumber(page, 4);
  await page.keyboard.press('Enter');
  await nodeControl(page, 'Move Number');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'moved to X 40' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Number 4', exact: true })).toBeFocused();
  await selectBlock(page, 'Select Add 1'); await page.keyboard.press('Enter'); await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /Add, Value input, number.*required, unconnected/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await selectBlock(page, 'Select Number 4');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  const connect = page.getByRole('dialog');
  await expect(connect).toBeVisible();
  await activate(page, connect.getByRole('button', { name: /Add 1, Value input, number/ }));
  await activate(page, connect.getByRole('button', { name: 'Confirm connection', exact: true }));
  await expect(page.getByRole('button', { name: /Add, Value input, number.*connected to Number/ })).toBeFocused();
  await addNumber(page, 5);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await activate(page, page.getByRole('dialog').getByRole('button', { name: /Add 1, Value input, number/ }));
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Replace connection', exact: true }));
  await expect(page.getByRole('status').filter({ hasText: 'Connection replaced' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add, Value input, number.*connected to Number/ })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Select Number 5', exact: true }) }).getByRole('button', { name: /^Number, Result output/ })).toBeFocused();
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
  await nodeControl(page, 'Add, Result output, number, operand, unconnected');
  await page.keyboard.press('Enter');
  const cycle = page.getByRole('dialog').getByRole('button', { name: /Add 1, Value input/ });
  await expect(cycle).toHaveAttribute('aria-disabled', 'true');
  await expect(cycle).toContainText('cycle');
  await activate(page, cycle);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('cycle');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Add, Result output/ })).toBeFocused();
  await activate(page, page.getByRole('button', { name: 'Add Block', exact: true }));
  await tabTo(page, page.getByRole('searchbox', { name: 'Find a block' }));
  await page.keyboard.type('literal.text'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  const mismatch = page.getByRole('dialog').getByRole('button', { name: /Add 1, Value input/ });
  await expect(mismatch).toHaveAttribute('aria-disabled', 'true');
  await expect(mismatch).toContainText('Types do not match');
});
test('C-themes: light, dark, custom HA tokens and narrow palette/canvas/summary evidence', async ({ page }, testInfo) => {
  for (const scheme of ['light', 'dark', 'custom'] as const) {
    await page.emulateMedia({ colorScheme: scheme === 'custom' ? 'light' : scheme, reducedMotion: 'reduce' });
    await page.goto(`${harness}${scheme === 'custom' ? '?theme=custom' : ''}`);
    const palette = page.getByRole('complementary', { name: 'Block palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('button', { name: /^From Home, \d+ blocks$/ })).toHaveAttribute('aria-expanded', 'false');
    await activate(page, palette.getByRole('button', { name: /^Values, \d+ blocks$/ }));
    expect(await palette.getByRole('list', { name: 'Values blocks' }).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await expect(page.getByRole('button', { name: 'Add Number, number', exact: true })).toBeVisible();
    await activate(page, palette.getByRole('button', { name: /^Values, \d+ blocks$/ }));
    await activate(page, palette.getByRole('button', { name: /^From Home, \d+ blocks$/ }));
    await activate(page, palette.getByRole('button', { name: /^Compare, \d+ blocks$/ }));
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-palette.png`, fullPage: true });
    await activate(page, page.getByRole('button', { name: 'Close block palette' }));
    await expect(page.getByRole('list', { name: 'Flow graph blocks' })).toBeVisible();
    await expect(page.locator('.w2-canvas-port-value')).toHaveCount(0);
    if (testInfo.project.name === 'phone') await overflow(page, 'Fit selection');
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
  await expect(page.getByLabel('Limits above 75 percent')).toContainText('52 of 64 steps');
  await expect(page.getByRole('meter', { name: 'Subtitle fit', exact: true })).toHaveAttribute('value', '0.8125');
  await expect(page.getByText('Details', { exact: true }).locator('..')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: `${evidence}/${testInfo.project.name}-meter.png`, fullPage: true });
});
test('C-fidelity: Too Warm Warning recipe, compact chrome, outline wires and keyboard help', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1920, height: 1120 });
  await page.goto(`${harness}?fixture=warm`);
  if (testInfo.project.name === 'phone') await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  else {
    await activate(page, page.getByRole('button', { name: /^From Home, \d+ blocks$/ }));
    await activate(page, page.getByRole('button', { name: /^Compare, \d+ blocks$/ }));
    const average = page.getByRole('button', { name: /^Select Average \d+$/ });
    await selectBlock(page, (await average.getAttribute('aria-label'))!);
  }
  await overflow(page, testInfo.project.name === 'phone' ? 'Fit selection' : 'Fit all');
  for (const name of ['Average', 'Is Above', 'All Of', 'If / Otherwise']) await expect(page.getByRole('button', { name: new RegExp(`^Select ${name.replace('/', '\\/')} \\d+$`) })).toHaveCount(1);
  const toolbar = page.getByRole('navigation', { name: 'Canvas controls' });
  const toolbarRows = await toolbar.getByRole('button').evaluateAll(buttons => new Set(buttons.map(button => { const bounds = button.getBoundingClientRect(); return Math.round(bounds.top + bounds.height / 2); })).size);
  expect(toolbarRows).toBe(1);
  if (testInfo.project.name === 'desktop') await page.getByRole('complementary', { name: 'Block palette' }).locator('.w2-canvas-palette-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `${evidence}/${testInfo.project.name}-too-warm-warning.png`, fullPage: true });
  await overflow(page, 'Keyboard help');
  await expect(page.getByRole('dialog', { name: 'Keyboard help' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'More canvas controls' })).toBeFocused();
  await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
  await expect(page.getByRole('region', { name: 'Connections', exact: true })).toBeVisible();
});
test('C-observation: supplied values, pins, unavailable, unknown wires, kept outputs and scenario outlines', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  if (!phone) await page.setViewportSize({ width: 1920, height: 1120 });
  for (const scheme of ['light', 'dark', 'custom'] as const) {
    await page.emulateMedia({ colorScheme: scheme === 'custom' ? 'light' : scheme, reducedMotion: 'reduce' });
    await page.goto(`${harness}?fixture=observations${scheme === 'custom' ? '&theme=custom' : ''}`);
    if (phone) await activate(page, page.getByRole('button', { name: 'Close block palette' }));
    await overflow(page, phone ? 'Fit selection' : 'Fit all');
    const pinned = page.getByRole('button', { name: /^Number, Result output.*known, pinned, value 2$/ });
    const live = page.getByRole('button', { name: /^Number, Result output.*known, live, value 23.6$/ });
    const offline = page.getByRole('button', { name: /^Number, Result output.*unavailable, scenario$/ });
    const kept = page.getByRole('button', { name: /^If \/ Otherwise, Result output.*known, live, value Too warm, kept$/ });
    await expect(pinned).toContainText('2');
    expect(await pinned.locator('.w2-canvas-port-value').evaluate(element => getComputedStyle(element).color)).not.toBe(await live.locator('.w2-canvas-port-value').evaluate(element => getComputedStyle(element).color));
    await expect(offline).toHaveCSS('background-image', /repeating-linear-gradient/);
    await expect(offline.locator('..')).toHaveCSS('outline-style', 'dashed');
    await expect(page.getByRole('button', { name: /^Average, Result output.*can't tell, live$/ })).toContainText("Can't tell");
    await expect(page.locator('.w2-canvas-wire[data-observation-state=cant-tell]').first()).toHaveCSS('stroke-dasharray', /4.*3/);
    await expect(page.locator('.w2-canvas-wire[data-observation-state=known]').first()).toHaveCSS('stroke-dasharray', 'none');
    await expect(kept).toContainText('kept');
    if (phone) await expect(kept).toBeInViewport();
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-observations.png`, fullPage: true });
    if (phone) {
      for (const [label, row] of [['unavailable', offline], ['pinned', pinned]] as const) {
        await selectBlock(page, (await row.locator('..').getByRole('button', { name: /^Select / }).getAttribute('aria-label'))!);
        await overflow(page, 'Fit selection');
        await expect(row).toBeInViewport();
        await page.screenshot({ path: `${evidence}/phone-${scheme}-observation-${label}.png`, fullPage: true });
      }
    }
    await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
    await expect(page.getByRole('region', { name: 'Connections', exact: true })).toContainText("Can't tell");
  }
});
