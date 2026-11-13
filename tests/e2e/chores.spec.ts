import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { choresDocument, choresSnapshot, legacyChoresDocument } from '../fixtures/chores';
import { importNativeHome } from '../../src/shared/native-preview';
import type { StudioDocument } from '../../src/shared/types';

test.use({ trace: 'on' });
async function seed(request: APIRequestContext, document: StudioDocument) {
  const draft = await (await request.get('/api/draft')).json();
  expect((await request.put('/api/draft', { data: { document, expectedRevision: draft.revision } })).ok()).toBeTruthy();
}
async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
}
async function swipe(page: Page, row: Locator, direction: 'left' | 'right', full = false) {
  await row.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = (await row.boundingBox())!;
  const start = direction === 'left' ? box.x + box.width * .6 : box.x + 15;
  const distance = full ? box.width - 30 : Math.min(115, box.width / 2);
  await page.mouse.move(start, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(start + (direction === 'left' ? -distance : distance), box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('existing requiredData nodes resolve typed records without reimport or saved-document changes', async ({ page, request }, testInfo) => {
  const document = legacyChoresDocument();
  document.navigation.initialPageId = 'chores';
  const root = document.pages.find(page => page.id === 'chores')!.components.find(node => node.props.nativeTodoPage)!;
  root.children!.push(
    { id: 'legacy-editable-help', type: 'text', title: 'User-owned Chores help survives', props: {} },
  );
  root.children![0].children = [{ id: 'legacy-nested-help', type: 'text', title: 'User-owned nested help survives', props: {} }];
  await seed(request, document);
  const saved = await (await request.get('/api/draft')).json();
  await open(page);
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await expect(canvas.getByRole('button', { name: 'Complete Task Alpha', exact: true })).toBeVisible();
  await expect(canvas.getByText('Other assignment', { exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('heading', { name: 'No Due Date', exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('heading', { name: 'Chores', exact: true })).toHaveCount(1);
  await expect(canvas.getByText('User-owned Chores help survives', { exact: true })).toBeVisible();
  await expect(canvas.getByText('User-owned nested help survives', { exact: true })).toBeVisible();
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-existing-nodes.png'), animations: 'disabled' });
  await canvas.getByRole('button', { name: 'Complete Task Alpha', exact: true }).click();
  await canvas.getByRole('button', { name: 'Your Summary', exact: true }).click();
  const profile = canvas.getByRole('dialog', { name: 'Your Summary', exact: true });
  await profile.getByRole('tab', { name: 'Overdue Chores', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Mark Not Done Task Alpha', exact: true })).toBeVisible();
  await profile.getByRole('button', { name: 'Undo', exact: true }).click();
  await profile.getByRole('tab', { name: 'Upcoming Chores', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Complete Task Today', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Dismiss app modal' }).click();
  await canvas.getByRole('button', { name: 'Add Task', exact: true }).click();
  await canvas.getByRole('dialog', { name: 'New Task simulation' }).getByLabel('Task Name', { exact: true }).fill('Legacy browser addition');
  await canvas.getByRole('dialog', { name: 'New Task simulation' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Legacy browser addition', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Reset Chores simulation', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Legacy browser addition', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await canvas.locator('[data-component-id="legacy-nested-help"]').click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('User-owned nested help survives');
  expect(writes).toEqual([]);
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('short and wrapping Chores titles keep the same leading alignment', async ({ page, request }, testInfo) => {
  const document = choresDocument(), snapshot = choresSnapshot();
  document.navigation.initialPageId = 'chores';
  snapshot.states[0].todoList = { status: 'ready', items: [
    { uid: '11--fixture', summary: 'A', status: 'needs_action' },
    { uid: '12--fixture', summary: 'A deliberately long task title that wraps across multiple lines without shifting the checkbox or the beginning of the text column', status: 'needs_action' },
  ] };
  document.dataSources.find(source => source.id === 'native-states')!.sample = snapshot.states;
  await seed(request, document);
  await open(page);
  const rows = page.locator('.native-scroll.navigation-enter .chore-module').first().locator('.chore-row');
  await expect(rows).toHaveCount(2);
  const positions = await rows.evaluateAll(elements => elements.map(element => ({
    row: element.getBoundingClientRect().left,
    check: element.querySelector('.chore-check')!.getBoundingClientRect().left,
    text: element.querySelector('.chore-copy')!.getBoundingClientRect().left,
  })));
  expect(Math.abs(positions[0].check - positions[1].check)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions[0].text - positions[1].text)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions[0].row - positions[1].row)).toBeLessThanOrEqual(1);
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-title-alignment.png'), animations: 'disabled' });
});

test('states-only refresh atomically switches identity and cancels stale Chores forms and simulations', async ({ page, request }) => {
  const snapshot = choresSnapshot(), { document } = importNativeHome(snapshot);
  document.navigation.initialPageId = 'chores';
  document.dataSources.find(source => source.id === 'native-states')!.refreshSeconds = 5;
  document.dataSources.find(source => source.id === 'native-profile')!.refreshSeconds = 3600;
  await seed(request, document);
  const saved = await (await request.get('/api/draft')).json();
  await page.route('**/api/health', route => route.fulfill({ json: { mode: 'live', haConnected: true } }));
  await page.route('**/api/native-home', route => route.fulfill({ json: snapshot }));
  await open(page);
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await canvas.getByRole('button', { name: 'Complete Task Beta', exact: true }).click();
  await canvas.getByRole('button', { name: 'Edit Task Alpha', exact: true }).click();
  await canvas.getByRole('dialog', { name: 'Edit Task simulation' }).getByLabel('Task Name', { exact: true }).fill('Stale edit');
  snapshot.currentUser = { id: 'user-two', name: 'Second fixture user', isAdmin: false, isOwner: false };
  await expect(canvas.getByRole('button', { name: 'Complete Other assignment', exact: true })).toBeVisible({ timeout: 8000 });
  await expect(canvas.getByRole('dialog', { name: 'Edit Task simulation' })).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Reset Chores simulation', exact: true })).toHaveCount(0);
  await canvas.getByLabel('Actions for Other assignment', { exact: true }).click();
  await canvas.locator('.chore-menu[open]').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(canvas.getByRole('alertdialog', { name: 'Delete Task simulation' })).toBeVisible();
  delete snapshot.currentUser;
  await expect(canvas.getByRole('alert')).toHaveText('Signed-in user unavailable. Refresh live preview data.', { timeout: 8000 });
  await expect(canvas.getByRole('alertdialog', { name: 'Delete Task simulation' })).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Complete Other assignment', exact: true })).toHaveCount(0);
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('assigned Chores, subpages, profile summaries, swipes and ephemeral add/remove/reset', async ({ page, request }, testInfo) => {
  const document = choresDocument();
  document.navigation.initialPageId = 'chores';
  const chorePage = document.pages.find(page => page.id === 'chores')!;
  chorePage.components.find(node => node.props.nativeTodoPage)!.children!.push(
    { id: 'chores-editable-note', type: 'text', title: 'Configured Chores help remains editable', props: {} },
    { id: 'chores-scroll-fixture', type: 'spacer', title: '', props: { height: 400 } },
  );
  await seed(request, document);
  await open(page);
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await expect(canvas.getByRole('button', { name: 'Complete Task Alpha', exact: true })).toBeVisible();
  await expect(canvas.getByText('Other assignment', { exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('heading', { name: 'No Due Date', exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: /Your Chores/ })).toContainText('3 open');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-assigned.png'), animations: 'disabled' });

  const alpha = canvas.locator('.native-scroll.navigation-enter .chore-row').filter({ has: page.locator('.chore-copy > span', { hasText: /^Task Alpha$/ }) });
  await expect(alpha.locator('.chore-swipe-actions')).toBeHidden();
  await swipe(page, alpha, 'right');
  await expect(alpha).toHaveAttribute('data-swipe', 'leading');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-leading-swipe.png'), animations: 'disabled' });
  await alpha.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(alpha.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(canvas.getByRole('button', { name: /Your Chores/ })).toContainText('2 open');
  await alpha.getByRole('button', { name: 'Undo', exact: true }).click();

  await canvas.getByRole('button', { name: /Your Chores/ }).click();
  await expect(canvas.locator('.navigation-exit')).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Complete Task Alpha', exact: true })).toBeVisible();
  await expect(canvas.getByRole('heading', { name: 'Chores', exact: true })).toHaveCount(0);
  await canvas.getByRole('button', { name: 'Complete Task Alpha', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-subpage-undo.png'), animations: 'disabled' });
  await canvas.getByRole('button', { name: 'Back in app preview' }).click();
  await expect(canvas.locator('.navigation-exit')).toHaveCount(0);
  await canvas.getByRole('button', { name: 'Your Summary', exact: true }).click();
  const profile = canvas.getByRole('dialog', { name: 'Your Summary', exact: true });
  await profile.getByRole('tab', { name: 'Overdue Chores', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Mark Not Done Task Alpha', exact: true })).toBeVisible();
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-profile-overdue.png'), animations: 'disabled' });
  await profile.getByRole('button', { name: 'Undo', exact: true }).click();
  await profile.getByRole('tab', { name: 'Upcoming Chores', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Complete Task Today', exact: true })).toBeVisible();
  await expect(profile.getByRole('heading', { name: 'No Due Date', exact: true })).toHaveCount(0);
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-profile-upcoming.png'), animations: 'disabled' });
  await canvas.getByRole('button', { name: 'Dismiss app modal' }).click();
  await expect(profile).toHaveCount(0);

  const beta = canvas.locator('.native-scroll.navigation-enter .chore-row').filter({ has: page.locator('.chore-copy > span', { hasText: /^Task Beta$/ }) });
  await swipe(page, beta, 'left');
  await expect(beta).toHaveAttribute('data-swipe', 'trailing');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-trailing-swipe.png'), animations: 'disabled' });
  await canvas.getByRole('heading', { name: 'Chores', exact: true }).click();
  await expect(beta).not.toHaveAttribute('data-swipe', 'trailing');
  await swipe(page, beta, 'left');
  await beta.press('Escape');
  await expect(beta).not.toHaveAttribute('data-swipe', 'trailing');
  await swipe(page, beta, 'left', true);
  await expect(canvas.getByRole('alertdialog', { name: 'Delete Task simulation' })).toBeVisible();
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-delete-confirmation.png'), animations: 'disabled' });
  await canvas.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Task Beta', exact: true })).toHaveCount(0);

  await canvas.getByRole('button', { name: 'Add Task', exact: true }).click();
  const form = canvas.getByRole('dialog', { name: 'New Task simulation' });
  await form.getByLabel('Task Name', { exact: true }).fill('Browser synthetic addition');
  await form.getByLabel('Due Date', { exact: true }).fill('2030-01-01');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-add-form.png'), animations: 'disabled' });
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Browser synthetic addition', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Edit Browser synthetic addition', exact: true }).click();
  await canvas.getByRole('dialog', { name: 'Edit Task simulation' }).getByLabel('Task Name', { exact: true }).fill('Browser edited addition');
  await canvas.getByRole('dialog', { name: 'Edit Task simulation' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Browser edited addition', exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Reset Chores simulation', exact: true }).click();
  await expect(canvas.getByRole('button', { name: 'Complete Browser edited addition', exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Complete Task Beta', exact: true })).toBeVisible();
  const scroller = page.locator('.native-scroll.navigation-enter');
  await scroller.hover();
  await page.mouse.wheel(0, 550);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(canvas.getByText('Configured Chores help remains editable', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await swipe(page, beta, 'right', true);
  await expect(canvas.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Complete Task Beta', exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Mark Not Done Task Beta', exact: true })).toHaveCount(0, { timeout: 6500 });
  expect(writes).toEqual([]);
  expect((await (await request.get('/api/draft')).json()).document).toEqual(JSON.parse(JSON.stringify(document)));
});

test('different resident, unmapped viewer, empty lists and read failures never become samples', async ({ page, request }, testInfo) => {
  const document = choresDocument();
  document.navigation.initialPageId = 'chores';
  document.dataSources.find(source => source.id === 'native-profile')!.sample = { id: 'user-two', name: 'Resident One' };
  await seed(request, document);
  await open(page);
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await expect(canvas.getByRole('button', { name: 'Complete Other assignment', exact: true })).toBeVisible();
  await expect(canvas.getByText('Task Alpha', { exact: true })).toHaveCount(0);
  document.dataSources.find(source => source.id === 'native-profile')!.sample = { id: 'guest', name: 'Resident One' };
  await seed(request, document);
  await page.reload();
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(canvas.getByText('Nothing assigned.', { exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'Your Summary', exact: true }).click();
  await expect(canvas.getByRole('tab', { name: 'Overdue Chores', exact: true })).toHaveCount(0);
  await canvas.getByRole('button', { name: 'Dismiss app modal' }).click();

  const failed = choresDocument();
  failed.navigation.initialPageId = 'chores';
  const states = failed.dataSources.find(source => source.id === 'native-states')!.sample;
  if (!Array.isArray(states)) throw new Error('Expected fixture states');
  const first = states[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) throw new Error('Expected fixture state');
  first.todoList = { status: 'error', message: 'Synthetic list read failed. Refresh live preview data.' };
  await seed(request, failed);
  await page.reload();
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(canvas.getByRole('alert')).toHaveText('Synthetic list read failed. Refresh live preview data.');
  await expect(canvas.getByRole('button', { name: 'Complete Task Today', exact: true })).toBeVisible();
  await expect(canvas.getByText('Task Alpha', { exact: true })).toHaveCount(0);
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('chores-read-error.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByLabel('Preview data state', { exact: true }).selectOption('loading');
  await expect(canvas.getByText('Loading chores...', { exact: true })).toBeVisible();
});

test('grocery deletion is immediate, admin rename is allowed but deletion is unavailable', async ({ page, request }) => {
  const document = choresDocument();
  document.navigation.initialPageId = 'chores';
  await seed(request, document);
  await open(page);
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await canvas.getByRole('button', { name: /^Groceries/ }).click();
  await expect(canvas.getByRole('button', { name: 'Edit Synthetic apples', exact: true })).toHaveCount(0);
  await canvas.getByLabel('Actions for Synthetic apples', { exact: true }).focus();
  await canvas.getByLabel('Actions for Synthetic apples', { exact: true }).press('Enter');
  await canvas.locator('.chore-menu[open]').getByRole('button', { name: 'Delete', exact: true }).focus();
  await canvas.locator('.chore-menu[open]').getByRole('button', { name: 'Delete', exact: true }).press('Enter');
  await expect(canvas.getByRole('button', { name: 'Complete Synthetic apples', exact: true })).toHaveCount(0);
  await expect(canvas.getByRole('alertdialog')).toHaveCount(0);
  await canvas.getByRole('button', { name: 'Back in app preview' }).click();
  await canvas.getByRole('button', { name: /^To-Do/ }).click();
  await canvas.getByRole('button', { name: 'Edit Synthetic admin item', exact: true }).click();
  await canvas.getByRole('dialog', { name: 'Edit Task simulation' }).getByLabel('Task Name', { exact: true }).fill('Renamed admin fixture');
  await canvas.getByRole('dialog', { name: 'Edit Task simulation' }).getByRole('button', { name: 'Save', exact: true }).click();
  await canvas.getByLabel('Actions for Renamed admin fixture', { exact: true }).click();
  await expect(canvas.locator('.chore-menu[open]').getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
});
