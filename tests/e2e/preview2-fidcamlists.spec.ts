import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The simulator draws the camera and the chores (lane `fidcamlists`, task `sim-fidelity`, items 8 and 15): the camera tile on Home and Security and
 * the camera viewer in its sheet show the camera's latest still with the name capsule bottom-left and a Snapshot mark, and no visible hint; the
 * Chores `todo` collection draws a heading and the open tasks of each list the signed-in person may see. It runs on the invented `fidcamlists` story
 * with a made-up picture (`picture=fake`), at the iPhone, the Duo and the iPad, in light and dark. `FID_PHASE=before` only takes the screenshots
 * (to compare an older build); `STUDIO_EVIDENCE_DIR` says where they go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-fidcamlists');
const phase = process.env.FID_PHASE ?? 'after';
const checks = phase !== 'before';
const patient = { timeout: 20_000 };

const viewports = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const schemes = ['dark', 'light'] as const;

test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof viewports[number], scheme: typeof schemes[number], surface: string, ready: string) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&window=${encodeURIComponent(view.window)}&fixture=fidcamlists&picture=fake&mode=use&surface=${surface}`);
  await expect(page.locator(ready).first()).toBeVisible(patient);
  await expect(page.locator('.sh-placeholder')).toHaveCount(0, patient);
  if (checks && ready.includes('sh-cam')) await expect(page.locator('img.sh-cam-still').first()).toBeVisible(patient);
  // Bring the node to the middle of the page, clear of the tab bar, so the screenshot shows it.
  await page.locator(ready).first().evaluate(node => node.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
}
const shot = async (page: Page, item: string, scheme: string, view: typeof viewports[number]) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${phase}-${item}-${scheme}-${view.name}.png`, animations: 'disabled' });
};

/** The still has loaded (the blob decoded to a picture with a size). */
const loaded = (page: Page) => page.locator('img.sh-cam-still').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);

for (const view of viewports) for (const scheme of schemes) {
  for (const [item, surface, id] of [['item8-camera-home', 'page:page-home', 'hc-camera-0-tile'], ['item8-camera-security', 'page:page-security', 'hc-security-hc-camera-0-tile']] as const) {
    test(`item 8: the camera tile on ${item.endsWith('home') ? 'Home' : 'Security'} draws the still, the name capsule and a Snapshot mark (${view.name}, ${scheme})`, async ({ page }) => {
      await open(page, view, scheme, surface, `[data-sel="node:${id}"]`);
      await shot(page, item, scheme, view);
      if (!checks) return;
      const tile = page.locator(`[data-sel="node:${id}"]`);
      expect(await loaded(page)).toBe(true);
      const box = (await tile.locator('.sh-cam-picture').boundingBox())!, name = (await tile.getByTestId('camera-name').boundingBox())!;
      // The capsule sits in the picture's bottom-left corner, as `UKCameraNameView` does.
      expect(name.x - box.x).toBeLessThan(box.width / 4);
      expect(name.y + name.height).toBeGreaterThan(box.y + box.height * 0.75);
      expect(name.y + name.height).toBeLessThanOrEqual(box.y + box.height);
      await expect(tile.getByTestId('camera-state')).toHaveText('Snapshot');
      await expect(tile.getByText('Live')).toHaveCount(0);
      await expect(tile.getByText('Opens the camera')).toBeHidden();
      expect(await tile.locator('button').getAttribute('aria-label')).toBe('Demo Camera camera');
    });
  }

  test(`item 8: the camera sheet draws the still in its viewer (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:hc-camera-0-modal', '[data-sel="node:hc-camera-0-viewer"]');
    await shot(page, 'item8-camera-modal', scheme, view);
    if (!checks) return;
    const viewer = page.locator('[data-sel="node:hc-camera-0-viewer"]');
    expect(await loaded(page)).toBe(true);
    await expect(viewer.getByTestId('camera-name')).toHaveText('Demo Camera');
    await expect(viewer.getByTestId('camera-state')).toHaveText('Snapshot');
    await expect(viewer.locator('.sh-cam-control').first()).toBeVisible();
  });

  test(`item 15: the Chores page draws the provider's sections (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-chores', '[data-sel="node:fid-chores"]');
    await shot(page, 'item15-chores', scheme, view);
    if (!checks) return;
    await expect(page.locator('.sh-todo-section').first()).toBeVisible(patient);
    await expect(page.locator('.sh-todo-section h3')).toHaveText(['Past Due', 'Evening Tasks', 'Alex']);
    await expect(page.locator('.sh-todo-section').first().locator('.sh-todo-row')).toHaveCount(2);
    await expect(page.locator('.sh-todo-row[data-done]')).toHaveCount(1 + 1);
    await expect(page.getByText('Feed the cat')).toHaveCount(0);
    await expect(page.locator('.sh-skel')).toHaveCount(0);
  });
}
