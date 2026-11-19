import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { integrationDocument, integrationSnapshot } from '../flows-canvas/integration/fixture';
import { isPhone, openLibrary, previewRoot, seed, waitForWorkspace } from './workspace2-helpers';
import { liftField } from '../../src/workspace2/logic-fields/registry';
import { readStudioCanvas } from '../../src/shared/composition/studio-logic/layout';
import { compileCompositionDocument } from '../../src/shared/composition/compiler';
import type { CompositionPublication } from '../../src/shared/composition/schema';
import { contrast, parseColor } from '../../src/workspace2/theme';

const mount = process.env.STUDIO_E2E_PROD ? '/api/hassio_ingress/w2-i/' : '/';
const canvas = (page: Page) => page.locator('.w2-logic-overlay');
const props = (page: Page) => page.getByLabel('Properties', { exact: true });
test.use({ actionTimeout: 10_000 });

test.beforeEach(async ({ page, request, baseURL }) => {
  await seed(request, integrationDocument());
  if (mount !== '/') await page.route(`**${mount}**`, async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}/${url.pathname.slice(mount.length)}${url.search}` });
    await route.fulfill({ response });
  });
  await page.route('**/api/native-home', route => route.fulfill({ json: integrationSnapshot }));
});
async function open(page: Page) { await page.goto(mount); await waitForWorkspace(page); }
async function flows(page: Page) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    return page.locator('.w2-data');
  }
  await openLibrary(page, 'Flows');
  return page.getByTestId('flows-panel');
}
async function reveal(panel: ReturnType<Page['locator']>, title: string) {
  const group = panel.getByRole('button', { name: new RegExp(`^${title}, \\d+$`) });
  if (await group.count() && await group.getAttribute('aria-expanded') === 'false') await group.click();
}
async function select(page: Page, id: string) {
  await previewRoot(page).locator(`[data-sel="node:${id}"]`).click({ position: { x: 8, y: 8 } });
  await expect(props(page)).toBeVisible();
}
async function condition(page: Page, id: string) {
  await select(page, id);
  const field = props(page).locator('[data-testid=logic-field][data-field-kind=condition]').first();
  const disclosure = props(page).getByRole('button', { name: /^Only show when/ });
  const advanced = props(page).locator('.w2-advanced > button[aria-expanded=false]');
  if (!await field.isVisible() && !await disclosure.isVisible() && await advanced.count()) await advanced.click();
  if (!await field.isVisible() && await disclosure.isVisible()) await disclosure.click();
  await expect(field).toBeVisible();
  return field;
}
async function closeProperties(page: Page) {
  await expect(async () => {
    const done = props(page).getByRole('button', { name: 'Done', exact: true });
    if (await done.isVisible()) await done.click({ timeout: 1_000 });
    const close = props(page).getByRole('button', { name: 'Close', exact: true });
    if (await close.isVisible()) await close.click({ timeout: 1_000 });
    await expect(props(page)).not.toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
async function shot(page: Page, scheme: string, subject: string) {
  if (!process.env.STUDIO_EVIDENCE_DIR) return;
  await mkdir(process.env.STUDIO_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.STUDIO_EVIDENCE_DIR}/${isPhone(page) ? 'phone' : 'desktop'}-${scheme}-${subject}.png`, animations: 'disabled' });
}
async function closeCanvas(page: Page) {
  await canvas(page).getByRole('button', { name: 'Close canvas', exact: true }).click();
  await expect(canvas(page)).toHaveCount(0);
}
async function closePalette(page: Page) {
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}
async function template(page: Page) {
  const panel = await flows(page);
  await reveal(panel, 'Templates');
  await panel.getByRole('button', { name: /^Room words/ }).first().click();
  return page.getByTestId('logic-editor');
}

