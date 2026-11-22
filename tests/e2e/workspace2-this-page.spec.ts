import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seed, snap } from './workspace2-helpers';

/** "This Page" on a phone, one level at a time (studio-ux2 pick 4). Phone project only: the wide Pages panel keeps the outline tree. */
test.skip(({ hasTouch }) => !hasTouch, 'This Page as a sheet is the phone project');
test.beforeEach(async ({ request }) => { await seed(request); });

const sheet = (page: Page) => page.getByTestId('level-sheet');
const openSheet = async (page: Page) => { await page.getByRole('button', { name: 'This Page', exact: true }).click(); await expect(sheet(page)).toBeVisible(); };
const go = async (page: Page, name: RegExp | string) => { await sheet(page).getByRole('button', { name }).click(); };
/** Down to the tile grid under "Guests Staying Over": four levels from the page. */
const toGrid = async (page: Page) => { await go(page, /^Conditional content/); await go(page, /^Guests Staying Over/); await go(page, /^Guests /); await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('Guests'); };
const titles = (page: Page) => sheet(page).locator('.w2-level-row .w2-level-title').allTextContents();

test('opens at half height on the root, with the page\'s name as the subtitle, and Done closes it', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await page.waitForTimeout(500);
  const box = await sheet(page).boundingBox();
  expect(box!.y).toBeGreaterThan(844 * 0.4); expect(box!.y).toBeLessThan(844 * 0.6);
  await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('This Page');
  await expect(sheet(page).getByRole('navigation', { name: 'Path' })).toHaveText('Home');
  await expect(sheet(page).getByRole('button', { name: /^Back to/ })).toHaveCount(0);
  expect(await titles(page)).toEqual(['Status', 'Weather', 'Conditional content', 'Cameras']);
  await snap(page, 'phone-this-page-root');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'This Page', exact: true })).toBeVisible();
});

test('goes in a level at a time with the path as the subtitle, and Back and a crumb come out again', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  await expect(sheet(page).getByRole('navigation', { name: 'Path' })).toContainText('Home');
  await expect(sheet(page).getByRole('button', { name: 'Back to Guests Staying Over' })).toBeVisible();
  expect(await titles(page)).toEqual(['Demo Guests 1', 'Demo Guests 2']);
  await snap(page, 'phone-this-page-level');
  await sheet(page).getByRole('button', { name: 'Back to Guests Staying Over' }).click();
  await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('Guests Staying Over');
  await go(page, /^Guests /);
  await sheet(page).getByRole('navigation', { name: 'Path' }).getByRole('button').first().click();
  await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('This Page');
});

test('a leaf row selects it and hands over to its properties sheet', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  await go(page, /^Demo Guests 2/);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Demo Guests 2' })).toBeVisible();
});

test('the footer\'s settings button opens the level\'s own properties, and Add Here adds into the level', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  await expect(sheet(page).getByRole('button', { name: 'Tile Grid Settings' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Add Here' }).click();
  await expect(sheet(page)).toHaveCount(0);
  const picker = page.getByTestId('add-picker');
  await expect(picker.getByRole('heading', { name: 'Add to Guests' })).toBeVisible();
  await picker.locator('[data-type=text]').click();
  await expect(page.getByLabel('Properties')).toBeVisible();
  await page.getByLabel('Properties').getByRole('button', { name: 'Close' }).click();
  await openSheet(page);
  await toGrid(page);
  expect((await titles(page)).length).toBe(3);
});

test('a touch drag on a grip reorders within the level, and the node stays selected', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  await page.waitForTimeout(400);
  const grip = await sheet(page).getByRole('button', { name: 'Move Demo Guests 1' }).boundingBox(), second = await sheet(page).locator('.w2-level-row').nth(1).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x = grip!.x + grip!.width / 2, y = grip!.y + grip!.height / 2;
  await touch('touchStart', x, y);
  // A deliberate hold starts it (220 ms); then the finger moves to the lower half of the next row.
  await page.waitForTimeout(350);
  for (let step = 1; step <= 8; step += 1) await touch('touchMove', x, y + ((second!.y + second!.height * 0.85) - y) * step / 8);
  await snap(page, 'phone-this-page-drag');
  await touch('touchEnd', x, y);
  await expect.poll(() => titles(page)).toEqual(['Demo Guests 2', 'Demo Guests 1']);
  // Still within this level, and the moved node's row is the marked one.
  await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('Guests');
  await expect(sheet(page).getByRole('button', { name: /^Demo Guests 1/ })).toHaveAttribute('aria-current', 'true');
  await expect(sheet(page).getByRole('button', { name: /^Demo Guests 2/ })).not.toHaveAttribute('aria-current', 'true');
  await expect(sheet(page)).toBeVisible();
  // One undo step puts it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => titles(page)).toEqual(['Demo Guests 1', 'Demo Guests 2']);
});

test('a touch that moves before the hold scrolls instead of dragging', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  const grip = await sheet(page).getByRole('button', { name: 'Move Demo Guests 1' }).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x = grip!.x + grip!.width / 2, y = grip!.y + grip!.height / 2;
  await touch('touchStart', x, y);
  for (let step = 1; step <= 6; step += 1) await touch('touchMove', x, y + step * 20);
  await touch('touchEnd', x, y + 120);
  await page.waitForTimeout(400);
  expect(await titles(page)).toEqual(['Demo Guests 1', 'Demo Guests 2']);
  await expect(page.getByTestId('drop-cue')).toHaveCount(0);
});

