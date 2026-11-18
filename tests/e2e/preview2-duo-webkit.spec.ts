import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';
import { documentWith } from './rails-fixture';

/**
 * S1, `sim-blank`: every pose of the Duo draws its screen in WebKit. WebKit paints overlapping 3D planes by DOM order and ignores `backface-visibility`
 * in the rig, which blanked the screen in about half the poses. Runs on demand in the `webkit` project (`STUDIO_E2E_WEBKIT=1 npx playwright test --project=webkit`);
 * it also passes in Chromium, so the CI default keeps Chromium only. Screenshots go to `STUDIO_EVIDENCE_DIR`.
 */
test.beforeEach(async ({ request }) => { await seed(request); });
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'A desktop study');

const sim = (page: Page) => page.getByTestId('simulator-rail');
const press = async (page: Page, name: string) => { await sim(page).getByRole('button', { name, exact: true }).click(); await rigSettled(page); };

/** How many of a grid of points in the screen's box are lit: a blank (black) screen has none. */
async function lit(page: Page) {
  const box = (await previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-screen').first().boundingBox())!;
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, box }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const scale = image.width / window.innerWidth;
    const lumas: number[] = [], halves = [0, 0], wide = box.width >= box.height;
    for (let column = 1; column < 12; column += 1) for (let row = 1; row < 12; row += 1) {
      const [r, g, b] = context.getImageData(Math.round((box.x + box.width * column / 12) * scale), Math.round((box.y + box.height * row / 12) * scale), 1, 1).data;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumas.push(luma);
      if (luma > 24) halves[(wide ? column : row) < 6 ? 0 : 1] += 1;
    }
    return { lit: lumas.filter(value => value > 24).length, total: lumas.length, halves };
  }, { png, box });
}

async function startDuo(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
}

test('every fold at every turn draws its screen', async ({ page }) => {
  await startDuo(page);
  for (const turn of [0, 90, 180, 270]) {
    for (const fold of ['Unfolded', 'Partly Folded', 'Folded']) {
      await press(page, fold);
      const { lit: count, total, halves } = await lit(page);
      await snap(page, `pose-${fold.toLowerCase().replace(' ', '-')}-turn-${turn}`);
      // An open or partly folded screen is drawn across both halves: a half painted over by the other body is blank, with none lit. A half can hold little (6 locally and 2 on a runner at partly folded, turn 180), so one lit point is the line.
      if (fold !== 'Folded') for (const half of halves) expect(half, `${fold} at turn ${turn}: a half is blank (${halves})`).toBeGreaterThanOrEqual(1);
      expect(count, `${fold} at turn ${turn}: ${count} of ${total} points lit`).toBeGreaterThan(total * 0.1);
    }
    await press(page, 'Rotate Right');
  }
});

test('the flat pose draws no ghost of the cover: the back face is not mounted while the Duo is open', async ({ page }) => {
  await startDuo(page);
  await press(page, 'Unfolded');
  await expect(previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer')).toHaveCount(0);
});

/** The folded Duo's live outer face. */
const outer = (page: Page) => previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer');

test.describe('A6, in both engines: choosing a More row with the pointer', () => {
  for (const mode of ['Use', 'Edit'] as const) {
    test(`in ${mode} a pointer click on a row ${mode === 'Use' ? 'runs its action' : 'selects the item'} and closes the menu`, async ({ page, request }) => {
      await seed(request, documentWith(5));
      await openWorkspace(page);
      await page.getByRole('button', { name: mode, exact: true }).first().click();
      await page.getByRole('button', { name: 'Window', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
      await page.keyboard.press('Escape');
      await rigSettled(page);
      await press(page, 'Folded');
      await press(page, 'Rotate Right');
      await expect(previewRoot(page).locator('.sh-rig:not([data-frozen])')).toHaveAttribute('data-turn', '90');
      const more = outer(page).locator('.sh-rail-more');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const row = outer(page).locator('.sh-more-menu [role=menuitem]').first();
      await expect(row).toBeVisible();
      // The menu opens with a short scale; a press during it is not what a person does.
      await expect.poll(() => outer(page).locator('.sh-more-menu').evaluate(menu => menu.getAnimations().length)).toBe(0);
      await row.click();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      if (mode === 'Use') await expect(previewRoot(page).locator('.sh-sheet-layer, [role=dialog]').first()).toBeVisible();
      // The selection is the chosen row's item (the header buttons), not the page it sits on: a press that lands on the layer behind selects the page, "Home".
      else await expect(page.getByLabel('Properties').getByRole('heading').first()).toHaveText('Header Buttons');
    });
  }
});

test.describe('A5: the More menu\'s own animation really runs, in both engines', () => {
  for (const [motion, name] of [['no-preference', 'sh-rail-menu-in'], ['reduce', 'sh-rail-menu-fade']] as const) {
    test(`with ${motion === 'reduce' ? 'Reduce Motion' : 'motion'} the menu opens with ${name}`, async ({ page, request }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await seed(request, documentWith(5));
      await openWorkspace(page);
      await page.getByRole('button', { name: 'Use', exact: true }).first().click();
      await page.getByRole('button', { name: 'Window', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
      await page.keyboard.press('Escape');
      await rigSettled(page);
      await press(page, 'Folded');
      await press(page, 'Rotate Right');
      // `animationstart` fires only for an animation that runs: a name in a computed style is reported even when its keyframes do not exist.
      await page.evaluate(() => { (window as unknown as { __a: string[] }).__a = []; document.addEventListener('animationstart', event => (window as unknown as { __a: string[] }).__a.push((event as AnimationEvent).animationName), true); });
      await outer(page).locator('.sh-rail-more').click();
      await expect(outer(page).locator('.sh-more-menu')).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __a: string[] }).__a)).toContain(name);
    });
  }
});
