import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: any };

/** The fixture with something in every Project dialog, so each draws rows and not an empty line. */
const full = () => ({
  ...fixture.document,
  bootstrap: {
    type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
    recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable', unavailableMessage: 'Try again in a moment.', retryLabel: 'Try Again' },
    setup: [
      { permission: 'notifications', explanation: 'Choose whether this device can receive home alerts.' },
      { permission: 'time-sensitive', explanation: 'Review how urgent home alerts reach this device.' },
      { permission: 'location', explanation: 'Choose whether to share this device location with Home Assistant.' },
    ],
  },
  liveActivities: [{ id: 'activity-dryer', jobId: 'dryer', type: 'activity-presentation@1', title: 'Dryer', glyph: 'dryer', tint: 'cleaning', source: 'activity-engine@1', privacy: 'system-sensitive@1', updates: 'engine@1', intents: 'engine-safe@1' }],
  extensions: {
    type: 'native-extensions@1', watch: 'stub@1', linkPrefixes: ['hc'],
    cameras: [{ entityId: 'camera.demo_front_door', title: 'Front door', liveLabel: 'Live', unavailableLabel: 'Unavailable' }],
    routes: [{ id: 'route-home', path: 'home', pageId: 'page-home', title: 'Home', summary: 'Home', icon: 'house', tabId: 'hc-tab-home' }],
  },
});

const entry = (revision: number, at: string) => ({ revision, publishedAt: `2026-11-${at}T10:00:00Z`, publishedBy: null, envelopeSha256: String(revision).repeat(64).slice(0, 64), capabilities: [] });

/** A Home Assistant that holds revisions 12 (live), 11 and 10, and answers a roll back by making the chosen one live as the next revision. */
async function stubHomeAssistant(page: Page, options: { rollbackFails?: string; draftIsLive?: boolean | null; draftRevision?: number } = {}) {
  let current = entry(12, '14'), history = [entry(11, '13'), entry(10, '12')];
  const calls: number[] = [];
  await page.route('**/native/api/ha/publication', route => route.fulfill({ json: { epoch: 'e2e', current, history, storedAssets: 0, draftIsLive: options.draftIsLive, draftRevision: options.draftRevision } }));
  await page.route('**/native/api/ha/rollback', route => {
    const wanted = (route.request().postDataJSON() as { revision: number }).revision;
    calls.push(wanted);
    if (options.rollbackFails) return route.fulfill({ status: 404, json: { error: options.rollbackFails } });
    const target = history.find(item => item.revision === wanted)!;
    history = [current, ...history.filter(item => item !== target)]; current = { ...target, revision: current.revision + 1 };
    return route.fulfill({ json: { epoch: 'e2e', revision: current.revision, envelopeSha256: target.envelopeSha256 } });
  });
  return calls;
}

/** Opens a Project item the way a person does: a menu command when wide, a row of the sheet when narrow. */
async function project(page: Page, item: string) {
  await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
  if (isPhone(page)) await page.getByRole('button', { name: item, exact: true }).click();
  else await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Closes what `project` opened: the sheet when narrow (Escape, once per pushed page), the dialog when wide. */
async function closeProject(page: Page) {
  if (isPhone(page)) for (let at = 0; at < 3 && await page.locator('.w2-sheet').count(); at++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  else await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForTimeout(250);
}

/** A 1 x 1 PNG, enough for the server to accept as a wallpaper. */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ request }) => { await seed(request, full()); });
test.use({ actionTimeout: 8000 });

test('Publish History lists revisions with Live on the current one, asks before rolling back and shows the result', async ({ page }) => {
  const calls = await stubHomeAssistant(page);
  await openWorkspace(page);
  await project(page, 'Publish History');
  const history = page.locator('.w2-history');
  await expect(history.locator('li')).toHaveCount(3);
  await expect(history.locator('li').first()).toContainText('Revision 12');
  await expect(history.locator('li').first().getByText('Live')).toBeVisible();
  await expect(history.locator('li').nth(1)).toContainText('Revision 11');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-publish-history`);
  await history.locator('li').nth(1).getByRole('button', { name: /Roll Back/ }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Roll Back to Revision 11?' });
  await expect(confirm.getByText('It becomes the live layout as a new revision. Your draft does not change.')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-roll-back-confirm`);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(calls).toEqual([]);
  await history.locator('li').nth(1).getByRole('button', { name: /Roll Back/ }).click();
  await confirm.getByRole('button', { name: 'Roll Back', exact: true }).click();
  await expect(page.getByText('Rolled back', { exact: true })).toBeVisible();
  expect(calls).toEqual([11]);
  await expect(history.locator('li').first()).toContainText('Revision 13');
  await expect(history.locator('li').first().getByText('Live')).toBeVisible();
});

