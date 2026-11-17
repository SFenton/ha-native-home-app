import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, previewTile, seed, snap } from './workspace2-helpers';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: Record<string, any> };

/**
 * The Home page with a top-level grid of four tiles that follows the fold (`fold: page`) put first, and a second that ignores it
 * (`fold: container`), so one page shows the difference.
 */
function documentWithFoldGrids() {
  const document = structuredClone(fixture.document);
  const home = document.pages.find((page: { id: string }) => page.id === 'page-home');
  const sample = JSON.stringify(JSON.parse(JSON.stringify(home)).components.flatMap(function find(node: any): any[] { return node.type === 'action-tile' ? [node] : (node.children ?? []).flatMap(find); })[0]);
  const grid = (id: string, fold: 'page' | 'container') => ({
    id, title: fold === 'page' ? 'Page grid' : 'Container grid', layout: { span: 1 }, type: 'tile-grid', children: [0, 1, 2, 3].map(at => ({ ...JSON.parse(sample), id: `${id}-${at}`, title: `${fold} ${at + 1}` })),
    props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'points', value: 12 }, equalRowHeights: true, shortRow: 'share', fold },
  });
  home.components = [grid('fold-page-grid', 'page'), grid('fold-container-grid', 'container'), ...home.components];
  return document;
}
test.beforeEach(async ({ request }) => { await seed(request, documentWithFoldGrids()); });

/** The track widths of a drawn grid, in points. The preview scales the window, but computed tracks are in layout points. */
const tracks = (page: Page, id: string) => page.evaluate(selector => {
  const grid = document.querySelector<HTMLElement>(selector)!;
  return { widths: getComputedStyle(grid).gridTemplateColumns.split(' ').map(parseFloat), banded: grid.hasAttribute('data-banded') };
}, `[data-preview-root] [data-sel="node:${id}"] .sh-grid`);

test('the Duo reflows a fold: page grid from four 200 pt cells flat to 2 + 2 around the band partly folded, and a container grid stays put', async ({ page }) => {
  test.skip(isPhone(page), 'The simulator rail sits beside the device on a desk');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Window' }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  const rail = page.getByTestId('simulator-rail');
  await rail.getByRole('button', { name: 'Rotate' }).click();
  await rail.getByRole('button', { name: 'Unfolded' }).click();
  const grid = previewRoot(page).locator('[data-sel="node:fold-page-grid"] .sh-grid');
  await expect(grid).toHaveAttribute('data-columns', '4');
  await expect.poll(async () => (await tracks(page, 'fold-page-grid')).widths.map(Math.round)).toEqual([200, 200, 200, 200]);
  expect((await tracks(page, 'fold-container-grid')).widths.map(Math.round)).toEqual([200, 200, 200, 200]);
  await snap(page, 'duo-flat-fold-page-grid');

  await rail.getByRole('button', { name: 'Partly Folded' }).click();
  await expect.poll(async () => (await tracks(page, 'fold-page-grid')).banded).toBe(true);
  // Two tracks a side, 214 pt before the band and 172 pt after it, the band's own 16 pt track (its 40 pt less the gaps) between.
  expect((await tracks(page, 'fold-page-grid')).widths.map(Math.round)).toEqual([214, 214, 16, 172, 172]);
  // A container grid ignores the fold and keeps its four 200 pt cells.
  expect(await tracks(page, 'fold-container-grid')).toEqual({ widths: [200, 200, 200, 200], banded: false });
  await snap(page, 'duo-book-fold-page-grid');

  // The Window menu says which pose it is, and back to flat restores four 200 pt cells.
  await page.getByRole('button', { name: 'Window' }).click();
  await expect(page.getByTestId('fold-readout')).toHaveText('Fold: book, band 455 to 496 pt');
  await page.keyboard.press('Escape');
  await rail.getByRole('button', { name: 'Unfolded' }).click();
  await expect.poll(async () => (await tracks(page, 'fold-page-grid')).widths.map(Math.round)).toEqual([200, 200, 200, 200]);
});

test('the Fold row of a tile grid says what Page and Container do', async ({ page }) => {
  test.skip(isPhone(page), 'The phone opens the properties as a sheet; the words are covered by the label map test');
  await openWorkspace(page);
  // A tile is selected by its words; Escape selects its parent, the grid.
  await previewTile(page, 'page 1').click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Page grid', exact: true })).toBeVisible();
  await expect(page.getByLabel('Properties').getByText('Page: avoids the Duo’s hinge. Container: ignores it.')).toBeVisible();
});
