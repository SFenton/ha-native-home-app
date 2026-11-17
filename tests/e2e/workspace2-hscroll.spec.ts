import { expect, test, type Locator, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, seed } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

/** The status chip row of the Home page of the `home-domains` fixture: six chips, wider than the window. */
const rail = (page: Page) => previewRoot(page).locator('.sh-rail').first();
const scrollLeft = (row: Locator) => row.evaluate(element => element.scrollLeft);
/** The row's scroll bar thumb on screen, as the browser lays it out: where to grab it and how it is sized. */
async function thumb(row: Locator) {
  const handle = row.locator('xpath=..').getByRole('scrollbar');
  await expect(handle).toBeVisible();
  // The preview settles for a moment after it loads (the house, the fit); grab the thumb once it holds still.
  let box = (await handle.boundingBox())!;
  for (let tries = 0; tries < 20; tries += 1) {
    await handle.page().waitForTimeout(100);
    const next = (await handle.boundingBox())!;
    const still = Math.abs(next.x - box.x) < .5 && Math.abs(next.y - box.y) < .5 && Math.abs(next.width - box.width) < .5;
    box = next;
    if (still) break;
  }
  return { handle, box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a row that scrolls sideways shows a thin scroll bar in Edit and none in Use', async ({ page }) => {
  await openWorkspace(page);
  const row = rail(page);
  expect(await row.evaluate(element => element.scrollWidth > element.clientWidth), 'the chips overflow the window').toBe(true);
  const { box } = await thumb(row);
  expect(box.height, 'a thin bar').toBeLessThan(10);
  expect(box.width, 'a thumb narrower than its track').toBeLessThan((await row.boundingBox())!.width);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await expect(previewRoot(page)).toHaveAttribute('data-mode', 'use');
  await expect(row.locator('xpath=..').getByRole('scrollbar'), 'Use keeps the app look: no bar').toHaveCount(0);
});

test('in Edit the row scrolls with Shift and the wheel, and with a trackpad swipe', async ({ page }) => {
  await openWorkspace(page);
  const row = rail(page), box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect.poll(() => scrollLeft(row)).toBeGreaterThan(20);
  const before = await scrollLeft(row);
  await page.mouse.wheel(60, 0);
  await expect.poll(() => scrollLeft(row)).toBeGreaterThan(before);
});

test('in Edit dragging the scroll bar moves the row, and a press on the track pages it', async ({ page }) => {
  await openWorkspace(page);
  const row = rail(page), grip = await thumb(row);
  const selected = () => previewRoot(page).locator('[data-selected]').evaluateAll(items => items.map(item => item.getAttribute('data-sel')));
  const selection = await selected();
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 40, grip.y, { steps: 6 });
  await page.mouse.up();
  const dragged = await scrollLeft(row);
  expect(dragged, 'the thumb moved the row').toBeGreaterThan(10);
  expect(await row.evaluate(element => element.scrollLeft / (element.scrollWidth - element.clientWidth)), 'by the share the thumb travelled').toBeGreaterThan(.1);
  expect(await selected(), 'dragging the bar selects nothing').toEqual(selection);
  const track = (await row.locator('xpath=..').locator('.sh-hbar').boundingBox())!;
  await page.mouse.click(track.x + track.width - 2, track.y + track.height / 2);
  await expect.poll(() => scrollLeft(row)).toBeGreaterThan(dragged + 30);
  expect(await selected(), 'nor does a press on the track').toEqual(selection);
});

test('a chip inside a scrolled row still selects, and the row keeps its place', async ({ page }) => {
  await openWorkspace(page);
  const row = rail(page);
  await row.evaluate(element => { element.scrollLeft = 120; });
  const chip = row.locator('.sh-node').last();
  await chip.click();
  await expect(chip).toHaveAttribute('data-selected', '');
  expect(await scrollLeft(row)).toBeGreaterThan(60);
});
