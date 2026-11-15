import { expect, test } from '@playwright/test';
import { buildDocumentIndex } from '../../src/preview2/model';
import { resolveField } from '../../src/composition-editor';
import { schemaAt } from '../../src/workspace2/rows';
import { openWorkspace, seed } from './workspace2-helpers';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: any };
test.beforeEach(async ({ request }) => { await seed(request); });

/** Every scalar a person could edit in a node: not its identity or its `type` (which a variant picker or a fixed value sets), and not the nodes it holds (they have their own panel). */
function leaves(value: unknown, path: (string | number)[], out: string[][] = []): string[][] {
  if (value === null || typeof value !== 'object') { out.push(path.map(String)); return out; }
  const record = value as Record<string, unknown>;
  const isNode = !Array.isArray(value) && typeof record.type === 'string' && typeof record.id === 'string';
  if (isNode && path.length > 0) return out;
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(value) && (key === 'id' || key === 'type' || key === 'children')) continue;
    leaves(child, [...path, key], out);
  }
  return out;
}

test('acceptance 2: every editable field of every kind of node is reachable from its properties', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 700, 'Reachability is the same at both sizes; the wide layout is faster to walk');
  test.setTimeout(240_000);
  await openWorkspace(page);
  const index = buildDocumentIndex(fixture.document);
  const seen = new Set<string>(), misses: string[] = []; let checked = 0;
  for (const entry of index.entries.values()) {
    if (entry.kind !== 'node' || !entry.node || seen.has(entry.node.type)) continue;
    const tile = page.locator(`[data-preview-root] [data-sel="${entry.key}"]`).first();
    if (await tile.count() === 0) {
      const surface = index.get(entry.surface!)!;
      const holder = surface.kind === 'page' ? fixture.document.pages.find((item: any) => item.id === surface.id) : fixture.document.modals.find((item: any) => item.id === surface.id);
      await page.getByRole('button', { name: 'Pages' }).click();
      await page.locator('.w2-pages').getByRole('button', { name: new RegExp(`^${holder.title}`) }).first().click();
      await page.keyboard.press('Escape');
    }
    // A node inside a local tab that is not showing has no tile to click; another node of its type is tried instead.
    if (await tile.count() === 0) continue;
    seen.add(entry.node.type);
    await tile.scrollIntoViewIfNeeded();
    // The click goes to the node itself: its own centre can be an Add slot at the end of a container.
    await page.locator(`[data-preview-root] [data-sel="${entry.key}"]`).first().dispatchEvent('click');
    const panel = page.getByLabel('Properties');
    await expect(panel).toBeVisible();
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
    for (const leaf of leaves(entry.node, [])) {
      const full = [...entry.path, ...leaf];
      // A field whose schema allows one value is fixed, and the spec hides it.
      const rule = resolveField(schemaAt(fixture.document, leaf.length ? full.map(part => /^\d+$/.test(String(part)) ? Number(part) : part) : full));
      if (rule.const !== undefined || rule.enum?.length === 1) continue;
      const dotted = full.join('/'); checked++;
      if (![...paths].some(path => path === dotted || dotted.startsWith(`${path}/`))) misses.push(`${entry.node.type} ${entry.id}: ${dotted}`);
    }
  }
  console.log(`fields: ${seen.size} kinds, ${checked} fields`);
  expect(seen.size).toBeGreaterThan(5);
  expect(checked).toBeGreaterThan(30);
  expect(misses, misses.join('\n')).toEqual([]);
});
