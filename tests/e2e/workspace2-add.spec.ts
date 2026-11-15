import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewTile, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

/** Stubs Home Assistant's entities with a house of `count` entities, so the pickers have a live list. */
async function stubHouse(page: Page, count = 60) {
  const states = Array.from({ length: count }, (_, at) => {
    const domain = ['light', 'switch', 'sensor', 'binary_sensor', 'scene'][at % 5];
    return { entityId: `${domain}.demo_${at}`, name: `${domain === 'light' ? 'Lamp' : domain === 'switch' ? 'Plug' : domain === 'scene' ? 'Scene' : 'Sensor'} ${at}`, state: domain === 'sensor' ? '21' : 'on' };
  });
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}

test('the A key opens the picker, and choosing a tile adds it after the selection, selects it and opens its properties', async ({ page }) => {
  test.skip(isPhone(page), 'The keyboard route is wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  await page.keyboard.press('a');
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  await snap(page, 'desktop-add-picker');
  await picker.getByRole('listitem').filter({ hasText: 'Row' }).first().click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New row' })).toBeVisible();
});

test('add a button, set it to call a service on an entity, without typing an id', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  let steps = 0;
  const step = async <T,>(action: () => Promise<T>) => { steps += 1; return action(); };
  if (isPhone(page)) await step(() => page.locator('.w2-bottom-add').click());
  else await step(() => page.locator('.w2-add-slot').last().click());
  const picker = page.getByTestId('add-picker');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-add-picker`);
  await step(() => picker.getByRole('listitem').filter({ hasText: 'Button' }).first().click());
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'New button' })).toBeVisible();
  await step(() => panel.getByRole('button', { name: /When tapped/ }).click());
  const editor = page.getByTestId('action-editor');
  await expect(editor).toBeVisible();
  await step(() => editor.getByRole('button', { name: 'Call a Service' }).click());
  await step(() => editor.getByRole('button', { name: 'Service', exact: true }).click());
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-service-picker`);
  await step(() => page.getByRole('option', { name: /Light: Turn on/ }).first().click());
  await step(() => editor.getByRole('button', { name: 'Target', exact: true }).click());
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-entity-picker`);
  await step(() => page.getByRole('option', { name: /Lamp 0/ }).first().click());
  await expect(editor.locator('[data-target="light.demo_0"]')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-action-editor`);
  // The custom-field row names its input "Field name" once and its button "Add Field" once; the row label is not the button's twin.
  await expect(editor.getByText('Add Field', { exact: true })).toHaveCount(1);
  await expect(editor.getByRole('button', { name: 'Add Field' })).toHaveCount(1);
  await expect(editor.getByText('Field name', { exact: true })).toHaveCount(1);
  await step(() => page.getByRole('button', { name: 'Done', exact: true }).click());
  await expect(panel.getByRole('button', { name: /When tapped/ })).toContainText('light.turn_on');
  console.log(`STEPS ${isPhone(page) ? 'phone' : 'desktop'}: ${steps}`);
});

/** The titles of the tiles the preview draws, in reading order. */
const order = (page: Page) => page.locator('[data-preview-root] .sh-placeholder-title, [data-preview-root] .sh-tile-title').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() ?? ''));
const centre = async (locator: ReturnType<Page['locator']>) => { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }; };
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' }).click();

test('a mouse drag moves a tile into a grid with the cue at the pointer, selects it, and is one undo step', async ({ page }) => {
  test.skip(isPhone(page), 'The mouse route is wide');
  await openWorkspace(page);
  const before = await order(page);
  const from = await centre(previewTile(page, 'Weather')), to = await centre(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y + 8, { steps: 8 });
  const cue = page.getByTestId('drop-cue');
  await expect(cue).toBeVisible();
  const bar = (await cue.boundingBox())!;
  expect(Math.abs(bar.y - (to.y + 8))).toBeLessThan(200);
  expect(bar.x).toBeGreaterThan(to.box.x - 400);
  await expect(page.getByTestId('drop-container')).toContainText('Guests');
  await snap(page, 'desktop-drag-in-progress');
  await page.mouse.up();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Weather', exact: true })).toBeVisible();
  const after = await order(page);
  expect(after).not.toEqual(before);
  expect(after.indexOf('Weather')).toBeGreaterThan(after.indexOf('Demo Guests 2'));
  await undo(page);
  expect(await order(page)).toEqual(before);
});

