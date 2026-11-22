import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seed, selectTile, snap } from './workspace2-helpers';
import { documentWithLevels } from '../support/levels-document';

/** The phone's two bars (studio-ux2 pick 3A): five top slots and three bottom ones, each where it always is. Phone project only. */
test.skip(({ hasTouch }) => !hasTouch, 'The phone bars are the phone project');
test.beforeEach(async ({ request }) => { await seed(request); });

/**
 * Gives the open draft a problem: a tile with an emptied title. The page then holds a draft it cannot save, so the status line reads
 * "Not Saved" (a draft that is dirty and has problems; the count shows only for a loaded draft that has some, which the server never stores).
 */
async function withProblem(page: Page) {
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('');
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
}

interface Box { name: string; x: number; y: number; width: number; height: number }
/** Every control of a bar, by its name, with its box. */
const controls = (page: Page, selector: string): Promise<Box[]> => page.evaluate(selector => [...document.querySelectorAll<HTMLElement>(`${selector} button, ${selector} [role=status]`)].map(item => {
  const box = item.getBoundingClientRect();
  return { name: item.getAttribute('aria-label') ?? item.textContent?.trim() ?? item.tagName, x: Math.round(box.x * 10) / 10, y: box.y, width: Math.round(box.width * 10) / 10, height: box.height };
}).filter(item => item.width > 0 && item.height > 0), selector);

/** No two of the boxes intersect, and none leaves the window. */
function expectApart(boxes: Box[], width: number, where: string) {
  expect(boxes.length, where).toBeGreaterThan(2);
  for (const [at, a] of boxes.entries()) {
    for (const b of boxes.slice(at + 1)) {
      // The status line is drawn under the page's name inside the page button, on purpose: it is part of slot 1.
      if ([a.name, b.name].every(name => name === 'Pages' || /^(Saved|Saving…|Not Saved|\d+ Problems?|Published · \d+|Not Published)$/.test(name))) continue;
      const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
      expect(apart, `${a.name} and ${b.name} overlap ${where}`).toBe(true);
    }
    expect(a.x, `${a.name} leaves the window ${where}`).toBeGreaterThanOrEqual(-0.5);
    expect(a.x + a.width, `${a.name} leaves the window ${where}`).toBeLessThanOrEqual(width + 0.5);
  }
}
/** The slots' x and width, by name: what must not change between states. */
const slots = (boxes: Box[]) => Object.fromEntries(boxes.filter(box => !/^(Saved|Saving…|Not Saved|\d+ Problems?)$/.test(box.name)).map(box => [box.name, [box.x, box.width, box.y, box.height]]));

for (const width of [320, 359, 360, 390, 466, 599]) {
  test(`at ${width} wide no two controls intersect, and each slot is where it always is in Edit and Use`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openWorkspace(page);
    const top = await controls(page, '.w2-topbar'), bottom = await controls(page, '.w2-bottombar');
    expectApart(top, width, `in the top bar at ${width}`);
    expectApart(bottom, width, `in the bottom bar at ${width}`);
    // Five slots: Pages (with the status line), Undo, Redo from 360, Publish and Project.
    expect(top.map(box => box.name).filter(name => ['Pages', 'Undo', 'Redo', 'Publish', 'Project'].includes(name))).toEqual(width < 360 ? ['Pages', 'Undo', 'Publish', 'Project'] : ['Pages', 'Undo', 'Redo', 'Publish', 'Project']);
    const publish = top.find(box => box.name === 'Publish')!, undo = top.find(box => box.name === 'Undo')!;
    expect(publish.height).toBe(44); expect(publish.width).toBeGreaterThanOrEqual(84);
    expect([undo.width, undo.height]).toEqual([44, 44]);
    expect(top.find(box => box.name === 'Pages')!.width).toBeGreaterThanOrEqual(96);
    // The bottom bar: Edit and Use lead, This Page is a glyph alone under 360, Add trails.
    const bar = await page.locator('.w2-bottombar').boundingBox();
    expect(bar!.height).toBeGreaterThanOrEqual(60 - 0.5);
    const page_ = bottom.find(box => box.name === 'This Page')!;
    expect(page_.height).toBe(44);
    expect(page_.width).toBe(width < 360 ? 44 : page_.width);
    if (width >= 360) expect(page_.width).toBeGreaterThan(44);
    const edit = slots(top), editBottom = slots(bottom);
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(page.getByRole('button', { name: 'This Page', exact: true })).toBeDisabled();
    await expect(page.locator('.w2-bottom-add')).toBeDisabled();
    expect(slots(await controls(page, '.w2-topbar'))).toEqual(edit);
    expect(slots(await controls(page, '.w2-bottombar'))).toEqual(editBottom);
    await snap(page, `phone-bars-${width}-use`);
  });
}

test('the slots hold with a problem and with a save that failed', async ({ page }) => {
  await openWorkspace(page);
  const saved = slots(await controls(page, '.w2-topbar'));
  await withProblem(page);
  expect(slots(await controls(page, '.w2-topbar'))).toEqual(saved);
  expectApart(await controls(page, '.w2-topbar'), 390, 'with a problem');
  await snap(page, 'phone-bars-problem');
  await page.reload();
  let failing = true;
  await page.route('**/native/api/draft', route => route.request().method() === 'PUT' && failing ? route.fulfill({ status: 500, json: { error: 'The disk is full.' } }) : route.continue());
  await selectTile(page, 'Lights');
  await page.getByLabel('Title', { exact: true }).first().fill('Lamps');
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved', { timeout: 8000 });
  expect(slots(await controls(page, '.w2-topbar'))).toEqual(saved);
  failing = false;
});

