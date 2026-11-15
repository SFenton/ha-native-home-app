import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: object };

/** Optional folder for evidence screenshots (a phase deliverable). */
const evidence = process.env.STUDIO_EVIDENCE_DIR;

/** Replaces the server's draft with the `home-domains` fixture so every test starts from the same project. */
export async function seed(request: APIRequestContext, document: unknown = fixture.document): Promise<void> {
  const current = await (await request.get('/native/api/draft')).json();
  const put = await request.put('/native/api/draft', { data: { document: { ...(document as object), id: current.document.id }, expectedRevision: current.revision } });
  expect(put.ok(), await put.text()).toBeTruthy();
}

/** The preview's own root. When the renderer merges its root keeps `data-preview-root`; only this helper knows how to find a tile. */
export const previewRoot = (page: Page) => page.locator('[data-preview-root]').first();
/** A tile, section or title drawn in the preview, found by its text. */
export const previewTile = (page: Page, title: string) => previewRoot(page).getByText(title, { exact: true }).first();

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 700;

/** Every Studio control that is on screen, outside the preview. */
export async function visibleControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = 'button, [role=button], [role=switch], [role=menuitem], [role=menuitemradio], input:not([type=hidden]), select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';
    const root = document.querySelector('[data-testid=workspace2]');
    const names: string[] = [];
    for (const element of root?.querySelectorAll<HTMLElement>(selector) ?? []) {
      if (element.closest('[data-preview-root]') || element.closest('[hidden]') || element.closest('[inert]')) continue;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
      names.push(element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName);
    }
    return names;
  });
}

/** Saves a screenshot under the evidence folder when one is configured. */
export async function snap(page: Page, name: string): Promise<void> {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
}

/** The text a person can read now: the page and every open overlay, plus accessible names. */
export async function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label')).join('\n');
    const values = [...document.querySelectorAll<HTMLInputElement>('input:not([type=hidden])')].map(input => `${input.placeholder ?? ''}`).join('\n');
    return `${document.body.innerText}\n${labels}\n${values}`;
  });
}

/** Opens the workspace at `/` and waits for the draft. */
export async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(previewRoot(page)).toBeVisible();
}

/** Selects a tile by clicking it in the preview. */
export async function selectTile(page: Page, title: string): Promise<Locator> {
  await previewTile(page, title).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}
