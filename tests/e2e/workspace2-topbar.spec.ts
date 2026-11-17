import { expect, test } from '@playwright/test';
import { isPhone, openWorkspace, seed } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

/** The wide top bar (Studio spec Rule 2): three groups in a grid, nothing placed over another, words that shorten as it narrows. */
for (const width of [871, 880, 940, 1000, 1440]) {
  test(`no two top-bar controls intersect at ${width} px, and the words shorten on schedule`, async ({ page }) => {
    test.skip(isPhone(page), 'The wide bar is a desktop layout');
    await page.setViewportSize({ width, height: 700 });
    await openWorkspace(page);
    const bar = page.locator('.w2-topbar');
    const boxes = await bar.evaluate(element => [...element.querySelectorAll<HTMLElement>('button, [role=status], .w2-wordmark')].map(item => {
      const box = item.getBoundingClientRect();
      return { name: item.getAttribute('aria-label') ?? item.textContent?.trim() ?? item.tagName, left: box.left, right: box.right, top: box.top, bottom: box.bottom, shown: box.width > 0 && box.height > 0 };
    }).filter(item => item.shown));
    expect(boxes.length).toBeGreaterThan(6);
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        const apart = a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
        expect(apart, `${a.name} and ${b.name} overlap at ${width} px`).toBe(true);
      }
      expect(a.left, `${a.name} leaves the window at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(a.right, `${a.name} leaves the window at ${width} px`).toBeLessThanOrEqual(width);
    }
    await expect(bar.getByTestId('status-tag')).toHaveText(width < 1000 ? 'Saved' : 'Draft · Saved');
    await expect(bar.locator('.w2-wordmark')).toHaveText(width < 940 ? 'S+H' : 'S+H Studio');
  });
}

/** The flyout widths (600 to 870): the page button left the bar for the rail, and under 720 the wordmark gives way and the device menu is a glyph. */
for (const width of [600, 669, 719, 720, 820]) {
  test(`no two top-bar controls intersect at ${width} px; the wordmark and the device name give way under 720`, async ({ page }) => {
    test.skip(isPhone(page), 'The flyout widths are a desktop-project check');
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page);
    const bar = page.locator('.w2-topbar');
    const boxes = await bar.evaluate(element => [...element.querySelectorAll<HTMLElement>('button, [role=status], .w2-wordmark')].map(item => {
      const box = item.getBoundingClientRect();
      return { name: item.getAttribute('aria-label') ?? item.textContent?.trim() ?? item.tagName, left: box.left, right: box.right, top: box.top, bottom: box.bottom, shown: box.width > 0 && box.height > 0 };
    }).filter(item => item.shown));
    expect(boxes.length).toBeGreaterThan(5);
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        const apart = a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
        expect(apart, `${a.name} and ${b.name} overlap at ${width} px`).toBe(true);
      }
      expect(a.left, `${a.name} leaves the window at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(a.right, `${a.name} leaves the window at ${width} px`).toBeLessThanOrEqual(width);
    }
    await expect(bar.getByRole('button', { name: 'Pages' })).toHaveCount(0);
    if (width < 720) {
      await expect(bar.locator('.w2-wordmark')).toHaveCount(0);
      await expect(bar.getByRole('button', { name: /^Window, iPhone$/ })).toHaveText('');
    } else {
      await expect(bar.locator('.w2-wordmark')).toHaveText('S+H');
      await expect(bar.getByRole('button', { name: 'Window', exact: true })).toHaveText('iPhone');
    }
  });
}