test('at 320 wide the subtitle folds to "Home › … › <parent>" on a four-level path, and no row control is clipped', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  const path = sheet(page).getByRole('navigation', { name: 'Path' });
  await expect(path.getByRole('button')).toHaveText(['Home', '…', 'Guests Staying Over']);
  await expect(path.getByRole('button', { name: 'More of the path' })).toBeVisible();
  await snap(page, 'phone-this-page-level-320');
  // The "…" opens the levels it hid.
  await path.getByRole('button', { name: 'More of the path' }).click();
  await expect(page.getByRole('menuitem', { name: 'Conditional content' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Conditional content' }).click();
  await expect(sheet(page).getByRole('heading', { level: 2 })).toHaveText('Conditional content');
  await toGridFromConditional(page);
  // The list slides in over 200 ms: measure it where it settles.
  await page.waitForTimeout(350);
  const clipped = await sheet(page).evaluate(element => {
    const bounds = element.getBoundingClientRect(), out: string[] = [];
    for (const row of element.querySelectorAll<HTMLElement>('.w2-level-row')) {
      for (const control of row.querySelectorAll<HTMLElement>('button')) {
        const box = control.getBoundingClientRect();
        if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) out.push(`${control.getAttribute('aria-label') ?? control.textContent?.slice(0, 20)} leaves the sheet`);
        if (box.width < 43.5 || box.height < 43.5) out.push(`${control.getAttribute('aria-label') ?? control.textContent?.slice(0, 20)} is ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      if (row.scrollWidth > row.clientWidth + 0.5) out.push('a row scrolls sideways');
    }
    return out;
  });
  expect(clipped).toEqual([]);
});
const toGridFromConditional = async (page: Page) => { await go(page, /^Guests Staying Over/); await go(page, /^Guests /); };

test('every control in the sheet is a 44 px target with a name, and the title is not repeated in the path', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  await toGrid(page);
  const small = await sheet(page).evaluate(element => [...element.querySelectorAll<HTMLElement>('button')].flatMap(control => {
    const box = control.getBoundingClientRect(), name = control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '';
    return box.width < 43.5 || box.height < 43.5 || !name ? [`${name || '(no name)'} ${Math.round(box.width)}x${Math.round(box.height)}`] : [];
  }));
  expect(small).toEqual([]);
  const path = await sheet(page).getByRole('navigation', { name: 'Path' }).textContent();
  expect(path).not.toMatch(/Guests$/);
});

test('levels slide on transform for 200 ms, and with Reduce Motion they fade for 120 ms', async ({ page }) => {
  await openWorkspace(page);
  await openSheet(page);
  const animation = async () => sheet(page).locator('.w2-level-view').evaluate(element => { const style = getComputedStyle(element); return { name: style.animationName, duration: style.animationDuration }; });
  await go(page, /^Conditional content/);
  expect(await animation()).toEqual({ name: 'w2-level-forward', duration: '0.2s' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await go(page, /^Guests Staying Over/);
  expect(await animation()).toEqual({ name: 'w2-level-fade', duration: '0.12s' });
});

test('Pages is opened from the page button and no longer has a This Page view', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).first().click();
  await expect(page.locator('.w2-pages')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'This Page' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'View' })).toHaveCount(0);
});
