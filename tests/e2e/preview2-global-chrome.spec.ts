import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The preview's global-chrome rules in a browser, frame by frame (`gc-studio-preview`): the tabs where the system puts them, what a page hides, a push from a
 * sheet, and wide open with its cascade. Drives the story page (`fixture=gcprev`, made-up `demo_*` pages) in Use, in light and in dark, and saves a screenshot of
 * each state to `STUDIO_EVIDENCE_DIR` (default `test-results/preview2-global-chrome`).
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-global-chrome');
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'A desktop study');
test.use({ viewport: { width: 1500, height: 1300 }, deviceScaleFactor: 1 });
test.beforeEach(() => { test.slow(); });

const frames = [
  { name: 'iPhone', slug: 'iphone', top: false, wide: false, rail: false },
  { name: 'Duo folded', slug: 'duo-folded', top: false, wide: false, rail: true },
  { name: 'Duo open, upright', slug: 'duo-open-upright', top: false, wide: false, rail: false },
  { name: 'Duo open, sideways', slug: 'duo-open-sideways', top: false, wide: true, rail: true },
  { name: 'iPad upright', slug: 'ipad-portrait', top: true, wide: false, rail: false },
  { name: 'iPad sideways', slug: 'ipad-landscape', top: true, wide: true, rail: false },
] as const;

const host = (page: Page) => page.getByTestId('preview2-host');
const current = (page: Page) => page.locator('.sh-page[data-current]').last();
const tap = (scope: Locator, target: string) => scope.locator(`[data-sel$="_to_${target}"]`).first().click();
const settle = (page: Page) => page.waitForTimeout(900);

