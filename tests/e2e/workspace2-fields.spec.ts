import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildDocumentIndex } from '../../src/preview2/model';
import { resolveField } from '../../src/composition-editor';
import { schemaAt } from '../../src/workspace2/rows';
import { openWorkspace, seed } from './workspace2-helpers';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: any };
/** The fixture plus the launch text, so the Project > App Launch dialog has fields to walk. */
const withLaunch = () => ({
  ...fixture.document,
  bootstrap: {
    type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
    recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable', unavailableMessage: 'Try again when your publisher is available.', retryLabel: 'Try Again' },
    setup: [
      { permission: 'notifications', explanation: 'Choose whether this device can receive home alerts.' },
      { permission: 'time-sensitive', explanation: 'Review how urgent home alerts reach this device.' },
      { permission: 'location', explanation: 'Choose whether to share this device location with Home Assistant.' },
    ],
  },
});
test.beforeEach(async ({ request }) => { await seed(request, withLaunch()); });
test.use({ actionTimeout: 8000 });
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'Reachability is the same at both sizes; the wide layout is faster to walk');

type Path = (string | number)[];
const numeric = (path: string[]): Path => path.map(part => /^\d+$/.test(part) ? Number(part) : part);

/**
 * Every scalar a person could edit under `value`: not an identity or a `type` (a variant picker or a fixed value sets it),
 * not the nodes it holds (they have their own properties) and not what `skip` names.
 */
function leaves(value: unknown, path: string[], skip: (key: string) => boolean, out: string[][] = []): string[][] {
  if (value === null || typeof value !== 'object') { out.push(path); return out; }
  const record = value as Record<string, unknown>;
  const isNode = !Array.isArray(value) && typeof record.type === 'string' && typeof record.id === 'string';
  if (isNode && path.length > 0) return out;
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(value) && (key === 'id' || key === 'type' || skip(key))) continue;
    leaves(child, [...path, key], skip, out);
  }
  return out;
}
const nodeSkip = (key: string) => key === 'children';
const surfaceSkip = (key: string) => key === 'components' || key === 'children';

/** The field paths the surface in `panel` offers: every disclosure open, and the Advanced page too. */
async function reachable(panel: Locator): Promise<Set<string>> {
  const paths = new Set<string>();
  const collect = async () => { for (const path of await panel.locator('[data-field-path]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-field-path')!))) paths.add(path); };
  const openAll = async () => {
    for (let round = 0; round < 6; round++) {
      const closed = panel.locator('.w2-disclosure-head[aria-expanded=false]:not(.w2-advanced-row)');
      if (await closed.count() === 0) break;
      for (const button of await closed.all()) await button.click({ timeout: 2000 }).catch(() => undefined);
    }
    await collect();
  };
  await openAll();
  const advanced = panel.locator('.w2-advanced-row');
  if (await advanced.count()) { await advanced.first().click(); await openAll(); await panel.locator('.w2-back').first().click(); }
  return paths;
}

/**
 * Everything a Project dialog offers: its own rows, and the rows of every page its list rows push (one level; a pushed page that
 * pushes again is walked too). Each page is left with its Back.
 */
async function reachableDeep(panel: Locator): Promise<Set<string>> {
  const paths = await reachable(panel);
  const rows = panel.locator('[data-pushes]');
  const count = await rows.count();
  for (let at = 0; at < count; at++) {
    await panel.locator('[data-pushes]').nth(at).click({ timeout: 4000 });
    for (const found of await reachableDeep(panel)) paths.add(found);
    await panel.locator('.w2-back').first().click();
  }
  return paths;
}

/** The leaves under `entryPath` that no path in `paths` covers. A field whose schema allows one value is fixed, and the spec hides it. */
function missing(entryPath: Path, value: unknown, skip: (key: string) => boolean, paths: Set<string>): { checked: number; misses: string[] } {
  const misses: string[] = []; let checked = 0;
  for (const leaf of leaves(value, [], skip)) {
    const full = [...entryPath, ...leaf];
    const rule = resolveField(schemaAt(fixture.document, numeric(full.map(String))));
    if (rule.const !== undefined || rule.enum?.length === 1) continue;
    const dotted = full.join('/'); checked++;
    if (![...paths].some(path => path === dotted || dotted.startsWith(`${path}/`))) misses.push(dotted);
  }
  return { checked, misses };
}

