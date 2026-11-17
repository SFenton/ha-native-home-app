import { expect, test, type Page } from '@playwright/test';
import { openLibrary, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * The Use marker (studio-ux2 lib3, L-mark): a row clicked in the library stays selected when the mode switches to Use, and the
 * simulator marks that element with corner marks and a name tag, never the Edit ring and handle, and never in the way of a tap.
 */
test.beforeEach(async ({ request }, testInfo) => { testInfo.skip(testInfo.project.name === 'phone', 'The library is the wide layout; a phone has sheets'); await seed(request); });

const viewports = [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'iPad sideways 1180', width: 1180, height: 820 },
  { name: 'Duo sideways 951', width: 951, height: 669 },
  { name: 'iPad upright 820', width: 820, height: 1180 },
  { name: 'Duo upright 669', width: 669, height: 951 },
] as const;
const tree = (page: Page) => page.getByTestId('library-tree');
const rowOf = (page: Page, name: string) => tree(page).locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
const use = (page: Page) => page.getByRole('button', { name: 'Use', exact: true });
const edit = (page: Page) => page.getByRole('button', { name: 'Edit', exact: true });
const marked = (page: Page) => previewRoot(page).locator('[data-marked]');

/** Selects "Cameras" from the library (Tabs, Home, Cameras) and switches to Use. */
async function markCameras(page: Page) {
  await openWorkspace(page);
  await openLibrary(page, 'Tabs');
  await rowOf(page, 'Home').click();
  await rowOf(page, 'Cameras').click();
  await use(page).click();
  await expect(marked(page)).toHaveCount(1);
}

for (const view of viewports) {
  test.describe(view.name, () => {
    test.use({ viewport: { width: view.width, height: view.height } });

    test('the element a row selected is marked in Use: corner marks 7 px out, a name tag on its top edge, no Edit ring or handle', async ({ page }) => {
      await markCameras(page);
      const element = marked(page);
      await expect(element.locator(':scope > .sh-use-tag')).toHaveText('Cameras');
      // Measured once the marks have settled.
      await element.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)));
      const look = await element.evaluate(node => {
        const after = getComputedStyle(node, '::after'), tag = node.querySelector<HTMLElement>(':scope > .sh-use-tag')!, screen = node.closest('.sh-screen')!.getBoundingClientRect(), box = node.getBoundingClientRect(), tagBox = tag.getBoundingClientRect();
        return {
          selected: node.hasAttribute('data-selected'), handle: node.querySelector('.sh-handle-slot') !== null,
          top: after.top, left: after.left, color: after.borderTopColor, width: after.borderTopWidth, pointer: after.pointerEvents, tagPointer: getComputedStyle(tag).pointerEvents,
          tagLeft: tagBox.left - box.left, tagInside: tagBox.left >= screen.left - 1 && tagBox.right <= screen.right + 1 && tagBox.top >= screen.top - 1 && tagBox.bottom <= screen.bottom + 1,
          hidden: tag.getAttribute('aria-hidden'), ink: getComputedStyle(tag).color, fill: getComputedStyle(tag).backgroundColor,
        };
      });
      expect(look).toMatchObject({ selected: false, handle: false, top: '-7px', left: '-7px', color: 'rgb(255, 255, 255)', pointer: 'none', tagPointer: 'none', hidden: 'true' });
      expect(['2px', '2.5px']).toContain(look.width);
      expect(look.tagInside).toBe(true);
      expect(look.ink).toBe('rgb(27, 27, 29)');
      expect(look.fill).toBe('rgba(250, 250, 250, 0.96)');
      await expect(page.locator('.sh-use-status')).toHaveText('Showing Cameras in the simulator.');
      await snap(page, `lmark-use-${view.width}`);
    });

    test('Edit turns the marker into the selection and back, and Close ends it', async ({ page }) => {
      await markCameras(page);
      await edit(page).click();
      await expect(previewRoot(page).locator('[data-selected]').first()).toBeVisible();
      await expect(marked(page)).toHaveCount(0);
      await use(page).click();
      await expect(marked(page)).toHaveCount(1);
      // Where the library and the inspector cannot both show, the library keeps the window and there is no Close to press.
      const properties = page.getByLabel('Properties');
      if (await properties.count() === 0) return;
      await properties.getByRole('button', { name: 'Close' }).click();
      await expect(marked(page)).toHaveCount(0);
    });

    test('a tap on the marked element reaches the app, and a tap in the simulator in Use never selects', async ({ page }) => {
      await markCameras(page);
      const element = marked(page);
      const reaches = await element.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12); return hit !== null && node.contains(hit) && !hit.closest('.sh-use-tag'); });
      expect(reaches).toBe(true);
      await element.click({ position: { x: 20, y: 12 } });
      await expect(marked(page)).toHaveCount(1);
      await expect(previewRoot(page).locator('[data-selected]')).toHaveCount(0);
    });

    test('a field changed in the inspector in Use shows in the simulator, and Move, Duplicate and Delete stay out of reach', async ({ page }) => {
      await markCameras(page);
      const properties = page.getByLabel('Properties');
      if (await properties.count() === 0) test.skip(true, 'The inspector and the library do not share this width');
      await expect(properties.getByRole('button', { name: 'More' })).toBeDisabled();
      const title = properties.getByRole('textbox').first();
      await title.fill('Cameras Renamed');
      await expect(marked(page).locator(':scope > .sh-use-tag')).toHaveText('Cameras Renamed');
    });

    test('Reduce Motion swaps the settle for a fade', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await markCameras(page);
      const names = await marked(page).evaluate(node => getComputedStyle(node, '::after').animationName);
      expect(names).toBe('sh-mark-fade');
    });
  });
}

test('the marker settles from 8 px further out over 250 ms, once', async ({ page }) => {
  await markCameras(page);
  const motion = await marked(page).evaluate(node => { const style = getComputedStyle(node, '::after'); return { name: style.animationName, duration: style.animationDuration, count: style.animationIterationCount }; });
  expect(motion).toEqual({ name: 'sh-mark-in', duration: '0.25s', count: '1' });
});

test('a marked element is brought into view', async ({ page }) => {
  await page.setViewportSize({ width: 951, height: 669 });
  await markCameras(page);
  await expect(async () => {
    const fits = await marked(page).evaluate(node => { const box = node.getBoundingClientRect(), screen = node.closest('.sh-screen')!.getBoundingClientRect(); return box.bottom > screen.top && box.top < screen.bottom; });
    expect(fits).toBe(true);
  }).toPass();
});
