import { expect, test, type Page } from '@playwright/test';
import { contrast, over, parseColor } from '../../src/workspace2/theme';
import { expectOnPage, isPhone, openChecksFromBar, openPagesList, openWorkspace, previewRoot, previewTile, readableText, seed, selectTile, snap, visibleControls } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

const publication = (revision: number) => ({ epoch: 'e2e', current: { revision, publishedAt: '2026-11-14T10:00:00Z', publishedBy: null, envelopeSha256: 'a'.repeat(64), capabilities: [] }, history: [], storedAssets: 0 });

/** Stubs the Home Assistant publication endpoints; the Studio never publishes to a real house in a test. */
async function stubPublication(page: Page, options: { revision?: number; fail?: string } = {}) {
  let live = options.revision ?? 12;
  await page.route('**/native/api/ha/publication', route => route.fulfill({ json: publication(live) }));
  await page.route('**/native/api/ha/publish', route => {
    if (options.fail) return route.fulfill({ status: 502, json: { error: options.fail } });
    live += 1;
    return route.fulfill({ json: { epoch: 'e2e', revision: live, envelopeSha256: 'b'.repeat(64) } });
  });
}

test('the workspace opens on the preview with few controls, and a selection adds only its own', async ({ page }) => {
  test.skip(isPhone(page), 'The control budget is for the wide layout');
  await openWorkspace(page);
  const rest = await visibleControls(page);
  expect(rest.length, rest.join(', ')).toBeLessThanOrEqual(13); // ten, and the simulator rail's three (Rotate, Smaller Text, Larger Text)
  await expect(page.getByText('S+H Studio', { exact: true })).toBeVisible();
  await snap(page, 'desktop-rest');
  await selectTile(page, 'Lights');
  const selected = await visibleControls(page);
  expect(selected.length, selected.join(', ')).toBeLessThanOrEqual(30);
  await snap(page, 'desktop-tile');
  // The old chrome is gone.
  for (const gone of ['Save draft', 'Publish native', 'Validation', '2.0 workspace', 'Open 1.0 Editor']) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
});

test('selecting a tile on a phone shows its properties without hiding the tile', async ({ page }) => {
  test.skip(!isPhone(page), 'The sheet is the narrow layout');
  await openWorkspace(page);
  await snap(page, 'phone-rest');
  const tile = previewTile(page, 'Lights');
  await tile.click();
  const sheet = page.getByLabel('Properties');
  await expect(sheet.getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
  await expect(sheet.getByLabel('Title')).toBeVisible();
  await page.waitForTimeout(700);
  const box = await tile.boundingBox(), sheetBox = await sheet.boundingBox();
  expect(box && sheetBox && box.y + box.height <= sheetBox.y + 1, `tile ${JSON.stringify(box)} sits above sheet ${JSON.stringify(sheetBox)}`).toBeTruthy();
  await snap(page, 'phone-tile');
  expect((await visibleControls(page)).length).toBeLessThanOrEqual(30);
});

test('a tile low on the page is scrolled above the half sheet when it is selected', async ({ page }) => {
  test.skip(!isPhone(page), 'The sheet is the narrow layout');
  await openWorkspace(page);
  // The lowest tile that is fully on screen before the sheet opens: the half sheet would cover it unless the preview reveals it.
  const lowest = await page.evaluate(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-preview-root] .sh-page[data-current] .sh-node[data-type$="tile"]')]
      .map(element => ({ element, box: element.getBoundingClientRect() })).filter(item => item.box.bottom < innerHeight - 90 && item.box.top > 100);
    found.sort((a, b) => b.box.top - a.box.top);
    return found[0]?.element.getAttribute('data-sel') ?? null;
  });
  expect(lowest, 'a tile low on the home page').toBeTruthy();
  const tile = page.locator(`[data-preview-root] [data-sel="${lowest}"]`).first();
  await tile.click({ position: { x: 4, y: 4 } });
  const sheet = page.getByLabel('Properties');
  await expect(sheet.getByLabel('Title')).toBeVisible();
  await page.waitForTimeout(900);
  const box = await tile.boundingBox(), sheetBox = await sheet.boundingBox();
  expect(box && sheetBox && box.y >= 0 && box.y + box.height <= sheetBox.y + 1, `tile ${JSON.stringify(box)} sits above sheet ${JSON.stringify(sheetBox)}`).toBeTruthy();
});

