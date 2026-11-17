import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, seed, snap } from './workspace2-helpers';

/**
 * The display dial's text place (`sh.dial-text-place@1`): the inspector shows a "Text place" group with "Text centre down the height" and "Then down by", and the
 * preview moves the lines in the middle when they are set. The dial is invented (a value and a unit in the middle). The Studio takes its light or dark chrome from
 * Home Assistant's theme variables on the parent document, as under Ingress, so each scheme is the Studio in a frame whose parent carries those variables.
 * Captures go to `STUDIO_EVIDENCE_DIR`.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; components: unknown[] }[] } };
const themes = {
  light: '--primary-background-color:#fafafa;--card-background-color:#ffffff;--primary-text-color:#212121;--secondary-text-color:#727272;--divider-color:rgba(0,0,0,.12);--primary-color:#03a9f4;',
  dark: '--primary-background-color:#111111;--card-background-color:#1c1c1c;--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--divider-color:rgba(225,225,225,.12);--primary-color:#03a9f4;',
} as const;
const lit = (value: string) => ({ type: 'literal', value });
const ink = (alpha: number) => ({ type: 'rgba', red: 255, green: 255, blue: 255, alpha });
/** A neutral dial with a value and a unit in the middle, alone on the Home page. */
function document() {
  const copy = structuredClone(fixture.document);
  const dial = {
    id: 'pr8-dial', title: 'Level', type: 'dial', layout: { span: 1 },
    props: {
      sweep: { start: 145, length: 250 }, aspect: 1.4, centerY: 0.56, maxWidth: 220,
      ticks: { count: 49, inner: 0.78, outer: 0.92, width: 1.4, ink: ink(0.5) },
      pointer: { kind: 'tick', value: lit('0.5'), inner: 0.7, outer: 0.98, width: 3, ink: { type: 'solid-rgb', red: 255, green: 159, blue: 10 } },
      center: [{ value: lit('1013'), style: 'title3', unavailableText: '-', ink: ink(0.9) }, { value: lit('hPa'), style: 'caption1', unavailableText: '-', ink: ink(0.6) }],
    },
    a11y: { element: 'hidden' },
  };
  (dial.props.pointer as { value: unknown }).value = { type: 'literal', value: 0.5 };
  copy.pages.find(page => page.id === 'page-home')!.components = [dial];
  return copy;
}

test.beforeEach(async ({ request, page }) => {
  test.skip(isPhone(page), 'The captures are the desktop workspace.');
  await seed(request, document());
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Text place rows move the middle text of a dial in the ${scheme} Studio`, async ({ page }: { page: Page }) => {
    await page.route('**/ha-host.html', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html style="${themes[scheme]}"><body style="margin:0"><iframe title="Studio" src="/" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
    }));
    await page.goto('/ha-host.html');
    const studio = page.frameLocator('iframe');
    await expect(studio.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 45_000 });
    const root = studio.locator('[data-preview-root]').first();
    await root.locator('.sh-dial').first().click();
    const panel = studio.getByLabel('Properties');
    await expect(panel.getByRole('heading', { name: 'Level' })).toBeVisible();
    const centre = root.locator('.sh-dial-center').first();
    await expect(centre).toContainText('1013');
    const before = await centre.evaluate(element => (element as HTMLElement).style.top);
    await panel.getByText('Text place', { exact: true }).click();
    for (const label of ['Text centre down the height', 'Then down by']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
    await panel.getByText('Then down by', { exact: true }).scrollIntoViewIfNeeded();
    await snap(page, `text-place-before-${scheme}`);
    await panel.getByText('Then down by', { exact: true }).click();
    const field = panel.getByLabel('Then down by').first();
    await field.fill('12');
    await field.blur();
    await expect.poll(() => centre.evaluate(element => (element as HTMLElement).style.top)).not.toBe(before);
    expect(parseFloat(await centre.evaluate(element => (element as HTMLElement).style.top)) - parseFloat(before)).toBeCloseTo(12, 0);
    await field.scrollIntoViewIfNeeded();
    await snap(page, `text-place-after-${scheme}`);
  });
}