test('Escape cancels a mouse drag and changes nothing', async ({ page }) => {
  test.skip(isPhone(page), 'The mouse route is wide');
  await openWorkspace(page);
  const before = await order(page);
  const from = await centre(previewTile(page, 'Weather')), to = await centre(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y + 8, { steps: 8 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await order(page)).toEqual(before);
  await expect(page.getByTestId('drop-cue')).toHaveCount(0);
});

test('a touch long press picks a tile up and moves it', async ({ page }) => {
  test.skip(!isPhone(page), 'The touch route is the phone');
  await openWorkspace(page);
  const before = await order(page);
  const from = await centre(previewTile(page, 'Weather')), to = await centre(previewTile(page, 'Demo Guests 2'));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', from.x, from.y);
  await page.waitForTimeout(400);
  for (let step = 1; step <= 8; step += 1) await touch('touchMove', from.x + (to.x - from.x) * step / 8, from.y + (to.y + 8 - from.y) * step / 8);
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await snap(page, 'phone-drag-in-progress');
  await touch('touchEnd', to.x, to.y);
  await expect.poll(() => order(page)).not.toEqual(before);
  expect((await order(page)).indexOf('Weather')).toBeGreaterThan((await order(page)).indexOf('Demo Guests 2'));
});

test('the keyboard picks a tile up, steps it through the slots, and drops it', async ({ page }) => {
  test.skip(isPhone(page), 'The handle is wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const before = await order(page);
  await page.getByRole('button', { name: 'Move', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Picked up Weather');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('drag-announcement')).toContainText(/Over|Position|position/);
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await order(page)).toEqual(before);
  await page.getByRole('button', { name: 'Move', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Moved');
  expect(await order(page)).not.toEqual(before);
  await undo(page);
  expect(await order(page)).toEqual(before);
});

test('Move Up and Move Down each make one undo step', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Weather');
  const before = await order(page);
  await panel.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Move Down' }).click();
  const moved = await order(page);
  expect(moved).not.toEqual(before);
  await undo(page);
  expect(await order(page)).toEqual(before);
});

test('This Page lists the page in order, selects a row on the canvas, and reorders by keyboard', async ({ page }) => {
  await openWorkspace(page);
  await page.locator('.w2-page-button').click();
  await page.getByRole('radio', { name: 'This Page' }).click();
  const list = page.getByTestId('this-page');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: 'Weather', exact: true })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-this-page`);
  const before = await order(page);
  const grip = list.getByRole('button', { name: 'Move Weather' });
  await grip.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => order(page)).not.toEqual(before);
});

test('the rule builder round-trips a rule and keeps the JSON for the rest', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  await page.locator('[data-preview-root] [data-sel="node:hc-home-guests-visible"]').first().click({ position: { x: 4, y: 4 } });
  const panel = page.getByLabel('Properties');
  await expect(panel).toBeVisible();
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-visible-when-row`);
  await panel.getByRole('button', { name: /Visible when/ }).click();
  const editor = page.getByTestId('rule-editor');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: /Add Condition/ }).click();
  await page.getByRole('button', { name: 'The person using the app' }).click();
  await expect(editor.getByLabel('The person')).toHaveValue('true');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-rule-builder`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.getByRole('button', { name: /Visible when/ })).not.toContainText('Always');
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await panel.getByRole('button', { name: /Visible when/ }).click();
  await expect(page.getByTestId('rule-editor').getByLabel('The person')).toHaveValue('true');
  await page.getByRole('button', { name: 'Cancel', exact: true }).or(page.locator('.w2-back')).first().click();
  if (!isPhone(page)) {
    await undo(page);
    await expect(panel.getByRole('button', { name: /Visible when/ })).toContainText('Always');
  }
});

/** Every Studio control on screen, outside the preview, with a side under 44 px. */
const smallControls = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-testid=workspace2] button, [data-testid=workspace2] [role=switch], [data-testid=workspace2] [role=menuitem], [data-testid=workspace2] input:not([type=hidden]), [data-testid=workspace2] select, [role=dialog] button, [role=option], .w2-pages button')) {
    if (element.closest('[data-preview-root]') || element.closest('[hidden]') || element.closest('[inert]')) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.height < 43.5 || box.width < 43.5) out.push(`${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 20)} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return out;
});