test('the last row of the half sheet scrolls into view above the fold', async ({ page }) => {
  test.skip(!isPhone(page), 'The sheet is the narrow layout');
  await openWorkspace(page);
  await selectTile(page, 'Lights');
  await page.waitForTimeout(900);
  const advanced = page.getByRole('button', { name: 'Advanced' });
  // A swipe up inside the sheet: the content scrolls, so its last row comes above the fold.
  await page.locator('.w2-props-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const box = await advanced.boundingBox();
  expect(box && box.y + box.height <= 844, `Advanced at ${JSON.stringify(box)} is on screen`).toBeTruthy();
});

test('a title typed in properties reaches the preview in the same frame', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Lights');
  const seen = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Properties"] input[aria-label="Title"], [aria-label="Properties"] input[id]') ;
    const field = [...document.querySelectorAll<HTMLInputElement>('[aria-label="Properties"] input')].find(item => item.value === 'Lights') ?? input!;
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Lamps');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return document.querySelector('[data-preview-root]')!.textContent!.includes('Lamps') && !document.querySelector('[data-preview-root]')!.textContent!.includes('Lights');
  });
  expect(seen, 'the preview shows the new title one frame after the input').toBeTruthy();
});

test('the phone sheet opens at half, snaps to its header, and a swipe down from there closes it', async ({ page }) => {
  test.skip(!isPhone(page), 'The sheet is the narrow layout');
  await openWorkspace(page);
  await previewTile(page, 'Lights').click();
  const sheet = page.getByLabel('Properties');
  await expect(sheet.getByLabel('Title')).toBeVisible();
  await page.waitForTimeout(700);
  const visibleHeight = async () => { const box = await sheet.boundingBox(); return box ? Math.round(844 - box.y) : 0; };
  const half = await visibleHeight();
  expect(half).toBeGreaterThan(330); expect(half).toBeLessThan(500);
  const cdp = await page.context().newCDPSession(page);
  const drag = async (from: number, to: number, steps: number, pause: number) => {
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y === undefined ? [] : [{ x: 195, y, id: 1 }] });
    await send('touchStart', from);
    for (let step = 1; step <= steps; step++) { await send('touchMove', from + (to - from) * step / steps); await page.waitForTimeout(pause); }
    await send('touchEnd'); await page.waitForTimeout(800);
  };
  // A slow drag of the grabber down to the header-only point, then a quick swipe down from there closes the sheet.
  await drag(844 - half + 10, 844 - 88 + 10, 40, 25);
  expect(await visibleHeight()).toBeLessThan(140);
  expect(await visibleHeight()).toBeGreaterThan(60);
  await drag(844 - 70, 844, 10, 12);
  await expect(sheet).toHaveCount(0);
  await expect(page.getByLabel('Properties')).toHaveCount(0);
});

test('editing a title in properties changes the preview and autosaves', async ({ page }) => {
  await openWorkspace(page);
  await selectTile(page, 'Lights');
  const title = page.getByLabel('Title', { exact: true }).first();
  await title.fill('Lamps');
  // The preview follows on the next frame, with no reload.
  await expect(previewTile(page, 'Lamps')).toBeVisible({ timeout: 1000 });
  await expect(previewTile(page, 'Lights')).toHaveCount(0);
  if (!isPhone(page)) {
    await expect(page.getByTestId('status-tag')).toHaveText('Saving…');
    await expect(page.getByTestId('status-tag')).toHaveText(/^(Draft · )?Saved$/, { timeout: 8000 });
  } else await expect(page.getByTestId('status-tag')).toHaveText(/^(Draft · )?Saved$/, { timeout: 8000 });
  const saved = await (await page.request.get('/native/api/draft')).json();
  expect(JSON.stringify(saved.document)).toContain('Lamps');
  await page.reload();
  await expect(previewTile(page, 'Lamps')).toBeVisible();
});

