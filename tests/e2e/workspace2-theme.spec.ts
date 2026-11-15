import { mkdir } from 'node:fs/promises';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { contrast, over, parseColor, textPairs, type Rgb } from '../../src/workspace2/theme';
import { isPhone, seed } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

const evidence = process.env.STUDIO_EVIDENCE_DIR;

/** Home Assistant's default light and dark themes, as variables on its root element. */
const themes = {
  light: '--primary-background-color:#fafafa;--card-background-color:#ffffff;--primary-text-color:#212121;--secondary-text-color:#727272;--divider-color:rgba(0,0,0,.12);--primary-color:#03a9f4;',
  dark: '--primary-background-color:#111111;--card-background-color:#1c1c1c;--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--divider-color:rgba(225,225,225,.12);--primary-color:#03a9f4;',
  /** A custom theme that sets only its primary colour. */
  primaryOnly: '--primary-color:#e91e63;',
} as const;

/** The Studio inside a same-origin frame whose parent document carries Home Assistant's theme variables, as under Ingress. */
async function openInHomeAssistant(page: Page, style: string): Promise<FrameLocator> {
  await page.route('**/ha-host.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html style="${style}"><body style="margin:0"><iframe title="Studio" src="/" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
  }));
  await page.goto('/ha-host.html');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(frame.locator('[data-preview-root]').first()).toBeVisible();
  return frame;
}

/** Reads the chrome's tokens off the framed document's root. */
const tokens = (page: Page) => page.frames().find(frame => frame !== page.mainFrame())!.evaluate(() => {
  const style = document.documentElement.style, result: Record<string, string> = {};
  for (const name of Array.from(style)) if (name.startsWith('--w2-') || name === '--studio-selection') result[name] = style.getPropertyValue(name).trim();
  return result;
});

const colour = (value: string): Rgb => { const parsed = parseColor(value); if (!parsed) throw new Error(`Cannot read ${value}`); return parsed; };

test('a theme that sets only its primary colour recolours the chrome and keeps every text pair readable', async ({ page }) => {
  await openInHomeAssistant(page, themes.primaryOnly);
  const read = await tokens(page);
  expect(colour(read['--w2-primary'])).toMatchObject({ r: 233, g: 30, b: 99 });
  expect(read['--studio-selection']).toBe(read['--w2-primary']);
  for (const [text, ground] of textPairs) {
    const ratio = contrast(colour(read[text]), over(colour(read[ground]), colour(read['--w2-bg'])));
    expect(ratio, `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('the chrome follows a live theme change in the parent, and the preview does not', async ({ page }) => {
  const frame = await openInHomeAssistant(page, themes.light);
  // The device itself: the preview's root also holds the stage around it, which follows the chrome.
  const preview = frame.locator('[data-preview-root] .sh-model').first();
  const box = (await preview.boundingBox())!;
  // Inside the device, clear of its rounded corners (which show the stage behind) and of any sheet.
  const clip = { x: box.x + 16, y: box.y + 40, width: box.width - 32, height: 300 };
  await page.waitForTimeout(1200); // the house reads in and the first frame settles
  const lightPreview = await page.screenshot({ clip, animations: 'disabled' });
  const light = await tokens(page);
  await page.evaluate(style => { document.documentElement.setAttribute('style', style); }, themes.dark);
  await expect.poll(async () => (await tokens(page))['--w2-bg']).not.toBe(light['--w2-bg']);
  const dark = await tokens(page);
  expect(contrast(colour(dark['--w2-ink']), colour(dark['--w2-bg']))).toBeGreaterThanOrEqual(4.5);
  expect(await page.frames().find(frame => frame !== page.mainFrame())!.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
  await page.waitForTimeout(600);
  const darkPreview = await page.screenshot({ clip, animations: 'disabled' });
  expect(darkPreview.equals(lightPreview), 'the preview draws the same pixels in a light and a dark chrome').toBeTruthy();
});

test('evidence: rest, tile selected, Pages, Project menu and Publish, in light and dark Home Assistant themes', async ({ page }) => {
  test.skip(!evidence, 'Set STUDIO_EVIDENCE_DIR to write the screenshots');
  test.setTimeout(180_000);
  await mkdir(evidence!, { recursive: true });
  await page.route('**/native/api/ha/publication', route => route.fulfill({ json: { epoch: 'e2e', current: { revision: 12, publishedAt: '2026-11-14T10:00:00Z', publishedBy: null, envelopeSha256: 'a'.repeat(64), capabilities: [] }, history: [], storedAssets: 0 } }));
  const size = isPhone(page) ? 'phone' : 'desktop';
  for (const name of ['light', 'dark'] as const) {
    const frame = await openInHomeAssistant(page, themes[name]);
    const shot = (what: string) => page.screenshot({ path: `${evidence}/${size}-${name}-${what}.png`, animations: 'disabled' });
    await page.waitForTimeout(500);
    await shot('rest');
    await frame.locator('[data-preview-root]').getByText('Lights', { exact: true }).first().click();
    await page.waitForTimeout(900);
    await shot('tile');
    await frame.getByRole('button', { name: 'Advanced' }).click();
    await page.waitForTimeout(500);
    await shot('advanced');
    await frame.locator('.w2-back').click();
    await frame.getByRole('button', { name: 'Close', exact: true }).first().click();
    await frame.getByRole('button', { name: 'Pages' }).click();
    await page.waitForTimeout(500);
    await shot('pages');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await frame.getByRole('button', { name: 'Project' }).click();
    await page.waitForTimeout(500);
    await shot('project');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await frame.getByRole('button', { name: 'Publish' }).click();
    await page.waitForTimeout(500);
    await shot('publish');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // Use mode: tap the first action tile that is drawn; the call is simulated and the Checks pill says so.
    await frame.getByRole('button', { name: 'Use', exact: true }).click();
    await frame.locator('.sh-tab', { hasText: 'Security' }).click();
    await page.waitForTimeout(600);
    await frame.locator('[data-preview-root] .sh-page[data-current] .sh-node[data-type="action-tile"]').first().click();
    await page.waitForTimeout(400);
    await shot('use');
    await page.unroute('**/ha-host.html');
  }
});
