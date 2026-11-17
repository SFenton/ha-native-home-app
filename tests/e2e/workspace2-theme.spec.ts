import { mkdir } from 'node:fs/promises';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { contrast, over, parseColor, textPairs, type Rgb } from '../../src/workspace2/theme';
import { isPhone, seed, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

const evidence = process.env.STUDIO_EVIDENCE_DIR;
test.use({ actionTimeout: 10_000 });

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

/** The framed document's computed colours: the preview's elements (what must not follow the chrome) and the chrome's own. */
const previewColours = (page: Page) => page.frames().find(frame => frame !== page.mainFrame())!.evaluate(() => [...document.querySelectorAll('[data-preview-root], [data-preview-root] *')].map(element => {
  const style = getComputedStyle(element);
  return [style.color, style.backgroundColor, style.backgroundImage, style.boxShadow, style.outlineColor, style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor, style.fill, style.stroke].join('|');
}));
const chromeColours = (page: Page) => page.frames().find(frame => frame !== page.mainFrame())!.evaluate(() => {
  const root = document.querySelector('.w2-scope')!, style = getComputedStyle(root), bar = getComputedStyle(document.querySelector('.w2-topbar, .w2-bottombar') ?? root);
  return [style.color, style.backgroundColor, bar.backgroundColor, bar.color];
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
  await openInHomeAssistant(page, themes.light);
  // Computed colours, not pixels: a pixel capture depends on the OS's fonts and rasteriser, a computed colour does not.
  // Settled means two reads apart are the same: the house has read in and no transition is still moving.
  const settled = async () => {
    let previous = await previewColours(page), colours = previous;
    await expect.poll(async () => { colours = await previewColours(page); const same = JSON.stringify(colours) === JSON.stringify(previous); previous = colours; return same; }, { timeout: 10_000, intervals: [250] }).toBe(true);
    return colours;
  };
  const lightPreview = await settled();
  expect(lightPreview.length, 'the preview draws something').toBeGreaterThan(10);
  const lightChrome = await chromeColours(page);
  const light = await tokens(page);
  await page.evaluate(style => { document.documentElement.setAttribute('style', style); }, themes.dark);
  await expect.poll(async () => (await tokens(page))['--w2-bg']).not.toBe(light['--w2-bg']);
  const dark = await tokens(page);
  expect(contrast(colour(dark['--w2-ink']), colour(dark['--w2-bg']))).toBeGreaterThanOrEqual(4.5);
  expect(await page.frames().find(frame => frame !== page.mainFrame())!.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
  // The chrome's own computed colours changed with the theme...
  const darkChrome = await chromeColours(page);
  expect(darkChrome, 'the chrome follows the dark theme').not.toEqual(lightChrome);
  // ...and the preview's did not. A leak would persist; a frame still settling (a poll landing, a transition) would not.
  await expect.poll(async () => JSON.stringify(await previewColours(page)) === JSON.stringify(lightPreview), { timeout: 5000, message: 'the preview draws the same colours in a light and a dark chrome' }).toBeTruthy();
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
    await frame.getByRole('button', { name: 'Close', exact: true }).first().click();
    await frame.getByRole('button', { name: 'Pages' }).locator('visible=true').first().click();
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

/** The chrome's card color, read from the root. */
const card = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--w2-card').trim());

test('Studio Appearance: Light and Dark ignore the parent, the preview does not change, and the choice survives a reload with no flash', async ({ page }) => {
  test.skip(isPhone(page), 'The submenu is the wide Project menu; the narrow page is a unit test');
  await page.goto('/');
  await expect(page.locator('[data-preview-root]').first()).toBeVisible();
  const choose = async (name: string) => {
    await page.getByRole('button', { name: 'Project' }).click();
    await page.getByRole('menuitem', { name: /Studio Appearance/ }).click();
    await page.getByRole('menuitemradio', { name }).click();
  };
  await page.getByRole('button', { name: 'Project' }).click();
  await expect(page.getByRole('menuitem', { name: /Studio Appearance/ })).toContainText('Follow System');
  await page.keyboard.press('Escape');
  const preview = page.locator('[data-preview-root]').first();
  const before = await preview.evaluate(element => getComputedStyle(element).backgroundColor + getComputedStyle(element).colorScheme);
  await choose('Light');
  await expect.poll(() => card(page)).toBe('rgb(255 255 255)');
  expect(await page.evaluate(() => localStorage.getItem('sh-studio.appearance'))).toBe('light');
  await choose('Dark');
  await expect.poll(() => card(page)).toBe('rgb(28 28 28)');
  expect(await preview.evaluate(element => getComputedStyle(element).backgroundColor + getComputedStyle(element).colorScheme)).toBe(before);
  // Reload: dark from the first paint.
  await page.reload();
  await expect(page.locator('[data-preview-root]').first()).toBeVisible();
  await expect(page.locator('[data-testid=workspace2]')).toHaveClass(/w2-dark/);
  expect(await card(page)).toBe('rgb(28 28 28)');
  await page.getByRole('button', { name: 'Project' }).click();
  await expect(page.getByRole('menuitem', { name: /Studio Appearance/ })).toContainText('Dark');
  await snap(page, 'desktop-studio-appearance');
});

test('Studio Appearance reads "Follow Home Assistant" inside Home Assistant, and Light ignores its theme', async ({ page }) => {
  test.skip(isPhone(page), 'The wide Project menu');
  const frame = await openInHomeAssistant(page, themes.dark);
  await frame.getByRole('button', { name: 'Project' }).click();
  await expect(frame.getByRole('menuitem', { name: /Studio Appearance/ })).toContainText('Follow Home Assistant');
  await frame.getByRole('menuitem', { name: /Studio Appearance/ }).click();
  await frame.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect.poll(async () => (await tokens(page))['--w2-card']).toBe('rgb(255 255 255)');
});