test('Publish confirms, publishes through a stubbed Home Assistant and updates the tag', async ({ page }) => {
  await stubPublication(page, { revision: 12 });
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to the App?' });
  await expect(dialog.getByText('Revision 13 replaces revision 12. The app updates right away.')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-publish`);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  if (!isPhone(page)) await expect(page.getByTestId('status-tag')).toHaveText('Published · 13', { timeout: 8000 });
});

test('a publish that fails keeps the dialog open with the reason and Try Again', async ({ page }) => {
  await stubPublication(page, { fail: 'Home Assistant did not answer.' });
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByText('Home Assistant did not answer.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Try Again' })).toBeVisible();
  // The draft saved; only the publish failed, so the tag never says Not Saved.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('status-tag')).not.toHaveText('Not Saved');
  await expect(page.getByTestId('status-tag')).toHaveText(/Not Published|^(Draft · )?Saved$/);
});

test('a save that fails shows Not Saved, the reason under Checks, and recovers with Try Again', async ({ page }) => {
  await openWorkspace(page);
  let failing = true;
  await page.route('**/native/api/draft', route => route.request().method() === 'PUT' && failing ? route.fulfill({ status: 500, json: { error: 'The disk is full.' } }) : route.continue());
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('Lamps');
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  // Wide: the pill. Narrow: the status line is not a button, so Checks is Project's first row, "Checks · Not Saved".
  if (isPhone(page)) await openChecksFromBar(page); else await page.getByTestId('checks-pill').click();
  await expect(page.getByText('The disk is full.')).toBeVisible();
  failing = false;
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-not-saved`);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByTestId('status-tag')).toHaveText(/^(Draft · )?Saved$/, { timeout: 8000 });
});

