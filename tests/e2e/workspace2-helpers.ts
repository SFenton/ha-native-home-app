import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: object };

/** Optional folder for evidence screenshots (a phase deliverable). */
const evidence = process.env.STUDIO_EVIDENCE_DIR;

/**
 * Replaces the server's draft with the `home-domains` fixture so every test starts from the same project.
 * The previous test's page may still have an autosave in flight that lands between the read and the write and moves the
 * revision, so a conflict (409) is read again and retried; the write only counts once the revision has held still.
 */
export async function seed(request: APIRequestContext, document: unknown = fixture.document): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await (await request.get('/native/api/draft')).json();
    const put = await request.put('/native/api/draft', { data: { document: { ...(document as object), id: current.document.id }, expectedRevision: current.revision } });
    if (put.ok()) {
      // A save from the page that just closed may still land after this write: wait for the revision to hold, and write again if it moved.
      await new Promise(resolve => setTimeout(resolve, 150));
      const after = await (await request.get('/native/api/draft')).json();
      if (after.revision === current.revision + 1) return;
      last = `the revision moved from ${current.revision + 1} to ${after.revision} after the seed`;
      continue;
    }
    last = await put.text();
    if (put.status() !== 409) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`The draft could not be seeded: ${last}`);
}

/** The preview's own root. When the renderer merges its root keeps `data-preview-root`; only this helper knows how to find a tile. */
export const previewRoot = (page: Page) => page.locator('[data-preview-root]').first();
/**
 * A tile, section or title drawn in the preview, found by its text, or by its accessible name when the node draws its own words
 * instead (the weather summary shows the forecast and keeps its title for VoiceOver).
 */
export const previewTile = (page: Page, title: string) => previewRoot(page).getByText(title, { exact: true }).or(previewRoot(page).getByLabel(title, { exact: true })).first();

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 700;

/** Every Studio control that is on screen, outside the preview. */
export async function visibleControls(page: Page, includeLibrary = false): Promise<string[]> {
  return page.evaluate(includeLibrary => {
    const selector = 'button, [role=button], [role=switch], [role=menuitem], [role=menuitemradio], input:not([type=hidden]), select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';
    const root = document.querySelector('[data-testid=workspace2]');
    const names: string[] = [];
    for (const element of root?.querySelectorAll<HTMLElement>(selector) ?? []) {
      if (element.closest('[data-preview-root]') || element.closest('[hidden]') || element.closest('[inert]')) continue;
      if (!includeLibrary && element.closest('.w2-lib')) continue;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
      names.push(element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName);
    }
    return names;
  }, includeLibrary);
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

/**
 * How long the app may take to boot: `index.html`, then the lazily loaded workspace chunk and the draft it fetches, which a development
 * server transforms on demand and a loaded runner serves slowly. The wait is for the app itself (its Publish button exists only once the
 * draft has arrived), so a quick boot returns at once; this is the budget for a slow one, not a pause. `warm-up.ts` has already paid
 * for the server's first transform of the app before any test starts.
 */
const BOOT = 30_000;

/** Opens the workspace at `/` and waits for the draft. */
export async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: BOOT });
  await expect(previewRoot(page)).toBeVisible({ timeout: BOOT });
}

/** Selects a tile by clicking it in the preview. */
export async function selectTile(page: Page, title: string): Promise<Locator> {
  await previewTile(page, title).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}

/** The library rail's button for a category (Pages, Modals, Components, Controls); wide windows only. */
export const railButton = (page: Page, name: string) => page.getByTestId('library-rail').getByRole('button', { name, exact: true });