for (const scheme of ['light', 'dark'] as const) {
  for (const frame of frames) {
    test(`${frame.name} in ${scheme}: tabs, hides, sheet levels${frame.wide ? ', wide open' : ''}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme });
      const shot = async (state: string) => { await settle(page); await host(page).screenshot({ path: `${evidence}/${frame.slug}-${state}-${scheme}.png`, animations: 'disabled' }); };
      await page.goto(`/?preview2=1&fixture=gcprev&mode=use&panel=0&window=${encodeURIComponent(frame.name)}`);
      await expect(current(page)).toHaveAttribute('data-page', 'page-home', { timeout: 20_000 });
      const screen = page.locator('.sh-screen').first();
      // The vertical bar (the Duo's rail) carries the header buttons and Back or Close; elsewhere they are in the page's header.
      const buttons = () => frame.rail ? page.locator('.sh-rail-bar') : current(page);
      const lead = page.locator('.sh-pane[data-pane=leading]'), detail = page.locator('.sh-pane[data-pane=detail]');
      const leading = (kind: 'back' | 'close') => frame.rail ? page.locator(`.sh-rail-bar button[data-leading=${kind}]`) : page.locator(`.sh-page[data-current] button[data-leading=${kind}]`);
      const goBack = async () => { await leading('back').click(); await settle(page); };
      // The folded Duo's sheet puts Back and Close in the rail under the camera; every other sheet has them in its bar.
      const inSheet = (name: 'Back' | 'Close') => page.locator(`${frame.slug === 'duo-folded' ? '.sh-sheet-rail' : '.sh-sheet'} button[aria-label=${name}]`);
      // The ring must be seen: the pixels around the opening tile change when the marker is taken away. An outline under the tile's fill would leave them the same.
      const ringShows = async () => {
        const node = lead.locator('[data-opened]');
        await expect(node).toHaveCount(1);
        const handle = (await node.elementHandle())!;
        const box = (await handle.boundingBox())!, clip = { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 };
        const marked = await page.screenshot({ clip, animations: 'disabled' });
        await handle.evaluate(element => element.removeAttribute('data-opened'));
        const bare = await page.screenshot({ clip, animations: 'disabled' });
        await handle.evaluate(element => element.setAttribute('data-opened', ''));
        expect(Buffer.compare(marked, bare), 'the selection ring is visible').not.toBe(0);
      };
      const reload = async () => {
        await page.goto(`/?preview2=1&fixture=gcprev&mode=use&panel=0&window=${encodeURIComponent(frame.name)}`);
        await expect(current(page)).toHaveAttribute('data-page', 'page-home', { timeout: 20_000 });
      };

      // The tabs: at the top with no menu button on the iPad, the floating bar or the rail elsewhere.
      await expect(page.locator('.sh-tabbar')).toHaveCount(1);
      if (frame.top) {
        await expect(screen).toHaveAttribute('data-tabs-top', '');
        await expect(page.locator('button[aria-label=Sections], button[aria-label=Menu]')).toHaveCount(0);
        const bar = (await page.locator('.sh-tabbar').boundingBox())!, box = (await screen.boundingBox())!;
        // In the header row: within the first tenth of the window, scaled by the stage's zoom.
        expect(bar.y - box.y).toBeLessThan(box.height * 0.1);
      } else await expect(screen).not.toHaveAttribute('data-tabs-top', '');
      await shot('1-root');

      // A pushed page: the first-page-only button is gone, Back is the chevron alone (on the rail's first item for the Duo's rail frames, with the title alone in the row).
      await tap(current(page), 'demo_plain');
      await settle(page);
      if (frame.wide) await expect(page.locator('.sh-columns')).toHaveCount(0);
      await expect(leading('back')).toHaveText('');
      if (frame.rail) await expect(current(page).locator('.sh-header button')).toHaveCount(0);
      await expect(buttons().locator('button[aria-label=demo_btn_first]')).toHaveCount(0);
      if (!frame.rail) await expect(buttons().locator('button[aria-label=demo_btn_always]')).toHaveCount(1);
      await expect(page.locator('.sh-tabbar')).toHaveCount(1);
      await shot('2-pushed');
      await goBack();

      // A page that hides the tabs and one button: not drawn.
      await tap(current(page), 'demo_hides');
      await settle(page);
      await expect(page.locator('.sh-tabbar')).toHaveCount(0);
      await expect(buttons().locator('button[aria-label=demo_btn_hidden]')).toHaveCount(0);
      await expect(leading('back')).toHaveCount(1);
      await shot('3-hides-tabs-and-a-button');
      await goBack();
      await expect(page.locator('.sh-tabbar')).toHaveCount(1);

      // A sheet, a level (Back and Close), then a push to a page: the sheet and the level close and the page lands on the tab.
      await tap(current(page), 'sheet');
      await settle(page);
      await expect(inSheet('Close')).toHaveCount(1);
      await shot('4-sheet');
      await tap(page.locator('.sh-sheet'), 'demo_level_a');
      await settle(page);
      await expect(page.locator('.sh-sheet')).toHaveAttribute('aria-label', 'Demo Level A');
      await expect(inSheet('Back')).toHaveCount(1);
      await expect(inSheet('Close')).toHaveCount(1);
      await shot('5-sheet-level');
      await tap(page.locator('.sh-sheet'), 'demo_plain');
      await settle(page);
      await expect(page.locator('.sh-sheet')).toHaveCount(0);
      await expect(current(page)).toHaveAttribute('data-page', 'demo_plain');
      await shot('6-sheet-to-page');
      await goBack();
      await expect(current(page)).toHaveAttribute('data-page', 'page-home');

      if (!frame.wide) return;
      // Wide open. A columns page that was pushed shows its empty-side text; Automatic opens beside it (Close: the first page beside the host); the cascade moves it leading
      // and Back leads; the row that opened the trailing pane stays selected; Full width goes over; Beside takes the origin leading.
      await tap(current(page), 'demo_settings');
      await settle(page);
      await expect(lead.locator('.sh-page')).toHaveAttribute('data-page', 'demo_settings');
      await expect(page.locator('.sh-empty-pane')).toHaveText('Pick from Demo Settings');
      await expect(page.locator('[data-opened]')).toHaveCount(0);
      await shot('7-wide-columns-page-empty-side');
      await tap(lead, 'demo_vacation');
      await settle(page);
      await expect(detail.locator('.sh-page')).toHaveAttribute('data-page', 'demo_vacation');
      await expect(leading('close')).toHaveCount(1);
      await ringShows();
      await shot('8-wide-beside-close');
      await tap(detail, 'demo_trip');
      await settle(page);
      await expect(lead.locator('.sh-page')).toHaveAttribute('data-page', 'demo_vacation');
      await expect(detail.locator('.sh-page')).toHaveAttribute('data-page', 'demo_trip');
      await expect(leading('back')).toHaveCount(1);
      await ringShows();
      await shot('9-wide-cascade-back');
      await goBack();
      await expect(detail.locator('.sh-page')).toHaveAttribute('data-page', 'demo_vacation');
      await tap(detail, 'demo_full');
      await settle(page);
      await expect(page.locator('.sh-columns')).toHaveCount(0);
      await expect(current(page)).toHaveAttribute('data-page', 'demo_full');
      await shot('10-wide-full-width');
      await goBack();
      await expect(detail.locator('.sh-page')).toHaveAttribute('data-page', 'demo_vacation');

      await reload();
      await tap(current(page), 'demo_beside');
      await settle(page);
      await expect(lead.locator('.sh-page')).toHaveAttribute('data-page', 'page-home');
      await expect(detail.locator('.sh-page')).toHaveAttribute('data-page', 'demo_beside');
      await expect(leading('close')).toHaveCount(1);
      await ringShows();
      await shot('11-wide-beside-from-home');

      // The owner's case: a columns page that is a tab's first page. Nothing leads, then Close, then Back.
      await reload();
      await page.locator('.sh-tabbar .sh-tab', { hasText: 'Security' }).click();
      await settle(page);
      await expect(lead.locator('.sh-page')).toHaveAttribute('data-page', 'page-security');
      await expect(page.locator('.sh-empty-pane')).toHaveText('Pick from Security');
      await expect(page.locator('button[data-leading]')).toHaveCount(0);
      await shot('12-wide-tab-first-page-empty-side');
      await tap(lead, 'demo_vacation');
      await settle(page);
      await expect(leading('close')).toHaveCount(1);
      await ringShows();
      await shot('13-wide-tab-first-page-close');
      await tap(detail, 'demo_trip');
      await settle(page);
      await expect(leading('back')).toHaveCount(1);
      await ringShows();
      await shot('14-wide-tab-first-page-back');
    });
  }
}