test('a conflict asks which version to keep, and Decide Later leaves Not Saved with Publish off', async ({ page }) => {
  test.skip(isPhone(page), 'The disabled Publish is the wide layout');
  await openWorkspace(page);
  let conflicting = true;
  await page.route('**/native/api/draft', route => route.request().method() === 'PUT' && conflicting ? route.fulfill({ status: 409, json: { error: 'The draft changed' } }) : route.continue());
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('Lamps');
  const dialog = page.getByRole('dialog', { name: 'This Draft Changed Somewhere Else' });
  await expect(dialog.getByText('Choose which version to keep.')).toBeVisible({ timeout: 8000 });
  await expect(dialog.getByRole('button', { name: 'Keep Mine' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use the Server Version' })).toBeVisible();
  await snap(page, 'desktop-conflict');
  await dialog.getByRole('button', { name: 'Decide Later' }).click();
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  // Deciding later is never a dead end: the tag and Try Again both bring the choice back, and Keep Mine saves the local edit.
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('status-tag').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Decide Later' }).click();
  await page.getByTestId('checks-pill').click();
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(dialog).toBeVisible();
  conflicting = false;
  await dialog.getByRole('button', { name: 'Keep Mine' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('status-tag')).toHaveText(/^(Draft · )?Saved$/, { timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
});

test('not signed in, and a draft that will not load, each say so with a way forward', async ({ page }) => {
  await page.route('**/native/api/draft', route => route.fulfill({ status: 401, json: { error: 'Authentication required for native composition' } }));
  await page.goto('/');
  await expect(page.getByText('Not signed in.')).toBeVisible();
  await expect(page.getByText('Start the Studio with a token. See the README.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-not-signed-in`);
  await page.unroute('**/native/api/draft');
  await page.route('**/native/api/draft', route => route.fulfill({ status: 500, json: { error: 'The store is unavailable.' } }));
  await page.reload();
  await expect(page.getByText('Couldn’t load the draft.')).toBeVisible();
  await expect(page.getByText('The store is unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
});

test('every surface speaks the new vocabulary and nothing from the cut list', async ({ page }) => {
  test.skip(isPhone(page), 'Wide menus and dialogs; the phone sheets share the same bodies');
  await stubPublication(page);
  await openWorkspace(page);
  const forbidden = /First-slice native contract|Stable IDs are read-only|Native policies|Validation|\bschema\b|composition|Native Home|S\+H Native|Studio 2\.0/i;
  const aboutOnly = /manifest|publisher/i;
  const check = async (surface: string, allowAbout = false) => {
    // Capability identifiers (sh.composition@1) are data, listed in About.
    const text = (await readableText(page)).replace(/sh\.[a-z.-]+@\d+/g, '');
    expect(text, `${surface} shows a cut word`).not.toMatch(forbidden);
    if (!allowAbout) expect(text, `${surface} shows a word reserved for About`).not.toMatch(aboutOnly);
  };
  await check('rest');
  await selectTile(page, 'Lights'); await check('tile properties');
  await page.getByLabel('Properties').getByRole('button', { name: 'Advanced' }).click(); await check('advanced');
  await page.getByLabel('Properties').getByRole('button', { name: 'Close' }).click();
  await previewTile(page, 'Home').click(); await expect(page.getByText('Page settings')).toBeVisible(); await check('page settings');
  await page.getByLabel('Properties').getByRole('button', { name: 'Advanced' }).click(); await check('page advanced');
  await page.getByLabel('Properties').getByRole('button', { name: 'Close' }).click();
  await openPagesList(page); await check('pages');
  await page.keyboard.press('Escape');
  await page.getByTestId('checks-pill').click(); await check('checks');
  await page.keyboard.press('Escape');
  const project = async (item: string, allowAbout = false) => {
    await page.getByRole('button', { name: 'Project' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await page.waitForTimeout(300);
    await check(item, allowAbout);
  };
  await page.getByRole('button', { name: 'Project' }).click(); await expect(page.getByRole('menu')).toBeVisible(); await check('project menu'); await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  for (const item of ['Data', 'Local State', 'Links', 'App Launch', 'Live Activities', 'Publish History', 'Import…', 'Edit as JSON…', 'Activity', 'Help']) {
    await project(item);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  await project('About', true);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  for (const item of ['Tabs', 'Header Buttons', 'Wallpaper']) { await project(item); await page.getByLabel('Properties').getByRole('button', { name: 'Close', exact: true }).click(); }
  await page.getByRole('button', { name: 'Publish' }).click(); await check('publish'); await page.keyboard.press('Escape');
});

test('the Project menu, Pages and the tab panel work at both sizes', async ({ page }) => {
  await stubPublication(page);
  await openWorkspace(page);
  const tag = isPhone(page) ? 'phone' : 'desktop';
  const pages = await openPagesList(page);
  const row = (name: string) => isPhone(page) ? pages.getByRole('button', { name }).first() : pages.locator('[role=treeitem][aria-level="1"]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
  await expect(row('Security')).toBeVisible();
  await snap(page, `${tag}-pages`);
  await page.getByRole('searchbox', { name: 'Find a tab' }).fill('climate');
  await expect(page.getByText(/No (pages|tabs) match\./)).toHaveCount(0);
  await row('Climate').click();
  await expectOnPage(page, 'Climate');
  await page.getByRole('button', { name: 'Project' }).click();
  await snap(page, `${tag}-project`);
  if (isPhone(page)) await page.getByText('Tabs', { exact: true }).first().click(); else await page.getByRole('menuitem', { name: 'Tabs' }).click();
  await expect(page.getByText('Tab bar · 3 of 5')).toBeVisible();
  await expect(page.getByText('The tab bar holds 5.')).toHaveCount(0);
});

test('a selected status chip stays readable: the Studio hover never repaints the preview, and its text clears 4.5:1 on any wallpaper', async ({ page }) => {
  await openWorkspace(page);
  await page.waitForTimeout(800);
  await selectTile(page, 'Lights');
  // The pointer rests on the chip beside it, as it does after a click on the first chip's handle; the Studio's own hover rule must not reach in.
  const chip = previewRoot(page).locator('[data-type=status-chip] button').nth(2);
  await chip.hover();
  for (const button of await previewRoot(page).locator('[data-type=status-chip] button').all()) {
    const [text, ground] = await button.evaluate(element => { const style = getComputedStyle(element); return [style.color, style.backgroundColor]; });
    const ink = parseColor(text)!, fill = parseColor(ground)!;
    // The chip's fill is translucent over the wallpaper: judge it over white, the worst ground.
    expect(contrast(ink, over(fill, { r: 255, g: 255, b: 255, a: 1 })), `${await button.innerText()}: ${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(await chip.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(242, 241, 252)');
});

test('the page button shows a short page name whole on the narrow top bar', async ({ page }) => {
  test.skip(!isPhone(page), 'The narrow top bar is the phone layout');
  await openWorkspace(page);
  const label = page.getByRole('button', { name: 'Pages' }).first().locator('span');
  await expect(label).toHaveText('Home');
  const fit = await label.evaluate(element => ({ clipped: element.scrollWidth > element.clientWidth, width: element.getBoundingClientRect().width }));
  expect(fit.clipped).toBe(false);
  expect(fit.width).toBeGreaterThan(30);
  const bar = await page.locator('.w2-topbar').evaluate(element => element.scrollWidth <= element.clientWidth);
  expect(bar).toBe(true);
});

test('on the narrow layout Problems live in the status line and the dot on More, and Checks is Project\'s first row; no pill covers the preview', async ({ page }) => {
  test.skip(!isPhone(page), 'The narrow layout');
  await openWorkspace(page);
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('');
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  // The bar says it; a pill floating over the preview (and its Dynamic Island) would say it twice.
  await expect(page.getByTestId('checks-pill')).toBeHidden();
  await expect(page.getByTestId('more-dot')).toBeVisible();
  await snap(page, 'phone-problem-in-bar');
  // The status line is a status, so it is not a target; the way to Checks is the first row of the Project sheet.
  expect(await page.getByTestId('status-tag').evaluate(element => element.tagName)).not.toBe('BUTTON');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.locator('.w2-project-sheet .w2-list-row').first()).toHaveText('Checks · Not Saved');
  await page.locator('.w2-project-sheet .w2-list-row').first().click();
  await expect(page.getByText(/Untitled .+: Title is empty\./).first()).toBeVisible();
});

test('a tap in Use shows a readable note in words that stays for at least four seconds', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await previewRoot(page).locator('.sh-tab', { hasText: 'Security' }).click();
  // The note's lifetime is timed in the page, from the frame it shows to the frame it goes, so a slow test step cannot eat into the four seconds.
  await page.evaluate(() => {
    const times: { shown?: number; hidden?: number } = {};
    (window as unknown as { __noteTimes: typeof times }).__noteTimes = times;
    const check = () => {
      const pill = document.querySelector<HTMLElement>('[data-testid="checks-pill"]');
      const showing = Boolean(pill && !pill.hidden && pill.classList.contains('w2-pill-note'));
      if (showing && times.shown === undefined) times.shown = performance.now();
      if (!showing && times.shown !== undefined && times.hidden === undefined) times.hidden = performance.now();
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await previewRoot(page).locator('.sh-page[data-current] .sh-node[data-type="action-tile"]').first().click();
  const note = page.getByTestId('checks-pill');
  await expect(note).toBeVisible();
  const text = (await note.textContent())!.trim();
  expect(text).toMatch(/^.+: [a-z ]+$/);
  expect(text).not.toMatch(/Simulated|[a-z]+_[a-z]+\.|\b[a-z_]+\.[a-z_]+\b/);
  const style = await note.evaluate(element => { const css = getComputedStyle(element); return { color: css.color, background: css.backgroundColor }; });
  const luminance = (value: string) => { const [r, g, b] = value.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map(channel => { const c = channel / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const [light, dark] = [luminance(style.color), luminance(style.background)].sort((a, b) => b - a);
  expect((light + .05) / (dark + .05)).toBeGreaterThanOrEqual(4.5);
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-use-note`);
  await expect(note).not.toContainText(text, { timeout: 8000 });
  const lived = await page.evaluate(() => { const times = (window as unknown as { __noteTimes: { shown?: number; hidden?: number } }).__noteTimes; return times.shown === undefined || times.hidden === undefined ? -1 : times.hidden - times.shown; });
  expect(lived).toBeGreaterThanOrEqual(3950);
});

test('the narrow layout hides the Problems pill while there is nothing to report', async ({ page }) => {
  test.skip(!isPhone(page), 'The narrow layout');
  await openWorkspace(page);
  await expect(page.getByTestId('checks-pill')).toBeHidden();
});

test('Undo on a phone keeps the properties sheet open on the same selection', async ({ page }) => {
  test.skip(!isPhone(page), 'The sheet is the narrow layout');
  await openWorkspace(page);
  await selectTile(page, 'Lights');
  const sheet = page.getByLabel('Properties');
  const title = sheet.getByLabel('Title', { exact: true }).first();
  await title.fill('Lamps');
  await expect(previewRoot(page)).toContainText('Lamps');
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(previewRoot(page)).not.toContainText('Lamps');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
  await expect(title).toHaveValue('Lights');
});