test('the status line is a status, not a button: it names the state, and presses through it open Pages', async ({ page }) => {
  await openWorkspace(page);
  const line = page.getByTestId('status-tag');
  await expect(line).toHaveAttribute('role', 'status');
  await expect(line).toHaveText(/^(Draft · )?Saved$/);
  expect(await line.evaluate(element => element.tagName === 'BUTTON' || Boolean(element.closest('button')))).toBe(false);
  await line.click({ force: true });
  await expect(page.locator('.w2-pages')).toBeVisible();
});

test('with a problem the status line says so, More carries a dot, and Project\'s first row opens Checks', async ({ page }) => {
  await openWorkspace(page);
  await withProblem(page);
  const line = page.getByTestId('status-tag');
  await expect(line).toHaveText('Not Saved');
  await expect(page.getByTestId('more-dot')).toBeVisible();
  // The error ink, and the dot sits inside More's box.
  expect(await line.evaluate(element => getComputedStyle(element).color)).not.toBe(await page.locator('.w2-page-name').evaluate(element => getComputedStyle(element).color));
  const dot = await page.getByTestId('more-dot').boundingBox(), more = await page.getByRole('button', { name: 'Project' }).boundingBox();
  expect(dot!.x).toBeGreaterThanOrEqual(more!.x); expect(dot!.x + dot!.width).toBeLessThanOrEqual(more!.x + more!.width + 0.5);
  // Publish stays enabled: its dialog names the problems.
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
  await page.getByRole('button', { name: 'Project' }).click();
  const first = page.locator('.w2-project-sheet .w2-list-row').first();
  await expect(first).toHaveText('Checks · Not Saved');
  await snap(page, 'phone-project-checks-row');
  await first.click();
  await expect(page.getByText(/Title is empty/).first()).toBeVisible();
});

test('without problems More has no dot and Project does not lead with Checks', async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByTestId('more-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Project' }).click();
  await expect(page.locator('.w2-project-sheet .w2-list-row').first()).not.toContainText('Checks');
});

test('Redo is gone from the bar under 360 wide and stays in the Project sheet', async ({ page }) => {
  await page.setViewportSize({ width: 359, height: 844 });
  await openWorkspace(page);
  await expect(page.locator('.w2-topbar').getByRole('button', { name: 'Redo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Project' }).click();
  await expect(page.locator('.w2-project-sheet').getByRole('button', { name: 'Redo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 844 });
  await expect(page.locator('.w2-topbar').getByRole('button', { name: 'Redo' })).toBeVisible();
});

test('the simulator-controls row stays directly above the bottom bar and overlaps nothing', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.locator('.w2-project-sheet').getByRole('button', { name: 'Window' }).click();
  await page.locator('.w2-pushed').getByRole('button', { name: /iPad/ }).first().click();
  await page.keyboard.press('Escape');
  const row = page.locator('.w2-rail-under');
  await expect(row).toBeVisible();
  const [rail, bar] = await Promise.all([row.boundingBox(), page.locator('.w2-bottombar').boundingBox()]);
  expect(Math.abs(rail!.y + rail!.height - bar!.y)).toBeLessThanOrEqual(1);
  const railControls = await controls(page, '.w2-rail-under');
  expectApart([...railControls, ...(await controls(page, '.w2-bottombar'))], 390, 'between the simulator row and the bottom bar');
  await snap(page, 'phone-bars-simulator-row');
});

test('every control of both bars is a 44 px target with a name', async ({ page }) => {
  await openWorkspace(page);
  for (const selector of ['.w2-topbar', '.w2-bottombar']) {
    for (const box of await controls(page, selector)) {
      if (/^(Saved|Saving…|Not Saved|\d+ Problems?)$/.test(box.name)) continue;
      expect(box.name.length, `a control of ${selector} has no name`).toBeGreaterThan(0);
      expect(box.height, `${box.name} in ${selector}`).toBeGreaterThanOrEqual(43.5);
      expect(box.width, `${box.name} in ${selector}`).toBeGreaterThanOrEqual(43.5);
    }
  }
});

/** In a level the middle button reads "This Level", and the sheet it opens is titled so, with no settings button that names the wrong thing. */
for (const scheme of ['light', 'dark'] as const) for (const where of ['in a sheet', 'alone'] as const) {
  test(`the middle button reads This Level ${where}, and its sheet is titled so (${scheme})`, async ({ page, request }) => {
    await seed(request, documentWithLevels());
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    if (where === 'in a sheet') {
      await page.getByRole('button', { name: 'Use', exact: true }).click();
      await page.locator('[data-sel="node:demo_home_to_sheet"]').first().click();
      await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
      await expect(page.locator('.sh-sheet')).toHaveAttribute('aria-label', 'Demo Level A');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Project', exact: true }).click();
      await page.getByRole('button', { name: 'Checks', exact: true }).click();
      await page.getByRole('button', { name: /Demo Level Alone has no way in/ }).first().click();
      await expect(page.locator('.sh-sheet')).toHaveAttribute('aria-label', 'Demo Level Alone');
    }
    // The alone level arrives selected (from its check) and a level has no inspector, so the bar stays; nothing to clear.
    const middle = page.locator('.w2-bottom-page');
    await expect(middle).toHaveAttribute('aria-label', 'This Level');
    await expect(middle).toHaveText('This Level');
    await middle.click();
    const sheet = page.getByTestId('level-sheet');
    await expect(sheet).toHaveAttribute('aria-label', 'This Level');
    await expect(sheet.getByRole('heading', { name: 'This Level', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Add Here' })).toBeVisible();
    await expect(sheet.locator('.w2-level-settings')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /Settings/ })).toHaveCount(0);
    await snap(page, `level-7-this-level-${where === 'alone' ? 'alone' : 'in-sheet'}-phone-${scheme}`);
  });
}