for (const scheme of ['light', 'dark'] as const) test(`${scheme}: inline checks, canvas simulation, canonical save/reopen, lenses and publish`, async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems: string[] = [], deviceWrites: string[] = [], routes: string[] = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/native/')) routes.push(path);
    if (request.method() !== 'GET' && /\/(call-service|call_service|services\/)/.test(path)) deviceWrites.push(path);
  });
  await open(page);
  const before = (await (await request.get('/native/api/draft')).json()).document;
  const panel = await flows(page);
  await shot(page, scheme, 'logic-tab');
  if (isPhone(page)) await page.keyboard.press('Escape');

  const tile = previewRoot(page).locator('[data-sel="node:inline"] .sh-tile');
  const surface = () => tile.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.background, color: style.color, text: element.textContent };
  });
  const unselected = await surface();
  expect(unselected.background).toContain('gradient');
  await tile.hover();
  expect(await surface()).toEqual(unselected);
  const single = await condition(page, 'inline');
  expect(await surface()).toEqual(unselected);
  await expect(single.getByRole('button', { name: '+ And…', exact: true })).toBeVisible();
  await expect(props(page).getByRole('heading', { name: 'Only Show When', exact: true })).toBeVisible();
  await expect(single.locator(':scope > .w2-row-label')).toHaveCount(0);
  await expect(single.getByRole('button', { name: 'Entity', exact: true })).toHaveText('Window');
  await expect(single.getByRole('button', { name: 'Value', exact: true })).toHaveText('Open');
  await expect(single.getByTestId('result-line')).toContainText(/No.*Window is Closed right now.*Live/);
  await expect(single.locator('.w2-picker-secondary')).toHaveCount(0);
  await expect(single.getByRole('combobox', { name: 'Read', exact: true })).toHaveCount(0);
  await expect(props(page).getByRole('radiogroup', { name: 'Condition view' })).toHaveCount(0);
  await expect(props(page).getByRole('radiogroup', { name: /If it can.t tell/ })).toBeVisible();
  await single.getByRole('button', { name: '+ And…', exact: true }).scrollIntoViewIfNeeded();
  await expect(single.getByTestId('simple-condition')).toBeInViewport();
  await shot(page, scheme, 'one-check-inline');
  await single.getByRole('button', { name: '+ And…', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await closePalette(page);
  await expect(canvas(page).getByRole('button', { name: /^Select Entity State/ })).toHaveCount(2);
  await expect(canvas(page).getByRole('button', { name: 'Apply to draft', exact: true })).toBeEnabled();
  await canvas(page).getByRole('button', { name: 'Close canvas', exact: true }).click();
  await expect(canvas(page)).toHaveCount(0);
  expect((await (await request.get('/native/api/draft')).json()).document).toEqual(before);
  await single.getByRole('button', { name: '+ Or…', exact: true }).click();
  await closePalette(page);
  await expect(canvas(page).getByRole('button', { name: /^Select Any Of/ })).toBeVisible();
  await expect(canvas(page).getByRole('button', { name: /^Select Entity State/ })).toHaveCount(2);
  await closeCanvas(page);
  await closeProperties(page);

  const many = await condition(page, 'summary');
  await expect(many.getByTestId('logic-field-summary')).toBeVisible();
  await expect(many.getByRole('img', { name: /^Logic mini-map:/ })).toBeVisible();
  await expect(many.locator('figcaption')).toContainText('Window is Open and the person using the app is an admin');
  await expect(many.locator('.w2-logic-map-label strong', { hasText: 'Window' }).first()).toBeVisible();
  await expect(many.getByLabel('Logic status')).toHaveText('Uses 3 blocks');
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await many.getByRole('button', { name: 'Edit in Canvas', exact: true }).scrollIntoViewIfNeeded();
  await expect(many.getByRole('button', { name: 'Edit in Canvas', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(many.getByTestId('logic-field-summary')).toBeInViewport();
  const viewerLabel = many.locator('.w2-logic-map-label strong', { hasText: /^Viewer Matches$/ });
  await expect(viewerLabel).toBeVisible();
  const labelSize = await viewerLabel.evaluate(element => ({
    width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight,
    contentHeight: element.scrollHeight, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(labelSize.contentWidth).toBeLessThanOrEqual(labelSize.width);
  expect(labelSize.contentHeight).toBeLessThanOrEqual(labelSize.height);
  expect(labelSize.height).toBeLessThanOrEqual(labelSize.lineHeight * 2 + 1);
  await expect(many.getByRole('img', { name: /Logic mini-map:.*Viewer Matches/ })).toBeVisible();
  await shot(page, scheme, 'multi-check-summary');
  await closeProperties(page);

  const editor = await template(page);
  await expect(editor.getByText('Used by', { exact: true })).toBeVisible();
  await expect(editor.getByTestId('logic-body')).toBeVisible();
  await expect(editor.getByTestId('result-line')).toContainText('Shows "closed", worked out with each setting’s Try With value.');
  await expect(editor.getByRole('img', { name: /^Logic mini-map:/ })).toBeVisible();
  await expect(editor.locator('.w2-logic-map')).not.toContainText('graph-setting');
  await editor.getByRole('button', { name: 'Edit in Canvas', exact: true }).first().scrollIntoViewIfNeeded();
  await expect(editor.getByRole('button', { name: 'Edit in Canvas', exact: true }).first()).toBeInViewport();
  await shot(page, scheme, 'templates-and-uses');
  await editor.getByRole('button', { name: 'Edit in Canvas', exact: true }).first().click();
  await expect(canvas(page)).toBeVisible();
  await closePalette(page);
  const backdrop = page.locator('.w2-logic-backdrop');
  const backdropStyle = await backdrop.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.backgroundColor, opacity: style.opacity };
  });
  expect(parseColor(backdropStyle.color)?.a).toBe(1);
  expect(backdropStyle.opacity).toBe('1');
  expect(await backdrop.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await canvas(page).getByText('Simulation · Studio only', { exact: true }).click();
  await expect(canvas(page).getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas(page).getByText('Waiting for Home Assistant. Showing the last values.', { exact: true })).toBeVisible();
  await expect(canvas(page).getByText('Canvas preview', { exact: true })).toHaveCount(0);
  const block = canvas(page).getByRole('button', { name: /^Select Attribute/ });
  const initialPosition = await block.locator('..').getAttribute('style');
  await block.click();
  await page.getByText('Position', { exact: true }).click();
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill(String(Number(await x.inputValue()) + 32));
  await page.getByRole('button', { name: 'Set position', exact: true }).click();
  await page.getByRole('button', { name: 'Close block inspector', exact: true }).first().click();
  await expect(block.locator('..')).not.toHaveAttribute('style', initialPosition!);
  await canvas(page).getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(canvas(page).locator('.w2-canvas-footer [role=status]')).toContainText('Edits applied to the draft');
  const apply = canvas(page).getByRole('button', { name: 'Apply to draft', exact: true });
  await apply.hover();
  const applyStyle = await apply.evaluate(element => {
    const style = getComputedStyle(element);
    return { ink: style.color, fill: style.backgroundColor, opacity: style.opacity };
  });
  expect(applyStyle.opacity).toBe('1');
  expect(contrast(parseColor(applyStyle.ink)!, parseColor(applyStyle.fill)!), `${applyStyle.ink} on ${applyStyle.fill}`).toBeGreaterThanOrEqual(4.5);
  if (isPhone(page)) await canvas(page).getByRole('group', { name: 'Simulation mode', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, scheme, 'canvas-simulation');
  await canvas(page).getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(canvas(page).locator('.w2-canvas-footer [role=status]')).toContainText('Draft saved');
  const saved = (await (await request.get('/native/api/draft')).json()).document;
  expect(saved.logicUseBindings).toEqual(before.logicUseBindings);
  expect(readStudioCanvas(saved).warnings).toEqual([]);
  expect(saved.studioCanvas.version).toBe(2);
  const metadata = JSON.stringify(saved.studioCanvas);
  await closeCanvas(page);
  await page.reload(); await waitForWorkspace(page);
  const reopened = await template(page);
  await reopened.getByRole('button', { name: 'Edit in Canvas', exact: true }).first().click();
  await closePalette(page);
  await expect(canvas(page).getByRole('button', { name: /^Select Attribute/ }).locator('..')).not.toHaveAttribute('style', initialPosition!);
  await canvas(page).getByRole('combobox', { name: 'Preview lens' }).click();
  await page.getByRole('option', { name: 'Stand-in', exact: true }).click();
  await expect(canvas(page).getByRole('article', { name: 'Stand-in field preview' })).toBeVisible();
  await canvas(page).getByRole('combobox', { name: 'Preview lens' }).click();
  await expect(page.getByRole('option', { name: /^A use:.*First room/ }).first()).toBeVisible();
  const useOptions = await page.getByRole('option').allTextContents();
  expect(useOptions.join(' ')).toContain('First room');
  expect(useOptions.join(' ')).toContain('Second room');
  await page.getByRole('option', { name: /^A use:.*First room/ }).first().click();
  await closeCanvas(page);
  expect(JSON.stringify((await (await request.get('/native/api/draft')).json()).document.studioCanvas)).toBe(metadata);
  expect(liftField(saved, ['logicLibrary', 0, 'body'], 'operand').graph.roots[0].anchor).toMatchObject({ kind: 'logic', id: 'tile-label', field: '/body' });
  await closeProperties(page);
  if (isPhone(page)) {
    const project = page.getByRole('dialog', { name: 'Project', exact: true });
    if (await project.isVisible()) await page.keyboard.press('Escape');
  }
  const publicationBefore = await (await request.get('/native/api/published')).json();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await shot(page, scheme, 'publish');
  const dialog = page.getByRole('dialog', { name: 'Publish to the App?', exact: true });
  // The fake publication service is deliberately not a physical Home Assistant.
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await (await request.get('/native/api/published')).json()).toEqual(publicationBefore);
  const current = await (await request.get('/native/api/draft')).json();
  let published: CompositionPublication | undefined;
  // Fake only the HA transport; the actual UI action still uses the real publication compiler and persistence.
  await page.route('**/native/api/ha/publish', async route => {
    expect(new URL(route.request().url()).pathname).toBe(`${mount}native/api/ha/publish`);
    const response = await request.post('/native/api/publish', { data: route.request().postDataJSON() });
    expect(response.status()).toBe(200);
    published = await response.json() as CompositionPublication;
    await route.fulfill({ json: { epoch: 'fixture-only', revision: published.revision, envelopeSha256: 'a'.repeat(64) } });
  });
  await page.getByTestId('workspace2').getByRole('button', { name: 'Publish', exact: true }).click();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(published).toBeDefined();
  const json = JSON.stringify(published);
  for (const forbidden of ['logic-ref', '"hole"', 'logicLibrary', 'studioCanvas', 'logicUseBindings']) expect(json).not.toContain(forbidden);
  expect(published!.document).toEqual(compileCompositionDocument(current.document).expanded);
  expect(deviceWrites).toEqual([]);
  expect(problems).toEqual([]);
  expect(routes.every(path => path.startsWith(mount))).toBe(true);
});

test('a non-tile field uses explicit template arguments; tile uses resolve independently; unlink survives reload', async ({ page, request }) => {
  await open(page);
  await select(page, 'standalone');
  const primary = () => props(page).locator('[data-field-path$="/primary"] [data-testid=value-field]');
  await primary().click();
  const field = props(page).getByTestId('value-editor');
  await field.getByRole('button', { name: 'Use Template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Use a Logic Template', exact: true });
  await dialog.getByRole('combobox', { name: 'Template', exact: true }).selectOption('tile-label');
  await expect(dialog.getByRole('button', { name: 'Use Template', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Entity', exact: true }).selectOption('source-b');
  await dialog.getByRole('button', { name: 'Use Template', exact: true }).click();
  await expect(field.getByTestId('logic-use')).toBeVisible();
  await props(page).getByRole('button', { name: 'Done', exact: true }).click();
  const draft = async () => (await (await request.get('/native/api/draft')).json()).document;
  await expect.poll(async () => (await draft()).pages[0].components[5].props.primary.value.type).toBe('logic-ref');
  const saved = await draft();
  expect(saved.pages[0].components[5].props.primary.value.args).toEqual({ source: 'source-b' });
  const response = await request.post('/native/api/draft/prepare', { data: { document: saved } });
  expect(response.ok()).toBe(true);
  const prepared = await response.json();
  expect(prepared.expanded.pages[0].components[0].props.subtitle.value.from.sourceId).toBe('source-a');
  expect(prepared.expanded.pages[0].components[1].props.subtitle.value.from.sourceId).toBe('source-b');
  await primary().click();
  await field.getByTestId('logic-use').getByRole('button', { name: 'Unlink From Template', exact: true }).click();
  await props(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await draft()).pages[0].components[5].props.primary.value.type).toBe('read');
  const unlinked = await draft();
  expect(unlinked.pages[0].components[5].props.primary.value.from.sourceId).toBe('source-b');
  expect(unlinked.logicUseBindings).toEqual(saved.logicUseBindings);
  expect(unlinked.logicLibrary).toEqual(saved.logicLibrary);
  await page.reload(); await waitForWorkspace(page);
  expect(await draft()).toEqual(unlinked);
});

test('a real 409 preserves local canvas layout and bindings until Keep Mine explicitly saves', async ({ page, request }) => {
  await open(page);
  const editor = await template(page);
  await editor.getByRole('button', { name: 'Edit in Canvas', exact: true }).first().click();
  await closePalette(page);
  const block = canvas(page).getByRole('button', { name: /^Select Attribute/ });
  await block.click();
  await page.getByText('Position', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'X', exact: true }).fill('456');
  await page.getByRole('button', { name: 'Set position', exact: true }).click();
  await page.getByRole('button', { name: 'Close block inspector', exact: true }).first().click();
  let inserted = false;
  let attempted: ReturnType<typeof integrationDocument> | undefined;
  await page.route('**/native/api/draft', async route => {
    if (route.request().method() === 'PUT') {
      attempted = route.request().postDataJSON().document;
      if (!inserted) {
        inserted = true;
        const remote = await (await request.get('/native/api/draft')).json();
        const update = await request.put('/native/api/draft', { data: { expectedRevision: remote.revision, document: { ...remote.document, name: 'Concurrent remote edit' } } });
        expect(update.status()).toBe(200);
      }
    }
    await route.fallback();
  });
  await canvas(page).getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(canvas(page).locator('.w2-canvas-footer [role=status]')).toContainText('Edits applied');
  await canvas(page).getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(canvas(page).locator('.w2-canvas-footer [role=status]')).toContainText('Save conflict: local draft retained');
  expect(attempted?.studioCanvas).toBeDefined();
  expect(attempted?.logicUseBindings).toEqual(integrationDocument().logicUseBindings);
  const localLayout = attempted!.studioCanvas;
  expect((await (await request.get('/native/api/draft')).json()).document.studioCanvas).toBeUndefined();
  await closeCanvas(page);
  const conflict = page.getByRole('dialog', { name: 'This Draft Changed Somewhere Else', exact: true });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(conflict).toHaveCount(0);
  const kept = (await (await request.get('/native/api/draft')).json()).document;
  expect(kept.studioCanvas).toEqual(localLayout);
  expect(kept.name).toBe('Flows integration');
  expect(kept.logicUseBindings).toEqual(attempted!.logicUseBindings);
  await page.reload(); await waitForWorkspace(page);
  expect((await (await request.get('/native/api/draft')).json()).document).toEqual(kept);
});

test('existing request formula displays, edits, saves and reopens without turning into an empty literal', async ({ page, request }) => {
  await open(page);
  const panel = await flows(page);
  await reveal(panel, 'Flows');
  await panel.getByRole('button', { name: /^Existing formula/ }).first().click();
  const editor = page.getByTestId('flow-editor');
  const field = editor.getByTestId('request-section').getByTestId('logic-field');
  await expect(field).toContainText('2 + 3');
  await expect(field.getByTestId('logic-field-summary')).toHaveCount(0);
  await field.getByRole('button', { name: 'Edit in Canvas', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await closePalette(page);
  await expect(canvas(page).getByRole('button', { name: /^Select (Add|Math)/ })).toBeVisible();
  await closeCanvas(page);
  await page.reload(); await waitForWorkspace(page);
  const saved = (await (await request.get('/native/api/draft')).json()).document;
  const original = integrationDocument().dataSources[2];
  if (original.kind !== 'model' || original.model !== 'pipeline@1' || original.inputs.request.type !== 'none') throw new Error('The fixture must hold an existing formula.');
  expect(saved.dataSources[2].inputs.request.value).toEqual(original.inputs.request.value);
});
