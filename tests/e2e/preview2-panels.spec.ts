import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Where the evidence screenshots go; override with STUDIO_EVIDENCE_DIR. */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-evidence');
test.use({ viewport: { width: 700, height: 940 }, deviceScaleFactor: 2 });

const story = (query: string) => `/?preview2=1&panel=0&${query}`;
async function shot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.waitForTimeout(400);
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
}

/** The node types of the panels, rooms, cameras and records lane, each on a page that holds it, with no placeholder among them. */
const pages: { name: string; query: string; types: string[] }[] = [
  { name: 'security', query: 'surface=page:page-security', types: ['alarm-panel', 'door-tile'] },
  { name: 'weather-sheet', query: 'surface=modal:hc-weather-sheet', types: ['weather-panel'] },
  { name: 'home', query: 'surface=page:page-home', types: ['weather-panel'] },
  { name: 'rooms', query: 'fixture=family-room-chip', types: ['room-navigation-grid'] },
  { name: 'room-device', query: 'fixture=family-humidifier-scheduling', types: ['room-device-control'] },
  { name: 'bedroom-tile', query: 'fixture=family-bed-tile', types: ['bedroom-control'] },
  { name: 'bedroom-weekdays', query: 'fixture=family-alarm-weekdays', types: ['bedroom-control'] },
  { name: 'records', query: 'fixture=family-collection&surface=page:page-echo', types: ['collection', 'form', 'pinned-actions', 'recipe-part'] },
  { name: 'row-collection', query: 'fixture=family-local-controls&surface=page:page-echo', types: ['row-collection'] },
  { name: 'bootstrap', query: 'fixture=family-bootstrap-message', types: ['bootstrap-message'] },
];
for (const item of pages) {
  test(`draws ${item.name} without a placeholder`, async ({ page }) => {
    await page.goto(story(`${item.query}&mode=use`));
    for (const type of item.types) await expect(page.locator(`[data-type="${type}"]`).first()).toBeAttached();
    await expect(page.locator('.sh-placeholder')).toHaveCount(0);
    await shot(page, item.name);
  });
}
