import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { contrast, parseColor } from '../../src/workspace2/theme';

const harness = '/tests/flows-canvas/canvas/harness.html';
const evidence = path.resolve('docs/evidence/w2-c');
test.beforeEach(async ({ page }) => {
  await page.route(`**${harness}*`, async route => {
    const response = await route.fetch(), html = await response.text(), entry = /src="\/src\/main\.tsx(?:\?[^"]*)?"/;
    if (entry.test(html)) {
      await route.fulfill({ response, body: html.replace(entry, 'src="/tests/flows-canvas/canvas/harness.tsx"').replace('</head>', '<style>body{margin:0}button,input,select{font:inherit}</style></head>') });
    } else {
      if (!html.includes('harness.tsx')) throw new Error('The canvas harness requires the Vite development server or the standard Studio development test server.');
      await route.fulfill({ response });
    }
  });
});
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
  await selectBlock(page, 'Select Add 1, result'); await page.keyboard.press('Enter'); await page.keyboard.press('Delete');
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
  await selectBlock(page, 'Select Add 1, result');
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
    const search = palette.getByRole('searchbox', { name: 'Find a block' });
    await tabTo(page, search);
    const focusColors = await search.evaluate(element => ({
      visible: element.matches(':focus-visible'), ring: getComputedStyle(element).outlineColor,
      field: getComputedStyle(element.closest('.w2-canvas-search')!).backgroundColor,
      panel: getComputedStyle(element.closest('.w2-canvas-palette')!).backgroundColor,
    }));
    expect(focusColors.visible).toBe(true);
    for (const surface of [focusColors.field, focusColors.panel]) expect(contrast(parseColor(focusColors.ring)!, parseColor(surface)!)).toBeGreaterThanOrEqual(3);
    await testInfo.attach(`${scheme}-search-focus-contrast`, { body: JSON.stringify(focusColors), contentType: 'application/json' });
    await palette.locator('.w2-canvas-palette-scroll').evaluate(element => { element.scrollTop = 0; });
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
    await expect(page.getByRole('button', { name: 'No Problems', exact: true })).toBeVisible();
    await selectBlock(page, 'Select All Of 1, result'); await page.keyboard.press('Enter');
    await nodeControl(page, 'Inspect All Of'); await page.keyboard.press('Enter');
    await expect(page.getByRole('figure', { name: 'All Of, 3 checks' })).toContainText("Viewer's person is home");
    await expect(page.getByRole('figure', { name: 'All Of, 3 checks' })).toContainText('Not → Hallway Light is off');
    await expect(page.getByRole('figure', { name: 'All Of, 3 checks' }).locator('.w2-canvas-summary-branch')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Edit in Canvas', exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${scheme}-summary.png`, fullPage: true });
  }
});
test('C-meter: production canvas shows counters from its single compiler pass', async ({ page }, testInfo) => {
  await page.goto(`${harness}?fixture=meter`);
  await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  await selectBlock(page, 'Select Number 4'); await page.keyboard.press('Enter');
  await nodeControl(page, 'Inspect Number'); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Limits above 75 percent')).toContainText('52 of 64 steps');
  await expect(page.getByRole('meter', { name: 'Subtitle fit', exact: true })).toHaveAttribute('value', '0.8125');
  await expect(page.getByText('Details', { exact: true }).locator('..')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: `${evidence}/${testInfo.project.name}-meter.png`, fullPage: true });
});
test('C-meter refusal: production canvas shows the actual exceeded rule-case limit', async ({ page }, testInfo) => {
  await page.goto(`${harness}?fixture=meter-refusal`);
  await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  await expect(page.getByRole('button', { name: 'Apply to draft', exact: true })).toBeDisabled();
  await activate(page, page.getByRole('button', { name: 'Inspector', exact: true }));
  await expect(page.getByLabel('Limits above 75 percent')).toContainText('17 of 16 choices');
  await expect(page.getByRole('meter', { name: 'Subtitle fit', exact: true })).toHaveAttribute('value', '1');
  await page.getByLabel('Fits in the phone app', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/${testInfo.project.name}-meter-refusal.png`, fullPage: true });
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
  for (const name of ['Average', 'Is Above', 'All Of', 'If / Otherwise']) await expect(page.getByRole('button', { name: new RegExp(`^Select ${name.replace('/', '\\/')} \\d+${name === 'If / Otherwise' ? ', result' : ''}$`) })).toHaveCount(1);
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
for (const view of ['Graph', 'Outline'] as const) test(`C-focus ${view}: undo restores Plus after Enter, ArrowDown and Delete`, async ({ page }) => {
  await page.goto(harness);
  await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  if (view === 'Outline') await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
  await selectBlock(page, 'Select Add 1, result');
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown');
  const plus = page.getByRole('button', { name: /^Add, Plus input/ });
  await expect(plus).toBeFocused();
  await page.keyboard.press('Delete'); await expect(plus).toHaveAttribute('aria-label', /required, unconnected/);
  await page.keyboard.press('ControlOrMeta+z'); await expect(plus).toBeFocused();
  await expect(plus).toHaveAttribute('aria-label', /connected to Number/);
});
test('C-focus Outline: wire undo restores Add Value instead of the previously selected Number 3', async ({ page }) => {
  await page.goto(harness);
  await activate(page, page.getByRole('button', { name: 'Close block palette' }));
  await activate(page, page.getByRole('button', { name: 'Outline', exact: true }));
  await selectBlock(page, 'Select Number 3');
  await page.getByRole('button', { name: 'Number Result, number, to Add Value; disconnect' }).focus();
  await page.keyboard.press('Enter');
  const value = page.getByRole('button', { name: /^Add, Value input/ });
  await expect(value).toHaveAttribute('aria-label', /required, unconnected/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(value).toBeFocused();
  await expect(value).toHaveAttribute('aria-label', /connected to Number/);
});
test('C-recipe: keyboard adds and undoes the complete Average Fixed Values graph', async ({ page }) => {
  await page.goto(harness);
  await tabTo(page, page.getByRole('searchbox', { name: 'Find a block' }));
  await page.keyboard.type('Average Fixed Values');
  await expect(page.getByRole('button', { name: 'Add Average Fixed Values, number', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.w2-canvas-node')).toHaveCount(8);
  await expect(page.locator('.w2-canvas-wire')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Select Average 4', exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.w2-canvas-node')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('button', { name: 'Select Average 4', exact: true })).toBeFocused();
});
test('C-large: 2341 blocks mount, resolve ports, focus and edit within interactive budgets', async ({ page }, testInfo) => {
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Performance.enable');
  await page.addInitScript(() => {
    const reads = { ports: 0, boards: 0 }, original = Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'canvasMountReads', { value: reads });
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.w2-canvas-port')) reads.ports++;
      if (this.matches('.w2-canvas-nodes')) reads.boards++;
      return original.call(this);
    };
  });
  const paint = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const start = performance.now();
  await page.goto(`${harness}?fixture=large`);
  await expect(page.locator('.w2-canvas-nodes > li[data-node-id]')).toHaveCount(2341);
  await expect(page.locator('.w2-canvas-wire').first()).toBeAttached();
  expect(await page.locator('.w2-canvas-node').count()).toBeLessThan(100);
  expect(await page.locator('.w2-canvas-wire').count()).toBeLessThan(2340);
  await paint();
  const mount = performance.now() - start;
  const { metrics: profile } = await profiler.send('Performance.getMetrics');
  const mountProfile = Object.fromEntries(profile.filter(metric => ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'Nodes', 'LayoutCount'].includes(metric.name)).map(metric => [metric.name, metric.value]));
  const mountReads: { ports: number; boards: number } = await page.evaluate(() => Reflect.get(window, 'canvasMountReads'));
  console.info(`C-mount-profile ${testInfo.project.name}: ${JSON.stringify({ ...mountProfile, reads: mountReads })}`);
  await testInfo.attach('large-canvas-mount-profile', { body: JSON.stringify({ ...mountProfile, reads: mountReads }), contentType: 'application/json' });
  await profiler.detach();
  const lookup = Number(await page.getByLabel('Large canvas lookup performance').getAttribute('data-milliseconds'));
  expect(Number(await page.getByLabel('Large canvas lookup performance').getAttribute('data-ports'))).toBe(2340);
  await page.getByRole('button', { name: 'Close block palette' }).click();
  const header = page.getByRole('list', { name: 'Flow graph blocks', exact: true }).getByRole('button', { name: /^Select Number / }).first();
  const focusStart = performance.now();
  await header.focus(); await page.keyboard.press('Enter'); await paint();
  const focus = performance.now() - focusStart;
  await expect(page.locator('.w2-canvas-node').getByRole('button', { name: /^Number, Result output/ }).first()).toBeFocused();
  await header.click();
  await page.getByRole('button', { name: /^Close (data peek|Data peek:)/ }).click();
  await page.getByRole('button', { name: 'Inspect Number', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Value', exact: true }).fill('2');
  await paint();
  const geometry = await page.evaluateHandle(() => {
    const reads = { ports: 0, boards: 0 }, original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.w2-canvas-port')) reads.ports++;
      if (this.matches('.w2-canvas-nodes')) reads.boards++;
      return original.call(this);
    };
    return reads;
  });
  const editStart = performance.now();
  await page.getByRole('button', { name: 'Update value', exact: true }).click(); await paint();
  const edit = performance.now() - editStart;
  await expect(page.getByRole('spinbutton', { name: 'Value', exact: true })).toHaveValue('2');
  await expect(page.getByRole('status').filter({ hasText: 'Number fields updated.' })).toBeVisible();
  const geometryReads = await geometry.jsonValue(); await geometry.dispose();
  const metrics = { nodes: 2341, steps: 32, mount, lookup, focus, edit, mountReads, geometryReads, mountProfile, budgets: { mount: 5000, lookup: 50, focus: 1000, edit: 1500 } };
  console.info(`C-large ${testInfo.project.name}: ${JSON.stringify(metrics)}`);
  writeFileSync(`${evidence}/${testInfo.project.name}-large-performance.json`, JSON.stringify(metrics, null, 2) + '\n');
  await testInfo.attach('large-canvas-performance', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(mount).toBeLessThan(5000); expect(lookup).toBeLessThan(50);
  expect(focus).toBeLessThan(1000); expect(edit).toBeLessThan(1500);
  expect(mountReads.ports).toBeLessThan(500);
  expect(geometryReads).toEqual({ ports: 0, boards: 0 });
});
test('C-windowing: off-screen headers preserve reading order, reveal on focus, and remain complete in Outline', async ({ page }) => {
  await page.goto(`${harness}?fixture=large`);
  const entries = page.locator('.w2-canvas-nodes > li[data-node-id]');
  await expect(entries).toHaveCount(2341);
  const positions = await entries.evaluateAll(elements => elements.map(element => [Number(element.getAttribute('aria-posinset')), Number(element.getAttribute('aria-setsize'))]));
  expect(positions).toEqual(Array.from({ length: 2341 }, (_, index) => [index + 1, 2341]));
  await page.getByRole('button', { name: 'Close block palette' }).click();
  const readingOrder = await entries.getByRole('button', { name: /^Select / }).allTextContents();
  expect(readingOrder).toHaveLength(2341);
  const placeholder = page.locator('[data-windowed]').last(), id = await placeholder.getAttribute('data-node-id');
  const name = await placeholder.getByRole('button').getAttribute('aria-label');
  // Screen-reader/DOM focus on a lightweight off-screen header must reveal its full block.
  await placeholder.getByRole('button').focus();
  const revealed = page.locator(`.w2-canvas-node[data-node-id="${id}"]`);
  await expect(revealed.getByRole('button', { name: name!, exact: true })).toBeFocused();
  await expect(revealed).toBeInViewport();
  await expect(revealed.locator('.w2-canvas-port').first()).toBeVisible();
  await page.keyboard.press('Home');
  await expect(entries.first().getByRole('button', { name: /^Select / })).toBeFocused();
  await expect(entries.first()).toBeInViewport();
  await page.keyboard.press('End');
  await expect(entries.last().getByRole('button', { name: /^Select / })).toBeFocused();
  await expect(entries.last()).toBeInViewport();
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(page.locator('.w2-canvas-outline > .w2-canvas-node')).toHaveCount(2341);
  await expect(page.locator('[data-windowed]')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Wires', exact: true }).locator(':scope > li')).toHaveCount(2340);
  expect(await entries.evaluateAll(elements => elements.map(element => Number(element.getAttribute('aria-posinset'))))).toEqual(positions.map(([position]) => position));
  await page.keyboard.press('Home');
  await expect(entries.first().getByRole('button', { name: /^Select / })).toBeFocused();
  await page.keyboard.press('End');
  await expect(entries.last().getByRole('button', { name: /^Select / })).toBeFocused();
});
test('C-data construction: an undetectable proxy cannot swap in mutable children while being frozen', async ({ page }) => {
  await page.goto(harness);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/shared/composition/graph/index.ts';
    const api: typeof import('../../src/shared/composition/graph') = await import(modulePath);
    const graph = api.lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph;
    const edge = graph.edges[0], late = { ...edge.to };
    const proxy = new Proxy({ ...edge, to: { ...edge.to } }, {
      preventExtensions(target) { target.to = late; return Reflect.preventExtensions(target); },
    });
    const changed = { ...graph, edges: graph.edges.map((held, index) => index ? held : proxy) };
    const validation = api.validateForLowering(changed);
    const frozen = Object.isFrozen(late), mutated = Reflect.set(late, 'portId', 'missing');
    return {
      frozen, mutated, diagnostics: validation.diagnostics,
      trustedOK: api.lowerValidated(validation).ok, freshOK: api.lower(changed).ok,
    };
  });
  expect(result).toEqual({ frozen: true, mutated: false, diagnostics: [], trustedOK: true, freshOK: true });
});