/** Moves the preview to the page or sheet that holds `surfaceKey` through the Pages overlay. */
async function showSurface(page: Page, surfaceKey: string): Promise<void> {
  const index = buildDocumentIndex(fixture.document);
  const [kind, ...rest] = surfaceKey.split(':'), id = rest.join(':');
  const holder = (kind === 'page' ? fixture.document.pages : fixture.document.modals).find((item: any) => item.id === id);
  const current = page.locator(kind === 'page' ? `.sh-page[data-current][data-sel="${surfaceKey}"]` : `[data-preview-root] .sh-sheet[data-sel="${surfaceKey}"]`);
  if (await current.count()) return;
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.locator('.w2-pages').locator(kind === 'page' ? 'section:not([aria-label="Sheets"]) .w2-page-row, section[aria-label="Sheets"] ul ul .w2-page-row' : 'section[aria-label="Sheets"] > ul > li > .w2-page-item > .w2-page-row').filter({ has: page.locator('.w2-page-title', { hasText: new RegExp(`^${holder.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first().click();
  await page.keyboard.press('Escape');
  void index;
}

/** Brings the local tabs that hold `key` to the front by pressing their labels, as a person would. */
async function showTabs(page: Page, index: ReturnType<typeof buildDocumentIndex>, key: string): Promise<void> {
  for (const ancestor of index.ancestors(key as never)) {
    if (!ancestor.startsWith('local-tab:')) continue;
    await page.locator(`[data-preview-root] [data-sel="${ancestor}"]`).first().click();
  }
}

/** Selects `key` with a click on it, then Esc up from whatever the click landed on until the properties name it. */
async function selectNode(page: Page, key: string, title: string): Promise<Locator> {
  const tile = page.locator(`[data-preview-root] [data-sel="${key}"]`).first();
  await tile.scrollIntoViewIfNeeded();
  // A container's own pixels are mostly covered by what it holds, so the click goes to the node itself; the selection layer takes it from there.
  await tile.dispatchEvent('click');
  const panel = page.getByLabel('Properties');
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await panel.getByRole('heading', { name: title, exact: true }).count()) return panel;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
  return panel;
}

test('acceptance 2: every editable field of every kind of node is reachable from its properties, including nodes in tabs that are not showing', async ({ page }) => {
  test.setTimeout(480_000);
  await openWorkspace(page);
  const index = buildDocumentIndex(fixture.document);
  const seen = new Set<string>(), misses: string[] = []; let checked = 0, inTabs = 0;
  for (const entry of index.entries.values()) {
    if (entry.kind !== 'node' || !entry.node) continue;
    const hidden = index.ancestors(entry.key).some(key => key.startsWith('local-tab:'));
    // One node of each kind, and every node inside a local tab (so a tab that is not showing is switched to).
    if (seen.has(entry.node.type) && !hidden) continue;
    seen.add(entry.node.type);
    await showSurface(page, entry.surface!);
    await showTabs(page, index, entry.key);
    const panel = await selectNode(page, entry.key, entry.node.title);
    await expect(panel.getByRole('heading', { name: entry.node.title, exact: true }), `${entry.key} opens its own properties`).toBeVisible();
    const result = missing(entry.path, entry.node, nodeSkip, await reachable(panel));
    checked += result.checked; if (hidden) inTabs++;
    misses.push(...result.misses.map(path => `${entry.node?.type} ${entry.id}: ${path}`));
  }
  console.log(`node fields: ${seen.size} kinds, ${checked} fields, ${inTabs} nodes in local tabs`);
  expect(seen.size).toBeGreaterThan(5);
  expect(inTabs).toBeGreaterThan(0);
  expect(checked).toBeGreaterThan(30);
  expect(misses, misses.join('\n')).toEqual([]);
});

test('acceptance 2: every editable field of every page and sheet is reachable from its settings', async ({ page }) => {
  test.setTimeout(480_000);
  await openWorkspace(page);
  const misses: string[] = []; let checked = 0, surfaces = 0;
  const all = [...fixture.document.pages.map((item: any, at: number) => ({ key: `page:${item.id}`, value: item, path: ['pages', at] as Path })),
    ...fixture.document.modals.map((item: any, at: number) => ({ key: `modal:${item.id}`, value: item, path: ['modals', at] as Path }))];
  for (const surface of all) {
    await showSurface(page, surface.key);
    const target = page.locator(surface.key.startsWith('page:') ? `.sh-page[data-current][data-sel="${surface.key}"]` : `.sh-sheet[data-sel="${surface.key}"]`).first();
    await target.dispatchEvent('click');
    const panel = page.getByLabel('Properties');
    await expect(panel.getByRole('heading', { name: surface.value.title, exact: true }), `${surface.key} opens its settings`).toBeVisible();
    const result = missing(surface.path, surface.value, surfaceSkip, await reachable(panel));
    checked += result.checked; surfaces++;
    misses.push(...result.misses.map(path => `${surface.key}: ${path}`));
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  }
  console.log(`surface fields: ${surfaces} surfaces, ${checked} fields`);
  expect(surfaces).toBe(all.length);
  expect(misses, misses.join('\n')).toEqual([]);
});

test('acceptance 2: every editable field of the project is reachable from the Project menu', async ({ page }) => {
  test.setTimeout(240_000);
  await openWorkspace(page);
  const openFromMenu = async (item: string) => {
    await page.getByRole('button', { name: 'Project' }).click();
    await page.getByRole('menuitem', { name: item === 'Rename' ? fixture.document.name : item, exact: true }).click();
    await page.waitForTimeout(200);
  };
  const doc = withLaunch();
  const parts: { item: string; scope: () => Locator; value: unknown; path: Path; skip: (key: string) => boolean; close: () => Promise<void> }[] = [
    { item: 'Rename', value: doc.name, path: ['name'], skip: () => false },
    { item: 'Data', value: doc.dataSources, path: ['dataSources'], skip: () => false },
    { item: 'Local State', value: doc.localState, path: ['localState'], skip: () => false },
    { item: 'Live Activities', value: doc.liveActivities, path: ['liveActivities'], skip: () => false },
    { item: 'App Launch', value: doc.bootstrap, path: ['bootstrap'], skip: () => false },
  ].map(part => ({ ...part, scope: () => page.getByRole('dialog').last(), close: async () => { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); } }));
  const misses: string[] = []; let checked = 0;
  for (const part of parts) {
    await openFromMenu(part.item);
    const paths = await reachableDeep(part.scope());
    // The name is a plain labelled input, not a generated field, so it carries no field path.
    if (part.item === 'Rename' && await part.scope().getByLabel('Name', { exact: true }).count()) paths.add('name');
    const result = missing(part.path, part.value, part.skip, paths);
    checked += result.checked;
    misses.push(...result.misses.map(path => `${part.item}: ${path}`));
    await part.close();
  }
  // The panels the menu opens in the properties surface: tabs (navigation), header buttons (chrome) and the wallpaper (theme).
  for (const [item, path, value] of [['Tabs', ['navigation', 'tabs'], doc.navigation.tabs], ['Header Buttons', ['navigation', 'chrome'], doc.navigation.chrome], ['Wallpaper', ['theme'], doc.theme]] as [string, Path, unknown][]) {
    await openFromMenu(item);
    const panel = page.getByLabel('Properties');
    // A tab's own fields sit one push in; open each row the same way a person would.
    const rows = panel.locator('.w2-tab-open');
    const paths = await reachable(panel);
    for (let at = 0; item === 'Tabs' && at < await rows.count(); at++) { await rows.nth(at).click(); for (const found of await reachable(panel)) paths.add(found); await panel.locator('.w2-back').first().click(); }
    const result = missing(path, value, () => false, paths);
    checked += result.checked;
    misses.push(...result.misses.map(found => `${item}: ${found}`));
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  }
  console.log(`project fields: ${checked} fields`);
  expect(checked).toBeGreaterThan(20);
  expect(misses, misses.join('\n')).toEqual([]);
});
