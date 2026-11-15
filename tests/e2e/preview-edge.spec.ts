import { mkdir } from 'node:fs/promises';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { mobileEditorDocument } from '../fixtures/mobile-editor';

/** Optional folder for before/after evidence screenshots. */
const evidence = process.env.STUDIO_EVIDENCE_DIR;
const scroller = (page: Page) => page.locator('.native-scroll.navigation-enter');

test.use({ deviceScaleFactor: 3 });

test.beforeEach(async ({ request }) => {
  const current = await (await request.get('/api/draft')).json();
  const put = await request.put('/api/draft', { data: { document: mobileEditorDocument({ scrollable: true }), expectedRevision: current.revision } });
  expect(put.ok(), await put.text()).toBeTruthy();
});

async function openPreview(page: Page, interact: boolean) {
  await page.goto('/');
  const phone = (page.viewportSize()?.width ?? 0) < 700;
  if (phone) await page.getByRole('navigation', { name: 'Editor panes', exact: true }).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(scroller(page)).toBeVisible();
  if (interact) await page.getByRole('button', { name: 'Interact', exact: true }).click();
  else await page.getByRole('button', { name: 'Edit', exact: true }).click();
  return phone;
}
async function snap(page: Page, name: string) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.locator('.device-screen').screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
}
/** Scroll positions of the preview scroller and every ancestor, so chained scrolling shows as a change. */
const ancestors = (page: Page) => scroller(page).evaluate(element => {
  const positions: number[] = [];
  for (let node: Element | null = element.parentElement; node; node = node.parentElement) positions.push(node.scrollTop);
  return { pageY: window.scrollY, ancestors: positions };
});
async function touchSwipe(page: Page, session: CDPSession, x: number, from: number, to: number) {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) => session.send('Input.dispatchTouchEvent', { type, touchPoints: y === undefined ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await send('touchStart', from);
  for (let step = 1; step <= 12; step++) { await send('touchMove', from + (to - from) * step / 12); await page.waitForTimeout(16); }
  await send('touchEnd');
}

for (const mode of ['edit', 'interact'] as const) {
  test(`header is a translucent soft edge over scrolling content (${mode})`, async ({ page }) => {
    await openPreview(page, mode === 'interact');
    const area = scroller(page);
    await snap(page, `header-${mode}-rest`);
    await area.evaluate(element => { element.scrollTop = 90; });
    await expect.poll(() => area.evaluate(element => element.style.getPropertyValue('--header-progress'))).toBe('1');
    await snap(page, `header-${mode}-scrolled`);
    const glass = await area.locator('.native-toolbar').first().evaluate(toolbar => {
      const style = getComputedStyle(toolbar, '::before');
      return { filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'), mask: style.maskImage || style.getPropertyValue('-webkit-mask-image'), border: style.borderBottomWidth, height: toolbar.getBoundingClientRect().height };
    });
    expect(glass.filter).toContain('blur');
    expect(glass.mask).toContain('linear-gradient');
    expect(glass.border).toBe('0px');
    // Content reaches the very top of the screen: the element under the status bar belongs to the page, not to the bar.
    const beneath = await page.evaluate(() => {
      const screen = document.querySelector('.device-screen .native-app')!.getBoundingClientRect();
      const bar = document.querySelector('.native-statusbar')!.getBoundingClientRect();
      const stack = document.elementsFromPoint(screen.left + screen.width * 0.2, bar.top + bar.height / 2);
      return { barOverlaysScroller: bar.top <= document.querySelector('.native-scroll.navigation-enter')!.getBoundingClientRect().top + 1, stack: stack.map(element => element.className?.toString() ?? '') };
    });
    expect(beneath, JSON.stringify(beneath)).toHaveProperty('barOverlaysScroller', true);
    expect(beneath.stack.some(name => /native-page-content|native-page-title|native-node|native-text|native-layout/.test(name)), beneath.stack.join(' | ')).toBe(true);
  });
}

test('wheel and touch scrolling inside the preview never scroll the Studio page', async ({ page }, testInfo) => {
  const phone = await openPreview(page, true);
  const area = scroller(page);
  const box = (await area.boundingBox())!;
  const before = await ancestors(page);
  if (phone) {
    const session = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    for (let swipe = 0; swipe < 8; swipe++) await touchSwipe(page, session, x, box.y + box.height * 0.55, box.y + box.height * 0.15);
    expect(await area.evaluate(element => element.scrollTop), 'touch keeps native scrolling in the preview').toBeGreaterThan(0);
    for (let swipe = 0; swipe < 8; swipe++) await touchSwipe(page, session, x, box.y + box.height * 0.15, box.y + box.height * 0.55);
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let tick = 0; tick < 30; tick++) await page.mouse.wheel(0, 240);
    await expect.poll(() => area.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true);
    expect(await ancestors(page), 'wheel at the bottom end').toEqual(before);
    for (let tick = 0; tick < 30; tick++) await page.mouse.wheel(0, -240);
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBe(0);
    // Over the bezel, where nothing can scroll, the page still stays put.
    await page.mouse.move(box.x - 6, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
  }
  expect(await ancestors(page), `${testInfo.project.name}: nothing outside the preview moved`).toEqual(before);
});

test('mouse drag in Interact mode pans the preview without selecting text and swallows the click', async ({ page }, testInfo) => {
  await openPreview(page, true);
  const area = scroller(page);
  await area.evaluate(element => { (window as unknown as { clicks: number }).clicks = 0; element.addEventListener('click', () => { (window as unknown as { clicks: number }).clicks++; }); });
  const box = (await area.boundingBox())!;
  const x = box.x + box.width / 2, start = box.y + box.height * 0.75;
  await snap(page, 'interact-drag-before');
  await page.mouse.move(x, start);
  await page.mouse.down();
  for (let step = 1; step <= 14; step++) await page.mouse.move(x, start - step * 14, { steps: 2 });
  await snap(page, 'interact-drag-held');
  expect(await area.evaluate(element => element.scrollTop), 'content follows the pointer while held').toBeGreaterThan(80);
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 'the click that ends a drag is swallowed').toBe(0);
  await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(80);
  // Drag back down with momentum, then a double click must not select words either.
  await page.mouse.move(x, box.y + 120); await page.mouse.down();
  for (let step = 1; step <= 14; step++) await page.mouse.move(x, box.y + 120 + step * 16, { steps: 2 });
  await page.mouse.up();
  await page.mouse.dblclick(x, box.y + box.height * 0.5);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  expect(testInfo.project.name).toBeTruthy();
});

test('Edit mode keeps drag-and-drop: no pan, no stray selection', async ({ page }) => {
  await openPreview(page, false);
  const area = scroller(page);
  const box = (await area.boundingBox())!;
  const x = box.x + box.width / 2, start = box.y + box.height * 0.5;
  await page.mouse.move(x, start); await page.mouse.down();
  await page.mouse.move(x, start - 40, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
});

test('primary buttons in sidebar dialogs are readable', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 700, 'desktop sidebar');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add tab', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const primary = dialog.locator('button.primary');
  if (evidence) { await mkdir(evidence, { recursive: true }); await dialog.screenshot({ path: `${evidence}/dialog-primary-button.png` }); }
  const ratio = await primary.evaluate(button => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([r, g, b]: number[]) => { const [lr, lg, lb] = [r, g, b].map(channel => { const unit = channel / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; }); return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb; };
    const style = getComputedStyle(button);
    const [a, b] = [luminance(channels(style.color)), luminance(channels(style.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  expect(ratio).toBeGreaterThan(4.5);
});