test('a failed roll back stays on the confirm with the reason and Try Again, and nothing says it worked', async ({ page }) => {
  await stubHomeAssistant(page, { rollbackFails: 'Revision 11 is no longer in the Home Assistant history' });
  await openWorkspace(page);
  await project(page, 'Publish History');
  await page.locator('.w2-history li').nth(1).getByRole('button', { name: /Roll Back/ }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Roll Back to Revision 11?' });
  await confirm.getByRole('button', { name: 'Roll Back', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('no longer in the Home Assistant history');
  await expect(confirm.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-roll-back-failed`);
  await expect(page.getByText('Rolled back', { exact: true })).toHaveCount(0);
});

test('the status tag reads Published · n after a reload when the app serves the saved draft, and Not Published when it does not', async ({ page, request }) => {
  const draft = await (await request.get('/native/api/draft')).json() as { revision: number };
  await stubHomeAssistant(page, { draftIsLive: true, draftRevision: draft.revision });
  await openWorkspace(page);
  const tag = isPhone(page) ? page.locator('.w2-status-narrow') : page.getByTestId('status-tag');
  await expect(tag).toHaveText('Published · 12');
  await page.unroute('**/native/api/ha/publication');
  await stubHomeAssistant(page, { draftIsLive: false, draftRevision: draft.revision });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(tag).toHaveText('Not Published');
});

test('a wallpaper chosen in its panel shows in the preview while the panel stays open, and No Image takes it away', async ({ page }) => {
  await stubHomeAssistant(page);
  await openWorkspace(page);
  const wall = previewRoot(page).locator('.sh-wall-image');
  await expect(wall).toHaveCount(0);
  await project(page, 'Wallpaper');
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'Wallpaper', exact: true })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-wallpaper`);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Choose Image…' }).click();
  await (await chooser).setFiles({ name: 'wall.png', mimeType: 'image/png', buffer: png });
  await expect(wall).toHaveCount(1);
  await expect(wall).toHaveCSS('background-image', /\/native\/api\/assets\//);
  await expect(panel.getByRole('heading', { name: 'Wallpaper', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'No Image' })).toBeEnabled();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-wallpaper-chosen`);
  await panel.getByRole('button', { name: 'No Image' }).click();
  await expect(wall).toHaveCount(0);
});

test('Help says the preview note once, and lists the shortcuts', async ({ page }) => {
  await stubHomeAssistant(page);
  await openWorkspace(page);
  await project(page, 'Help');
  const note = 'The preview approximates iOS. Taps are simulated and never reach your devices.';
  await expect(page.getByText(note)).toHaveCount(1);
  await expect(page.getByText('Save the draft now')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-help`);
});

test('Data counts what reads each source, Local State adds a state, and the rows open their fields', async ({ page }) => {
  await stubHomeAssistant(page);
  await openWorkspace(page);
  await project(page, 'Data');
  await expect(page.getByRole('region', { name: 'Models' })).toBeVisible();
  await expect(page.getByText(/^Used by \d+$/).first()).toBeVisible();
  await page.getByPlaceholder('Search data').fill('weather');
  await expect(page.locator('[data-pushes]')).toHaveCount(1);
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-data`);
  await page.locator('[data-pushes]').first().click();
  await expect(page.locator('.w2-pushed')).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-data-source`);
  await closeProject(page);
  await project(page, 'Local State');
  await page.getByRole('button', { name: 'Add State' }).click();
  await expect(page.getByRole('button', { name: 'Remove State' })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-local-state`);
});

test('every Project dialog and panel has a screenshot at this size', async ({ page }) => {
  await stubHomeAssistant(page);
  await openWorkspace(page);
  const size = isPhone(page) ? 'phone' : 'desktop';
  const close = () => closeProject(page);
  for (const [item, name] of [['Links', 'links'], ['App Launch', 'app-launch'], ['Live Activities', 'live-activities'], ['Import…', 'import'], ['About', 'about'], ['Activity', 'activity'], ['Edit as JSON…', 'json']] as const) {
    await project(page, item);
    await page.waitForTimeout(250);
    await snap(page, `${size}-${name}`);
    await close();
  }
  for (const [item, name] of [['Tabs', 'tabs'], ['Header Buttons', 'header-buttons']] as const) {
    await project(page, item);
    await page.waitForTimeout(250);
    await snap(page, `${size}-${name}`);
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  }
});