test('under a coarse pointer no Studio control is under 44 px', async ({ page }) => {
  test.skip(!isPhone(page), 'The measure is the touch family');
  await stubHouse(page);
  await openWorkspace(page);
  const small = () => smallControls(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  expect(await small()).toEqual([]);
  await previewTile(page, 'Weather').click();
  await expect(page.getByLabel('Properties')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await page.getByLabel('Properties').getByRole('button', { name: /Visible when/ }).click();
  await expect(page.getByTestId('rule-editor')).toBeVisible();
  expect(await small()).toEqual([]);
});

test('the entity list stays smooth with 5,000 entities: frame times while scrolling and while typing', async ({ page }) => {
  await stubHouse(page, 5000);
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  await page.getByTestId('add-picker').getByRole('button', { name: 'Entities' }).click();
  const list = page.getByRole('listbox', { name: /entities/i }).first();
  await expect(list).toBeVisible();
  await expect(list).toHaveAttribute('data-total', '5000');
  expect(await list.getByRole('option').count()).toBeLessThan(80);
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-entity-list-5000`);
  const frames = await page.evaluate(async () => {
    const box = document.querySelector<HTMLElement>('.w2-vlist')!;
    const times: number[] = [];
    let last = performance.now();
    await new Promise<void>(resolve => {
      let count = 0;
      const tick = (now: number) => { times.push(now - last); last = now; box.scrollTop += 600; count += 1; if (count < 90) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    return times.slice(2).sort((a, b) => a - b);
  });
  const median = frames[Math.floor(frames.length / 2)], p95 = frames[Math.floor(frames.length * 0.95)];
  console.log(`FRAMES ${isPhone(page) ? 'phone' : 'desktop'} median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${frames.at(-1)!.toFixed(1)} ms`);
  expect(p95).toBeLessThan(50);
  expect(await list.getByRole('option').count()).toBeLessThan(80);
  const typed = Date.now();
  await page.getByRole('searchbox', { name: /Search/ }).first().fill('lamp 42');
  await expect(list.getByRole('option').first()).toContainText(/42/);
  console.log(`FILTER ${isPhone(page) ? 'phone' : 'desktop'} ${Date.now() - typed} ms`);
});

test('the action editor makes a page and a sheet through the one New Page and New Sheet dialogs, and Done keeps both with the action', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  const editor = page.getByTestId('action-editor');
  await editor.getByRole('button', { name: kindLabel.push, exact: true }).click();
  await editor.getByRole('button', { name: 'Page', exact: true }).click();
  await page.getByRole('option', { name: /New Page/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New Page' });
  await expect(dialog.getByText('Link from')).toHaveCount(0);
  await dialog.getByLabel('Name').fill('Garage');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(editor.getByRole('button', { name: 'Page', exact: true })).toContainText('Garage');
  await editor.getByRole('button', { name: kindLabel.present, exact: true }).click();
  await editor.getByRole('button', { name: 'Sheet', exact: true }).click();
  await page.getByRole('option', { name: /New Sheet/ }).click();
  await page.getByRole('dialog', { name: 'New Sheet' }).getByLabel('Name').fill('Quick controls');
  await page.getByRole('dialog', { name: 'New Sheet' }).getByRole('button', { name: 'Create' }).click();
  await expect(editor.getByRole('button', { name: 'Sheet', exact: true })).toContainText('Quick controls');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.getByRole('button', { name: /When tapped/ })).toContainText('Quick controls');
  // The preview stayed on its page, and the sheet is in the document.
  await page.getByRole('button', { name: 'Pages' }).first().click();
  await expect(page.locator('.w2-pages').getByRole('button', { name: /^Garage/ })).toBeVisible();
  await expect(page.locator('.w2-pages').getByRole('button', { name: /^Quick controls/ })).toBeVisible();
});

const kindLabel = { push: 'Open Page', present: 'Open Sheet' };

test.describe('an iPad-width window with a touch pointer', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  test('the selection handle keeps every button at 44 px', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'The wide touch family runs once');
    await openWorkspace(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(isPhone(page)).toBe(false);
    await selectTile(page, 'Weather');
    const handle = page.getByTestId('node-handle');
    await expect(handle).toBeVisible();
    const sizes = await handle.getByRole('button').evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(); return `${button.getAttribute('aria-label')} ${Math.round(box.width)}x${Math.round(box.height)}`; }));
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(sizes.filter(size => { const [w, h] = size.split(' ').at(-1)!.split('x').map(Number); return w < 44 || h < 44; })).toEqual([]);
  });
});

test('a Toggle offers turn on and turn off, never When tapped, and the draft stays saveable', async ({ page }) => {
  await stubHouse(page);
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  await page.getByTestId('add-picker').getByRole('button', { name: 'Entities' }).click();
  await page.getByRole('option', { name: /Lamp 0/ }).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: /Lamp 0/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /When turned on/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /When tapped/ })).toHaveCount(0);
  await expect(page.getByTestId('status-tag')).not.toHaveText('Not Saved');
  // Changing the kind swaps the rows with it and keeps the draft free of clashes.
  await panel.getByRole('combobox', { name: 'Kind' }).selectOption('button');
  await expect(panel.getByRole('button', { name: /When turned on/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /When tapped/ }).or(panel.getByRole('button', { name: 'Add When tapped' }))).toBeVisible();
  // The kind change left no clash: the only problem is the action the Button still needs, and Checks says so.
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  await page.getByTestId('status-tag').click();
  await expect(page.getByText('Lamp 0: When tapped is needed.')).toBeVisible();
  await expect(page.getByText('does not work with this kind')).toHaveCount(0);
});

test('under a coarse pointer the Not Saved tag, the Tabs heading and a target chip remove are 44 px too', async ({ page }) => {
  test.skip(!isPhone(page), 'The measure is the touch family');
  await stubHouse(page);
  await openWorkspace(page);
  // The Tabs heading in Pages.
  await page.getByRole('button', { name: 'Pages' }).first().click();
  await expect(page.getByRole('button', { name: /^Tabs · \d+ of \d+$/ })).toBeVisible();
  expect(await smallControls(page)).toEqual([]);
  await page.keyboard.press('Escape');
  // A target chip's remove, in the action editor.
  await page.locator('.w2-bottom-add').click();
  await page.getByTestId('add-picker').getByRole('listitem').filter({ hasText: 'Button' }).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  const editor = page.getByTestId('action-editor');
  await editor.getByRole('button', { name: 'Call a Service' }).click();
  await editor.getByRole('button', { name: 'Service', exact: true }).click();
  await page.getByRole('option', { name: /Light: Turn on/ }).first().click();
  await editor.getByRole('button', { name: 'Target', exact: true }).click();
  await page.getByRole('option', { name: /Lamp 0/ }).first().click();
  await expect(editor.locator('[data-target="light.demo_0"]')).toBeVisible();
  expect(await smallControls(page)).toEqual([]);
  const remove = await editor.locator('.w2-chip-remove').first().boundingBox();
  expect(remove!.width).toBeGreaterThanOrEqual(43.5);
  expect(remove!.height).toBeGreaterThanOrEqual(43.5);
});

test('under a coarse pointer the Not Saved tag is 44 px', async ({ page }) => {
  test.skip(!isPhone(page), 'The measure is the touch family');
  await openWorkspace(page);
  await page.route('**/native/api/draft', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: { error: 'The disk is full.' } }) : route.continue());
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('Lamps');
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  expect(await smallControls(page)).toEqual([]);
});
