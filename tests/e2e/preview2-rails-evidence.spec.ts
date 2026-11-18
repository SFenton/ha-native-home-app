import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';
import { documentWith, literalBadge } from './rails-fixture';

/**
 * Evidence for `studio-sim-rails`: a screenshot of every pose (fold x turn), of the folded rail with 3, 4 and 5 tabs at every turn, of the More menu
 * open, of a hold, and of the profile stand-in. It asserts only what the shots need to be true (More at 5 tabs on a quarter turn, none at 3 and 4).
 * Screenshots go to `STUDIO_EVIDENCE_DIR`; it runs in the `webkit` project as well as Chromium.
 */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'A desktop study');
test.skip(!process.env.STUDIO_EVIDENCE_DIR, 'Evidence only: it shoots screenshots and asserts little; set STUDIO_EVIDENCE_DIR to run it');

const sim = (page: Page) => page.getByTestId('simulator-rail');
const press = async (page: Page, name: string) => { await sim(page).getByRole('button', { name, exact: true }).click(); await rigSettled(page); };
async function startDuo(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
}
const live = (page: Page) => previewRoot(page).locator('.sh-rig:not([data-frozen])');

test('every pose: fold x turn', async ({ page, request }) => {
  await seed(request, documentWith(5));
  await startDuo(page);
  for (const turn of [0, 90, 180, 270]) {
    for (const fold of ['Unfolded', 'Partly Folded', 'Folded']) { await press(page, fold); await snap(page, `pose-${fold.toLowerCase().replace(' ', '-')}-turn-${turn}`); }
    await press(page, 'Rotate Right');
  }
});

for (const count of [3, 4, 5]) {
  test(`the folded rail with ${count} tabs at every turn`, async ({ page, request }) => {
    await seed(request, documentWith(count));
    await startDuo(page);
    await press(page, 'Folded');
    for (const turn of [0, 90, 180, 270]) {
      const more = await live(page).locator('.sh-rail-more').count();
      // The fit: More appears at 5 tabs on a quarter turn only.
      expect(more, `${count} tabs at turn ${turn}`).toBe(count === 5 && turn % 180 === 90 ? 1 : 0);
      await snap(page, `rail-${count}-tabs-turn-${turn}`);
      await press(page, 'Rotate Right');
    }
  });
}

test('the More menu open, the hold and the profile stand-in', async ({ page, request }) => {
  await seed(request, documentWith(5));
  await startDuo(page);
  await press(page, 'Folded');
  await snap(page, 'profile-stand-in-turn-0');
  await press(page, 'Rotate Right');
  await live(page).locator('.sh-rail-more').click();
  await expect(live(page).locator('.sh-more-menu [role=menuitem]')).toHaveCount(2);
  await page.waitForTimeout(700);
  await snap(page, 'more-menu-turn-90');
  await page.keyboard.press('Escape');
  await press(page, 'Rotate Right');
  await press(page, 'Rotate Right');
  await live(page).locator('.sh-rail-more').click();
  await page.waitForTimeout(700);
  await snap(page, 'more-menu-turn-270');
  await page.keyboard.press('Escape');
  await press(page, 'Rotate Right');
  await expect(live(page)).toHaveAttribute('data-turn', '0');
  await expect(live(page).locator('.sh-rail-more')).toHaveCount(0);
  const tab = live(page).locator('.sh-outer .sh-tabbar .sh-tab').first(), box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(live(page).locator('.sh-outer .sh-tabbar')).toHaveAttribute('data-hold', '');
  await page.waitForTimeout(700);
  await snap(page, 'hold-turn-0');
  await page.mouse.up();
});

/** Holds the first tab of the folded rail and shoots the held pill at the current turn. */
async function holdAndShoot(page: Page, name: string) {
  const tab = live(page).locator('.sh-outer .sh-tabbar .sh-tab').first();
  await expect(tab).toBeVisible();
  const box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(live(page).locator('.sh-outer .sh-tabbar')).toHaveAttribute('data-hold', '');
  await page.waitForTimeout(700);
  await snap(page, name);
  await page.mouse.up();
}

test('the hold at turns 90 and 270, and under Reduce Motion', async ({ page, request }) => {
  await seed(request, documentWith(3));
  await startDuo(page);
  await press(page, 'Folded');
  await press(page, 'Rotate Right');
  await expect(live(page)).toHaveAttribute('data-turn', '90');
  await holdAndShoot(page, 'hold-turn-90');
  await press(page, 'Rotate Right'); await press(page, 'Rotate Right');
  await expect(live(page)).toHaveAttribute('data-turn', '270');
  await holdAndShoot(page, 'hold-turn-270');
  await press(page, 'Rotate Right');
  await expect(live(page)).toHaveAttribute('data-turn', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rigSettled(page);
  await expect(live(page).locator('.sh-outer .sh-tabbar .sh-tab').first()).toBeVisible();
  await holdAndShoot(page, 'hold-reduce-motion-turn-0');
});

test('the iPhone bar held', async ({ page, request }) => {
  await seed(request, documentWith(3));
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
  const tab = previewRoot(page).locator('.sh-tabbar .sh-tab').first(), box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(previewRoot(page).locator('.sh-tabbar')).toHaveAttribute('data-hold', '');
  await page.waitForTimeout(700);
  await snap(page, 'hold-iphone-bar');
  await page.mouse.up();
});

test('the profile stand-in with an authored badge', async ({ page, request }) => {
  await seed(request, documentWith(3, literalBadge(3)));
  await startDuo(page);
  await press(page, 'Folded');
  await expect(live(page).locator('.sh-outer [data-testid=badge]')).toHaveCount(1);
  await snap(page, 'profile-stand-in-badge-turn-0');
});

test('the profile stand-in with a "9+" badge', async ({ page, request }) => {
  await seed(request, documentWith(3, literalBadge('9+')));
  await startDuo(page);
  await press(page, 'Folded');
  await expect(live(page).locator('.sh-outer [data-testid=badge]')).toHaveText('9+');
  await snap(page, 'profile-stand-in-badge-9plus-turn-0');
});
