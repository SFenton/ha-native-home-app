import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, seed } from './workspace2-helpers';

/**
 * The poses of the Templates panel (studio-tpl-ux, design verdict round 1): the Verifier's evidence, shot at the project's size (desktop 1440 x 900, phone
 * 390 x 844) with demo data only, and listed in `manifest.json` beside the PNGs. They run only with STUDIO_EVIDENCE_DIR set. The big fixture is the
 * proposal's: 13 templates used 119, 29, 17, ... times in a tile grid on each page, plus one unused.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR;
const home = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; components: unknown[] }[] } };
const lamps = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps.json', import.meta.url), 'utf8')) as { document: object };
const lampsSet = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps-set.json', import.meta.url), 'utf8')) as { document: object };

/** Thirteen templates (and a spare) placed in a grid at the top of every page. Entities are invented. */
function bigDocument() {
  const document = JSON.parse(JSON.stringify(home.document)) as { pages: { id: string; components: unknown[] }[]; componentLibrary?: unknown[] };
  const kinds: [string, string, number][] = [['Light Tile', 'lightbulb', 119], ['Occupancy Sensor Tile', 'figure.walk', 29], ['Room Lights Tile', 'lightbulb.2', 17], ['Room Occupancy Tile', 'person.2', 15], ['Light Chip', 'lightbulb', 15], ['Room Climate Tile', 'thermometer.medium', 14], ['Climate Chip', 'thermometer.medium', 14], ['Page Link Tile', 'alarm', 14], ['Contact Sensor Tile', 'door.left.hand.open', 12], ['Room Contacts Tile', 'door.left.hand.closed', 11], ['Camera Tile', 'video', 8], ['Air Quality Tile', 'aqi.medium', 6], ['Air Chip', 'wind', 6], ['Spare Tile', 'square', 0]];
  const grids = new Map<string, { children: unknown[] }>();
  document.componentLibrary = kinds.map(([name, icon], at) => ({
    id: `demo-tpl-${at}`, name,
    node: { id: `demo-tpl-${at}-body`, title: name.replace(' Tile', '').replace(' Chip', ''), type: 'state-tile', layout: { span: 1 }, icon: { type: 'sf-symbol', name: icon, rendering: 'canonical', unavailable: 'fallback' }, props: {}, binding: { entityId: 'switch.demo_lamp', builtIn: 'switch' } },
    params: [{ name: 'entity', kind: 'entity-id', label: 'Entity' }, { name: 'title', kind: 'text', label: 'Name' }],
    bindings: [{ param: 'entity', nodeId: `demo-tpl-${at}-body`, field: 'binding/entityId' }, { param: 'title', nodeId: `demo-tpl-${at}-body`, field: 'title' }],
  }));
  let placed = 0;
  kinds.forEach(([name, , uses], at) => {
    for (let k = 0; k < uses; k += 1, placed += 1) {
      const page = document.pages[placed % document.pages.length];
      let grid = grids.get(page.id);
      if (!grid) { grid = { children: [] }; grids.set(page.id, grid); page.components.unshift({ id: `demo-grid-${page.id}`, title: 'Template Tiles', layout: { span: 1 }, type: 'tile-grid', props: { minimum: 'tile-dynamic-type@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'container' }, children: grid.children }); }
      grid.children.push({ id: `demo-use-demo-tpl-${at}-${k}`, type: 'component-ref', componentId: `demo-tpl-${at}`, layout: { span: 1 }, args: { entity: k % 2 ? 'switch.demo_fan' : 'switch.demo_lamp', title: `${name.split(' ')[0]} ${k + 1}` } });
    }
  });
  return document;
}

test.skip(!evidence, 'Evidence poses run only with STUDIO_EVIDENCE_DIR');

interface Pose { file: string; project: string; size: string; pose: string; judgedAgainst: string }
const poses: Pose[] = [];
async function shoot(page: Page, file: string, pose: string, judgedAgainst: string) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${file}.png`, animations: 'disabled' });
  const size = page.viewportSize()!;
  poses.push({ file: `${file}.png`, project: isPhone(page) ? 'phone' : 'desktop', size: `${size.width}x${size.height}`, pose, judgedAgainst });
}
test.afterAll(() => {
  if (!evidence) return;
  const path = `${evidence}/manifest.json`;
  const before = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { poses: Pose[] }).poses : [];
  const merged = [...before.filter(old => !poses.some(pose => pose.file === old.file)), ...poses].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(path, `${JSON.stringify({ lane: 'studio-tpl-ux', data: 'demo fixtures only', poses: merged }, null, 2)}\n`);
});

const panel = (page: Page) => page.getByLabel('Properties');
const rows = (page: Page) => page.getByTestId('saved-row');
const rowButton = (page: Page, name: string) => rows(page).getByRole('button', { name: new RegExp(`^${name}, template`) });
const badges = (page: Page) => previewRoot(page).locator('.sh-link-badge');
const toast = (page: Page) => page.locator('.w2-toast');
const fullSheet = async (page: Page) => { if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))); };
async function openProjectTemplates(page: Page) {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByTestId('templates-row').click();
  await expect(page.getByTestId('phone-templates')).toBeVisible();
}

test.describe('desktop poses', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'Desktop');

  test('the delete dialog, and the toast after a used delete (poses 1 and 2)', async ({ page, request }) => {
    await seed(request, bigDocument());
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await rows(page).getByRole('button', { name: 'More for Light Tile' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = page.getByTestId('delete-component');
    await expect(dialog).toContainText('It is used in 119 places.');
    await shoot(page, 'p01-desktop-delete-dialog', 'Delete dialog for a used template: title, the count sentence, Cancel, red Delete Template', 'pick-desktop-delete-dialog.png');
    await dialog.getByRole('button', { name: 'Delete Template' }).click();
    await expect(toast(page).filter({ hasText: 'Deleted Light Tile' })).toContainText('Deleted Light Tile. 119 places are now their own copies.');
    await shoot(page, 'p02-desktop-delete-done', 'Toast after a used delete with Undo, the tiles without badges', 'pick-desktop-delete-done.png');
  });

  test('the toast after an unused delete (pose 3)', async ({ page, request }) => {
    await seed(request, bigDocument());
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await rows(page).getByRole('button', { name: 'More for Spare Tile' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(toast(page)).toContainText('Deleted Spare Tile.');
    await shoot(page, 'p03-desktop-delete-unused', 'Toast after an unused delete', 'proposal section 5');
  });

  test('the editor from a row, scrolled to Each place sets and Delete Template (poses 4 and 5)', async ({ page, request }) => {
    await seed(request, lampsSet.document);
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await rows(page).getByRole('button', { name: /^Lamp Pair, template/ }).click();
    const editor = page.getByTestId('template-editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('A change here shows in all 2 places.');
    await expect(rows(page)).toHaveAttribute('data-open', 'true');
    await shoot(page, 'p04-desktop-editor', 'Editor from the row: Components panel showing, the row tinted, "A change here shows in all N places.", a Set Per Place line', 'pick-desktop-editor.png');
    await editor.getByRole('button', { name: 'Delete Template…' }).scrollIntoViewIfNeeded();
    await expect(editor).toContainText('Each place sets');
    await shoot(page, 'p05-desktop-editor-foot', 'The same editor scrolled to Each place sets and Delete Template…', 'proposal section 2');
  });

  test('the row menu and a list of 13 rows with one hovered (poses 6 and 7)', async ({ page, request }) => {
    await seed(request, bigDocument());
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await expect(rows(page)).toHaveCount(14);
    await rows(page).nth(3).getByRole('button', { name: /^Room Occupancy Tile, template/ }).hover();
    await shoot(page, 'p07-desktop-list-13', 'List of the templates with one row hovered', 'pick-desktop-list.png');
    await rows(page).nth(0).getByRole('button', { name: 'More for Light Tile' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Add to Page', 'Rename', 'Show Uses', 'Delete']);
    await shoot(page, 'p06-desktop-row-menu', 'The row menu open: Add to Page, Rename, Show Uses, Delete', 'proposal section 2');
  });

  test('Use mode: Uses with no badge, and the editor read only (pose 8)', async ({ page, request }) => {
    await seed(request, lamps.document);
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await rows(page).getByRole('button', { name: 'More for Lamp Pair' }).click();
    await page.getByRole('menuitem', { name: 'Show Uses' }).click();
    await page.getByTestId('template-uses-level').locator('[data-use]').first().click();
    await page.getByRole('button', { name: 'Use', exact: true }).first().click();
    await expect(badges(page)).toHaveCount(0);
    await shoot(page, 'p08-desktop-use-uses', 'Use mode: the Uses page, the place selected, no badge', 'linked-uses.png');
    await page.getByTestId('template-uses-level').getByRole('button', { name: 'Back to Templates' }).click();
    await rows(page).getByRole('button', { name: /^Lamp Pair, template/ }).click();
    await expect(page.getByTestId('template-editor').getByRole('textbox', { name: 'Name' })).toBeDisabled();
    await shoot(page, 'p08-desktop-use-editor', 'Use mode: the editor read only with Add to Page and Delete disabled', 'owner follow-up');
  });

  test('Use mode: the row with + dimmed, the row menu with its commands dimmed, and the editor foot (poses 14 to 16)', async ({ page, request }) => {
    await seed(request, lamps.document);
    await openWorkspace(page);
    await openLibrary(page, 'Components');
    await page.getByRole('button', { name: 'Use', exact: true }).first().click();
    const row = rows(page);
    await expect(row.getByRole('button', { name: 'Add Lamp Pair to the page' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Add Lamp Pair to the page' })).toHaveCSS('opacity', '0.35');
    await shoot(page, 'p14-desktop-use-row', 'Use mode: the row with + dimmed, More at full ink', 'verdict round 2 change 1');
    await row.getByRole('button', { name: 'More for Lamp Pair' }).click();
    await expect(page.getByRole('menuitem', { name: 'Add to Page' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
    await shoot(page, 'p15-desktop-use-row-menu', 'Use mode: the row menu open, Add to Page, Rename and Delete dimmed, Show Uses live', 'verdict round 2 change 1');
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: /^Lamp Pair, template/ }).click();
    const foot = page.getByTestId('template-editor').getByRole('button', { name: 'Delete Template…' });
    await foot.scrollIntoViewIfNeeded();
    await expect(foot).toBeDisabled();
    await shoot(page, 'p16-desktop-use-editor-foot', 'Use mode: the editor foot with Delete Template dimmed', 'verdict round 2 change 1');
  });

  test('a click on a template tile itself opens the place form, with the badge not focused (pose 9)', async ({ page, request }) => {
    await seed(request, lamps.document);
    await openWorkspace(page);
    await previewRoot(page).getByText('Demo Lamps', { exact: true }).first().click();
    await expect(panel(page).getByRole('heading', { name: 'Lamp Pair', exact: true })).toBeVisible();
    await expect(previewRoot(page).locator('.sh-link-badge:focus')).toHaveCount(0);
    await shoot(page, 'p09-desktop-tile-click', 'Edit: a click on a template tile, the place form in the inspector, the badge not focused', 'owner follow-up');
  });

  test('the badge focus ring and the Repeated Pieces level (pose 13, desktop)', async ({ page, request }) => {
    await seed(request, lamps.document);
    await openWorkspace(page);
    await previewRoot(page).locator('button.sh-link-badge').first().focus();
    await shoot(page, 'p13-desktop-badge-focus', 'The badge focused: the ring inside the disc, clear of the heading', 'verdict fix 1');
  });
});

test.describe('phone poses', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 700, 'Phone');

  test('Project > Templates with rows, scrolled to the foot (pose 10)', async ({ page, request }) => {
    await seed(request, bigDocument());
    await openWorkspace(page);
    await openProjectTemplates(page);
    await expect(rows(page)).toHaveCount(14);
    await shoot(page, 'p10-phone-project-templates', 'Project > Templates with rows', 'pick-phone-project-templates.png');
    await page.getByTestId('find-repeats').scrollIntoViewIfNeeded();
    await shoot(page, 'p10-phone-project-templates-foot', 'Project > Templates scrolled to the foot', 'pick-phone-project-templates.png');
  });

  test('the editor in the properties sheet, then Uses pushed from its row (pose 11)', async ({ page, request }) => {
    await seed(request, lampsSet.document);
    await openWorkspace(page);
    await openProjectTemplates(page);
    await rowButton(page, 'Lamp Pair').click();
    await expect(page.getByTestId('template-editor')).toBeVisible();
    await fullSheet(page);
    await shoot(page, 'p11-phone-editor', 'The editor in the properties sheet', 'pick-phone-editor.png');
    await page.getByTestId('template-uses-row').click();
    await expect(panel(page).getByRole('heading', { name: 'Uses' })).toBeVisible();
    await shoot(page, 'p11-phone-uses', 'Uses pushed from the editor row', 'pick-phone-uses.png');
  });

  test('the delete dialog and the toast (pose 12)', async ({ page, request }) => {
    await seed(request, bigDocument());
    await openWorkspace(page);
    await openProjectTemplates(page);
    await rows(page).getByRole('button', { name: 'More for Occupancy Sensor Tile' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = page.getByTestId('delete-component');
    await expect(dialog).toContainText('It is used in 29 places.');
    await shoot(page, 'p12-phone-delete-dialog', 'The delete dialog', 'pick-phone-delete.png');
    await dialog.getByRole('button', { name: 'Delete Template' }).click();
    await expect(toast(page)).toContainText('29 places are now their own copies.');
    await shoot(page, 'p12-phone-delete-toast', 'The toast with Undo', 'pick-phone-delete.png');
  });

  test('the Add sheet More, Single Tiles, and a page with badges in Edit and in Use (pose 13)', async ({ page, request }) => {
    await seed(request, lamps.document);
    await openWorkspace(page);
    await shoot(page, 'p13-phone-badges-edit', 'A page with badges, in Edit', 'pick-phone-add-sheet.png');
    await page.getByRole('button', { name: 'Use', exact: true }).first().click();
    await expect(badges(page)).toHaveCount(0);
    await shoot(page, 'p13-phone-badges-use', 'The same page in Use, no badges', 'owner follow-up');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.locator('.w2-bottom-add').click();
    const picker = page.getByTestId('add-picker');
    await picker.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Templates' }).click();
    await picker.getByRole('button', { name: 'More for Lamp Pair' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit Template' })).toBeVisible();
    await shoot(page, 'p13-phone-add-more', 'The Add sheet More open with Edit Template', 'pick-phone-add-sheet.png');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await openProjectTemplates(page);
    await page.getByTestId('find-repeats').click();
    const tiles = page.getByRole('region', { name: 'Single Tiles' });
    await expect(tiles).toBeVisible();
    await tiles.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(tiles).toBeInViewport();
    await shoot(page, 'p13-phone-single-tiles', 'The Repeated Pieces sheet scrolled to Single Tiles', 'phone-repeats-single-tiles.png');
  });
});