/** The rail items that list surfaces, in rail order. */
const surfaceCategories = ['Tabs', 'Pages', 'Sheets', 'Modals'];
/** The top-level rows of the library's lists, named by title. */
const surfaceRow = (page: Page, title: string) => page.locator('.w2-pages [role=treeitem][aria-level="1"]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

/**
 * Opens the pages list: the library on a window wider than a phone, the Pages sheet on a phone. In the library `where` is a rail item
 * ("Pages") or the title of a page or sheet, whose list is found by looking through Tabs, Pages, Sheets and Modals; with none it is Tabs.
 */
export async function openPagesList(page: Page, where?: string): Promise<Locator> {
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Pages', exact: true }).first().click();
    // The sheet's four-part segment picks the list; a title is looked for through them.
    const scope = page.locator('.w2-pages-scope');
    await expect(scope).toBeVisible();
    if (where && surfaceCategories.includes(where)) await scope.getByRole('button', { name: where, exact: true }).click();
    else if (where) {
      const row = () => page.locator('.w2-pages .w2-page-row').filter({ has: page.locator('.w2-page-title', { hasText: new RegExp(`^${where.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
      for (const category of surfaceCategories) {
        if (await row().count()) break;
        await scope.getByRole('button', { name: category, exact: true }).click();
      }
    }
  } else if (where && surfaceCategories.includes(where)) await openLibrary(page, where);
  else if (where) {
    for (const category of surfaceCategories) {
      await openLibrary(page, category);
      await expect(page.locator('.w2-pages')).toBeVisible();
      if (await surfaceRow(page, where).count()) break;
    }
  } else await openLibrary(page, 'Tabs');
  const list = page.locator('.w2-pages');
  await expect(list).toBeVisible();
  // A list remembers the level it was left on; the helpers want its root, where the surfaces are.
  const path = list.getByRole('navigation', { name: 'Path' });
  if (!isPhone(page) && await path.count()) { await path.getByRole('button').first().click(); await expect(path).toHaveCount(0); }
  return list;
}

/** Closes the pages list again. */
export async function closePagesList(page: Page): Promise<void> {
  if (isPhone(page)) await page.keyboard.press('Escape');
  else { const open = page.getByTestId('library-rail').locator('[aria-pressed=true]'); if (await open.count()) await open.click(); }
  await expect(page.locator('.w2-pages')).toHaveCount(0);
}

/** Expects the preview to be on the named page: the page button on a phone, the row of the library that is on show elsewhere. */
export async function expectOnPage(page: Page, title: string): Promise<void> {
  if (isPhone(page)) { await expect(page.getByRole('button', { name: 'Pages', exact: true }).first()).toContainText(title); return; }
  for (const category of surfaceCategories.slice(0, 3)) {
    await openLibrary(page, category);
    const here = page.locator('.w2-pages [role=treeitem][aria-current=page][aria-level="1"] .w2-tree-title');
    if (await here.count()) { await expect(here.first()).toHaveText(title); return; }
  }
  throw new Error(`No row of the library is the page on show (${title})`);
}

/** Opens the library on a category, leaving it open when it already shows that one. */
export async function openLibrary(page: Page, name: string): Promise<void> {
  if ((await railButton(page, name).getAttribute('aria-pressed')) !== 'true') await railButton(page, name).click();
  await expect(railButton(page, name)).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Opens Checks from the bar: on a phone the status line is not a button, so it is Project's first row ("Checks · 2 Problems" or "Checks · Not Saved");
 * elsewhere it is the status tag.
 */
export async function openChecksFromBar(page: Page): Promise<void> {
  if (!isPhone(page)) { await page.getByTestId('status-tag').click(); return; }
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Checks/ }).click();
}

/**
 * Waits for the preview to come to rest: no display held for a move still running, and the stage's fit no longer changing (a rig that
 * just mounted still tweens the stage's zoom). A rig at rest shows one copy of the screen (two when partly folded), so a test that finds
 * a tile by its text reads it only after this.
 */
export async function rigSettled(page: Page): Promise<void> {
  await expect(page.locator('.sh-rig[data-settling], .sh-rig-slot[data-leaving]')).toHaveCount(0, { timeout: 5000 });
  const read = () => page.evaluate(() => [...document.querySelectorAll('[data-preview-root] .sh-screen')].slice(0, 1).map(element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(value => value.toFixed(1)).join(','); }).join(';'));
  let last = '';
  await expect.poll(async () => { const now = await read(); const steady = now === last; last = now; return steady; }, { intervals: [120], timeout: 5000 }).toBe(true);
}
