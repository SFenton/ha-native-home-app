import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, test as base, type APIRequestContext, type BrowserContext, type CDPSession, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mobileDescendants, mobileEditorDocument, mobileViewports } from '../fixtures/mobile-editor';
import type { DraftEnvelope, StudioDocument } from '../../src/shared/types';

const origin = 'http://127.0.0.1:4801';
type Pane = 'Project' | 'Preview' | 'Inspect';
const project = (page: Page) => page.getByRole('complementary', { name: 'Project navigation and component library', exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Properties inspector', exact: true });
const canvas = (page: Page) => page.getByRole('region', { name: 'Device canvas', exact: true });
const node = (page: Page, id: string) => canvas(page).locator(`[data-component-id="${id}"]`);

async function guardRequests(context: BrowserContext) {
  const forbidden: string[] = [];
  const localAPIs = new Set(['/api/health', '/api/draft', '/api/validate', '/api/export']);
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || (url.pathname.startsWith('/api/') && !localAPIs.has(url.pathname))) {
      forbidden.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    } else {
      await route.continue();
    }
  });
  return forbidden;
}

const test = base.extend<{ safety: void }>({
  safety: [async ({ context, baseURL }, use) => {
    expect(baseURL, 'Never run this fixture against the interactive studio').toBe(origin);
    const forbidden = await guardRequests(context);
    await use();
    expect(forbidden, 'No external, live-data, camera, or real service requests are permitted').toEqual([]);
  }, { auto: true }],
});

test.use({ hasTouch: true, trace: 'on', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

async function draft(request: APIRequestContext): Promise<DraftEnvelope> {
  const response = await request.get(`${origin}/api/draft`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function install(request: APIRequestContext, document = mobileEditorDocument()) {
  const current = await draft(request);
  const response = await request.put(`${origin}/api/draft`, { data: { document, expectedRevision: current.revision } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await install(request);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
  const metrics = await page.evaluate(() => {
    const measure = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      return {
        tag: element.tagName, label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 100),
        rect: { x, y, width, height }, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
        hitTag: hit?.tagName, hitClass: hit?.getAttribute('class'), centerHitsSelf: hit ? element.contains(hit) : false,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY },
      root: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      focus: document.activeElement ? measure(document.activeElement) : null,
      panes: [...document.querySelectorAll('[data-editor-pane]:not([hidden])')].map(measure),
      notices: [...document.querySelectorAll('.notice-stack,.notice-stack .notice')].map(measure),
      projectCommands: [...document.querySelectorAll('.sidebar-footer button')].map(measure),
    };
  });
  await testInfo.attach('failure-viewport-hit-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});

async function pane(page: Page, name: Pane) {
  const panel = page.getByRole('region', { name: `${name} pane`, exact: true });
  const button = page.getByRole('navigation', { name: 'Editor panes', exact: true }).getByRole('button', { name, exact: true });
  if (!await panel.isVisible() || await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await expect(panel).toBeVisible();
}

async function projectBrowser(page: Page) {
  await pane(page, 'Project');
  const back = page.getByRole('button', { name: 'Back to project', exact: true });
  if (await back.isVisible()) await back.click();
  await expect(project(page)).toBeVisible();
}

async function inViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box!.x, 'left edge').toBeGreaterThanOrEqual(-1);
  expect(box!.y, 'top edge').toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, 'right edge').toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height, 'bottom edge').toBeLessThanOrEqual(viewport.height + 1);
}

async function reachable(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await inViewport(page, locator);
  if (await locator.isEnabled()) await locator.click({ trial: true });
}

async function noDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
    scrollX: window.scrollX,
  }));
  expect(overflow.root, 'document horizontal overflow').toBeLessThanOrEqual(1);
  expect(overflow.body, 'body horizontal overflow').toBeLessThanOrEqual(1);
  expect(overflow.scrollX).toBe(0);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function editorDocument(page: Page): Promise<StudioDocument> {
  await pane(page, 'Preview');
  await page.getByRole('button', { name: 'View and edit source', exact: true }).click();
  const value: StudioDocument = JSON.parse(await page.getByRole('textbox', { name: 'Document source', exact: true }).inputValue());
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  return value;
}

async function selectLayer(page: Page, title: string) {
  await projectBrowser(page);
  await project(page).getByRole('tab', { name: 'Project', exact: true }).click();
  await project(page).getByRole('button', { name: title, exact: true }).click();
}

async function moveDialog(page: Page, title: string) {
  await projectBrowser(page);
  await project(page).getByRole('button', { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to...', exact: true }).click();
  return page.getByRole('dialog', { name: `Move ${title}`, exact: true });
}

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

type TouchPoint = { x: number; y: number; id: number };
const activeTouchSessions = new WeakSet<CDPSession>();
async function touches(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: TouchPoint[]) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(point => ({ ...point, radiusX: 4, radiusY: 4, force: 1 })),
  });
  if (type === 'touchEnd' || type === 'touchCancel') activeTouchSessions.delete(session);
  else activeTouchSessions.add(session);
}

async function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', point?: { x: number; y: number }) {
  await touches(session, type, point ? [{ ...point, id: 1 }] : []);
}

async function touchMove(page: Page, session: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  for (let step = 1; step <= 12; step++) {
    await touch(session, 'touchMove', { x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12 });
    await page.waitForTimeout(20);
  }
}

async function holdDrag(page: Page, session: CDPSession, source: Locator) {
  const point = await center(source);
  await touch(session, 'touchStart', point);
  // This is a deliberate long press, not a wait for application/network readiness.
  await page.waitForTimeout(650);
  await touchMove(page, session, point, { x: point.x + 8, y: point.y + 8 });
  return { x: point.x + 8, y: point.y + 8 };
}

for (const viewport of mobileViewports) {
  test(`M2 viewport ${viewport.name} ${viewport.width}x${viewport.height}: panes and complete controls remain reachable`, async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    const saved = await draft(request);
    const writes: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/api\/(draft|publish|import)(?:[/?]|$)/.test(request.url())) writes.push(request.method() + ' ' + request.url());
    });

    await pane(page, 'Project');
    await project(page).scrollIntoViewIfNeeded();
    await inViewport(page, project(page));
    for (const name of ['Navigation & theme', 'Data sources', 'Variables & conditions']) {
      await reachable(page, project(page).getByRole('button', { name: new RegExp(`^${name}`) }));
    }
    await noDocumentOverflow(page);
    if (['small', 'ordinary', 'keyboard-like', 'wide'].includes(viewport.name)) await screenshot(page, testInfo, `${viewport.name}-project`);

    await pane(page, 'Inspect');
    await inspector(page).scrollIntoViewIfNeeded();
    await inViewport(page, inspector(page));
    const inspectorMetrics = await page.getByRole('region', { name: 'Inspect pane', exact: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const header = element.querySelector<HTMLElement>('.inspector-header');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        pane: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        headerPosition: header ? getComputedStyle(header).position : null,
        root: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        bodyScrollWidth: document.body.scrollWidth,
        notifications: document.querySelectorAll('.notice-stack .notice').length,
      };
    });
    await testInfo.attach('inspector-viewport-metrics', { body: JSON.stringify(inspectorMetrics, null, 2), contentType: 'application/json' });
    if (viewport.name === 'small') {
      expect(inspectorMetrics.pane.height, '180 CSS px is our short-height editor pane design minimum').toBeGreaterThanOrEqual(180);
    }
    await reachable(page, inspector(page).getByRole('button', { name: 'Add header action', exact: true }));
    await inspector(page).locator('summary').filter({ hasText: /^App theme$/ }).click();
    await reachable(page, inspector(page).getByLabel('Text scale', { exact: true }));
    await noDocumentOverflow(page);
    if (['small', 'ordinary', 'keyboard-like', 'wide'].includes(viewport.name)) await screenshot(page, testInfo, `${viewport.name}-inspect-bottom`);

    await pane(page, 'Preview');
    await canvas(page).scrollIntoViewIfNeeded();
    await inViewport(page, canvas(page));
    if (viewport.name === 'wide') {
      await inViewport(page, project(page));
      await inViewport(page, inspector(page));
    } else if (['unfolded-like-small', 'unfolded-like-large', 'ipad-like-portrait', 'ipad-like-landscape', 'landscape'].includes(viewport.name)) {
      expect(Number(await project(page).isVisible()) + Number(await inspector(page).isVisible()), 'One coordinated side pane, not three squeezed columns').toBe(1);
    } else {
      await expect(project(page)).toHaveCount(0);
      await expect(inspector(page)).toHaveCount(0);
    }
    await page.getByLabel('Preview device', { exact: true }).selectOption('duo');
    await page.getByRole('button', { name: 'View controls', exact: true }).click();
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    for (const label of ['Preview device', 'Device theme', 'Preview data state', 'Fold angle', 'Device yaw', 'Device pitch']) {
      await reachable(page, page.getByLabel(label, { exact: true }));
    }
    for (const name of [
      'Opaque chrome', 'Rotate device 90 degrees counterclockwise', 'Rotate device 90 degrees clockwise',
      '3D', 'View controls', 'Fit', 'Zoom out', 'Reset preview zoom to 100 percent', 'Zoom in',
      'Closed', 'Partial', 'Open', 'Reset view',
    ]) await reachable(page, page.getByRole('button', { name, exact: true }));
    for (const name of ['Save', 'Undo', 'Redo']) {
      await reachable(page, page.getByRole('button', { name, exact: true }));
    }
    await noDocumentOverflow(page);
    if (['small', 'ordinary', 'unfolded-like-small', 'ipad-like-landscape', 'keyboard-like', 'wide'].includes(viewport.name)) {
      await screenshot(page, testInfo, `${viewport.name}-preview`);
    }
    expect(writes, 'Pane and device controls must not persist configuration').toEqual([]);
    expect(await draft(request)).toEqual(saved);
  });
}

test('M2 mounted panes retain selection, uncommitted JSON, title, mode, and preview geometry through width changes', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await pane(page, 'Preview');
  await page.getByLabel('Preview device', { exact: true }).selectOption('ipad');
  const geometry = await page.locator('.device-screen').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  await node(page, 'mobile-first').click();
  await expect(inspector(page)).toHaveCount(0);
  await pane(page, 'Inspect');
  await inspector(page).getByLabel('Title', { exact: true }).fill('Unsaved mobile title');
  await inspector(page).locator('summary').filter({ hasText: /^Advanced properties$/ }).click();
  const rawProps = inspector(page).getByRole('textbox', { name: /^Component props JSON(?:\s|$)/ });
  await rawProps.fill('{"unfinished":');
  const mountedRawProps = await rawProps.elementHandle();
  const mountedInspector = await inspector(page).elementHandle();
  const mountedProject = await page.getByRole('complementary', { name: 'Project navigation and component library', includeHidden: true }).elementHandle();
  const mountedCanvas = await page.getByRole('region', { name: 'Device canvas', includeHidden: true }).elementHandle();
  for (const size of [{ width: 752, height: 768 }, { width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await pane(page, 'Inspect');
    await rawProps.focus();
    await rawProps.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 8));
    await page.setViewportSize(size);
    await expect(inspector(page), 'Resize must retain the active pane without a reveal command').toBeVisible();
    await expect(rawProps).toBeFocused();
    expect(await mountedInspector!.evaluate(element => element.isConnected)).toBe(true);
    expect(await mountedProject!.evaluate(element => element.isConnected)).toBe(true);
    expect(await mountedCanvas!.evaluate(element => element.isConnected)).toBe(true);
    expect(await mountedRawProps!.evaluate(element => element.isConnected)).toBe(true);
    expect(await rawProps.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([3, 8]);
    await expect(inspector(page).getByLabel('Title', { exact: true })).toHaveValue('Unsaved mobile title');
    await expect(rawProps).toHaveValue('{"unfinished":');
    await inViewport(page, rawProps);
    await pane(page, 'Preview');
    await expect(page.getByLabel('Preview device', { exact: true })).toHaveValue('ipad');
    expect(await page.locator('.device-screen').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))).toEqual(geometry);
    await expect(node(page, 'mobile-first')).toHaveClass(/is-selected/);
    await noDocumentOverflow(page);
  }
  await screenshot(page, testInfo, 'retained-compact-selection');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await pane(page, 'Project');
  await pane(page, 'Preview');
  await expect(node(page, 'mobile-first')).not.toHaveAttribute('role', 'button');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  expect((await draft(request)).document.pages[0].components[0].title).toBe('First item');
});

test('M4 focused raw source dialog survives resize and Escape restores its invoker without applying edits', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  const before = await editorDocument(page);
  const sourceButton = page.getByRole('button', { name: 'View and edit source', exact: true });
  await sourceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Your experience, in code', exact: true });
  const source = dialog.getByRole('textbox', { name: 'Document source', exact: true });
  const rawDraft = '{"name": "Uncommitted source draft", "unfinished":';
  await source.fill(rawDraft);
  const mountedSource = await source.elementHandle();
  for (const viewport of [{ width: 752, height: 768 }, { width: 390, height: 320 }, { width: 320, height: 568 }]) {
    await source.focus();
    await source.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(9, 20));
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect(source).toBeFocused();
    await expect(source).toHaveValue(rawDraft);
    expect(await mountedSource!.evaluate(element => element.isConnected)).toBe(true);
    expect(await source.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([9, 20]);
    await noDocumentOverflow(page);
    await reachable(page, dialog.getByRole('button', { name: 'Close dialog', exact: true }));
    await reachable(page, dialog.getByRole('button', { name: 'Validate & apply', exact: true }));
    await reachable(page, dialog.getByRole('button', { name: 'Cancel', exact: true }));
    if (viewport.height === 320) await screenshot(page, testInfo, 'focused-source-dialog-short-height');
  }
  const tabFocus = [];
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press(key);
      const focus = await dialog.evaluate(element => ({
        within: element.contains(document.activeElement),
        documentFocused: document.hasFocus(),
        activeTag: document.activeElement?.tagName,
      }));
      tabFocus.push({ key, index, ...focus });
      expect(focus.within || (!focus.documentFocused && focus.activeTag === 'BODY'), 'Native modal must not focus background page controls; browser chrome is allowed').toBe(true);
    }
  }
  await testInfo.attach('native-dialog-tab-focus', { body: JSON.stringify(tabFocus, null, 2), contentType: 'application/json' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(sourceButton).toBeFocused();
  expect(await editorDocument(page)).toEqual(before);
  expect((await draft(request)).document).toEqual(before);
});

test('M3 touch quick Insert coexists with canvas; tap insertion, selection, and undo/redo stay local', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await pane(page, 'Preview');
  await page.getByRole('button', { name: 'Insert', exact: true }).tap();
  await inViewport(page, canvas(page));
  const add = page.getByRole('region', { name: 'Quick insert components', exact: true }).locator('.palette-add').filter({ hasText: /^Text/ });
  await reachable(page, add);
  await add.tap();
  await expect(canvas(page).locator('[data-component-id]')).toHaveCount(9);
  await expect(inspector(page)).toHaveCount(0);
  await pane(page, 'Inspect');
  await inspector(page).getByLabel('Title', { exact: true }).fill('Touch inserted text');
  await pane(page, 'Preview');
  const added = canvas(page).getByRole('button', { name: 'Select Touch inserted text', exact: true });
  await added.tap();
  await expect(added).toHaveClass(/is-selected/);
  await screenshot(page, testInfo, 'compact-tap-insertion');
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(canvas(page).getByRole('button', { name: 'Select Text', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(canvas(page).locator('[data-component-id]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Redo', exact: true }).tap();
  await expect(canvas(page).locator('[data-component-id]')).toHaveCount(9);
  expect((await draft(request)).document).toEqual(mobileEditorDocument());
});

test('M3 touch delayed canvas drag nests with a cue, handle drag places after, and touch cancellation preserves edits', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await pane(page, 'Preview');
  const session = await context.newCDPSession(page);
  try {
    let from = await holdDrag(page, session, node(page, 'mobile-first').locator('.native-text'));
    const drop = node(page, 'mobile-group').locator('.canvas-group-drop');
    await expect(drop).toContainText('Drop inside Nested group');
    let to = await center(drop);
    await touchMove(page, session, from, to);
    await expect(drop).toHaveClass(/over/);
    await screenshot(page, testInfo, 'touch-nested-drop-cue');
    await touch(session, 'touchEnd');
    await expect(node(page, 'mobile-group').locator('[data-component-id="mobile-first"]')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(node(page, 'mobile-group').locator('[data-component-id="mobile-first"]')).toHaveCount(0);

    from = await holdDrag(page, session, node(page, 'mobile-first').getByRole('button', { name: 'Drag First item on canvas', exact: true }));
    const destination = node(page, 'mobile-second');
    const box = await destination.boundingBox();
    expect(box).not.toBeNull();
    to = { x: box!.x + box!.width / 2, y: box!.y + box!.height - 2 };
    await touchMove(page, session, from, to);
    await expect(destination.locator(':scope > [data-drop-placement="after"][data-drop-active="true"]')).toBeVisible();
    await touch(session, 'touchEnd');
    const order = () => canvas(page).locator('.native-page-content > .native-layout > [data-component-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-component-id')));
    await expect.poll(order).toEqual(['mobile-second', 'mobile-first', 'mobile-group', 'mobile-service', 'mobile-sheet-link', 'mobile-child-link', 'mobile-shared-link']);
    const beforeCancel = await editorDocument(page);
    from = await holdDrag(page, session, node(page, 'mobile-first').getByRole('button', { name: 'Drag First item on canvas', exact: true }));
    to = await center(node(page, 'mobile-group').locator('.canvas-group-drop'));
    await touchMove(page, session, from, to);
    await touch(session, 'touchCancel');
    await expect(page.locator('[data-drop-active="true"],.canvas-group-drop.over')).toHaveCount(0);
    expect(await editorDocument(page)).toEqual(beforeCancel);
  } finally {
    await session.detach();
  }
});

test('M3 ordinary touch scrolling cancels activation without mutating a long synthetic document', async ({ page, request, context }, testInfo) => {
  await install(request, mobileEditorDocument({ scrollable: true }));
  await page.goto('/');
  await pane(page, 'Preview');
  const before = await editorDocument(page);
  const scroll = canvas(page).locator('.native-scroll.navigation-enter');
  const scrollBefore = await scroll.evaluate(element => element.scrollTop);
  const session = await context.newCDPSession(page);
  try {
    const start = await center(node(page, 'mobile-second').locator('.native-text'));
    await touch(session, 'touchStart', start);
    await touchMove(page, session, start, { x: start.x, y: Math.max(100, start.y - 180) });
    await expect(page.locator('.drag-preview,[data-drop-active="true"],.canvas-group-drop.over'), 'Initial pan intent must not activate dragging').toHaveCount(0);
    await touch(session, 'touchEnd');
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollBefore);
    await page.waitForTimeout(700);
    await expect(page.locator('.drag-preview,[data-drop-active="true"],.canvas-group-drop.over')).toHaveCount(0);
    expect(await editorDocument(page)).toEqual(before);
    expect((await draft(request)).document).toEqual(before);
    await screenshot(page, testInfo, 'touch-scroll-without-drag');
  } finally {
    await session.detach();
  }
});

type TouchObservation = { type: string; count: number; prevented: boolean; cancelable: boolean; trusted: boolean; time: number };
for (const initiator of ['component', 'handle'] as const) {
  for (const phase of ['before-hold', 'active-drag'] as const) {
    test(`M3 multitouch ${initiator} ${phase}: second finger cancels without mutation and single-finger drag recovers`, async ({ page, request, context }, testInfo) => {
      test.setTimeout(60_000);
      await page.goto('/');
      await pane(page, 'Preview');
      const before = await editorDocument(page);
      const observationLog = await page.evaluateHandle(() => {
        const observations: TouchObservation[] = [];
        const dragStarts: number[] = [];
        const workspace = document.querySelector<HTMLElement>('.mobile-workspace');
        if (!workspace) throw new Error('Expected the mounted editor workspace before touch observation');
        new MutationObserver(() => {
          if (workspace.dataset.dragging === 'true') dragStarts.push(performance.now());
        }).observe(workspace, { attributes: true, attributeFilter: ['data-dragging'] });
        for (const type of ['touchstart', 'touchmove', 'touchcancel'] as const) {
          window.addEventListener(type, event => {
            observations.push({
              type, count: event.touches.length, prevented: event.defaultPrevented,
              cancelable: event.cancelable, trusted: event.isTrusted, time: performance.now(),
            });
          }, { passive: true, capture: type !== 'touchmove' });
        }
        return { touches: observations, dragStarts };
      });
      const session = await context.newCDPSession(page);
      try {
        const source = initiator === 'component'
          ? node(page, 'mobile-first').locator('.native-text')
          : node(page, 'mobile-first').getByRole('button', { name: 'Drag First item on canvas', exact: true });
        const first = await center(source);
        const viewport = page.viewportSize()!;
        const second = {
          x: first.x < viewport.width / 2 ? viewport.width - 24 : 24,
          y: Math.min(viewport.height - 24, Math.max(24, first.y + 64)),
        };
        await touch(session, 'touchStart', first);
        if (phase === 'active-drag') {
          // 220ms/8px is the editor's activation policy, not a native gesture guideline.
          await page.waitForTimeout(300);
          await expect(page.locator('.mobile-workspace')).toHaveAttribute('data-dragging', 'true');
          await expect(page.locator('.drag-preview')).toBeVisible();
        }
        await touches(session, 'touchStart', [{ ...first, id: 1 }, { ...second, id: 2 }]);
        if (phase === 'before-hold') {
          const gap = await observationLog.evaluate(({ touches }) => {
            const first = touches.find(event => event.type === 'touchstart' && event.count === 1);
            const second = touches.find(event => event.type === 'touchstart' && event.count === 2);
            if (!first || !second) throw new Error('Expected captured one- and two-finger CDP touchstart events');
            return second.time - first.time;
          });
          expect(gap, 'The regression must actually add its second finger before the 220ms hold').toBeLessThan(220);
        }
        await page.waitForTimeout(300);
        await expect(page.locator('.mobile-workspace')).not.toHaveAttribute('data-dragging', 'true');
        await expect(page.locator('.drag-preview,[data-drop-active="true"],.canvas-group-drop.over')).toHaveCount(0);
        for (let step = 1; step <= 3; step++) {
          await touches(session, 'touchMove', [
            { x: first.x + (first.x < second.x ? -1 : 1) * step * 6, y: first.y, id: 1 },
            { x: second.x + (first.x < second.x ? 1 : -1) * step * 6, y: second.y, id: 2 },
          ]);
        }
        await touch(session, 'touchEnd');
        const observations = await observationLog.jsonValue();
        expect(observations.dragStarts, 'No late timer activation or replacement drag after the second finger').toHaveLength(phase === 'before-hold' ? 0 : 1);
        const multiMoves = observations.touches.filter(event => event.type === 'touchmove' && event.count === 2);
        expect(multiMoves.length, 'Observe real CDP multitouch movement, not JS-dispatched DOM events').toBeGreaterThan(0);
        expect(multiMoves.every(event => event.trusted && !event.prevented), 'Editor must not hijack post-cancellation multifinger movement with preventDefault').toBe(true);
        await testInfo.attach(`${initiator}-${phase}-touch-events`, { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
        expect(await editorDocument(page)).toEqual(before);
        expect((await draft(request)).document).toEqual(before);

        const from = await holdDrag(page, session, node(page, 'mobile-first').getByRole('button', { name: 'Drag First item on canvas', exact: true }));
        const destination = node(page, 'mobile-second');
        const box = await destination.boundingBox();
        expect(box).not.toBeNull();
        await touchMove(page, session, from, { x: box!.x + box!.width / 2, y: box!.y + box!.height - 2 });
        await expect(destination.locator(':scope > [data-drop-placement="after"][data-drop-active="true"]')).toBeVisible();
        await screenshot(page, testInfo, `${initiator}-${phase}-single-finger-recovery`);
        await touch(session, 'touchEnd');
        const after = await editorDocument(page);
        const expected = structuredClone(before);
        [expected.pages[0].components[0], expected.pages[0].components[1]] = [expected.pages[0].components[1], expected.pages[0].components[0]];
        expect(after).toEqual(expected);
        expect((await draft(request)).document).toEqual(before);
      } finally {
        try {
          if (activeTouchSessions.has(session)) await touch(session, 'touchCancel');
        } finally {
          await session.detach();
        }
      }
    });
  }
}

test('M3 explicit layer Actions support before, after, inside, cross-surface placement and cancel', async ({ page }) => {
  await page.goto('/');
  await pane(page, 'Project');
  for (const [position, anchor, expected] of [
    ['after', 'mobile-second', ['mobile-second', 'mobile-first']],
    ['before', 'mobile-second', ['mobile-first', 'mobile-second']],
  ] as const) {
    const dialog = await moveDialog(page, 'First item');
    await dialog.getByRole('combobox', { name: 'Insertion position', exact: true }).selectOption(position);
    await dialog.getByRole('combobox', { name: 'Relative to component', exact: true }).selectOption(anchor);
    await dialog.getByRole('button', { name: 'Move component', exact: true }).tap();
    expect((await editorDocument(page)).pages[0].components.slice(0, 2).map(component => component.id)).toEqual(expected);
  }
  let dialog = await moveDialog(page, 'First item');
  await dialog.getByRole('combobox', { name: 'Insertion position', exact: true }).selectOption('inside');
  await dialog.getByRole('combobox', { name: 'Destination group', exact: true }).selectOption('mobile-group');
  await dialog.getByRole('button', { name: 'Move component', exact: true }).tap();
  expect((await editorDocument(page)).pages[0].components.find(component => component.id === 'mobile-group')?.children?.map(component => component.id)).toEqual(['mobile-child', 'mobile-first']);
  dialog = await moveDialog(page, 'First item');
  await dialog.getByRole('combobox', { name: 'Destination surface', exact: true }).selectOption('modal:mobile-sheet');
  await dialog.getByRole('button', { name: 'Move component', exact: true }).tap();
  const moved = await editorDocument(page);
  expect(mobileDescendants(moved.pages[0].components).some(component => component.id === 'mobile-first')).toBe(false);
  expect(moved.modals[0].components.map(component => component.id)).toEqual(['mobile-sheet-content', 'mobile-first']);
  dialog = await moveDialog(page, 'First item');
  await dialog.getByRole('combobox', { name: 'Destination surface', exact: true }).selectOption('activity:mobile-activity:expanded');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await editorDocument(page)).toEqual(moved);
});

test('M3 inspector action, condition, binding, JSON, sample editing and simulation remain available on compact hosts', async ({ page, request }) => {
  await page.goto('/');
  await selectLayer(page, 'Synthetic light');
  await pane(page, 'Inspect');
  await inspector(page).getByRole('textbox', { name: /^Service data(?:\s|$)/ }).fill('{"brightness_pct":25}');
  await inspector(page).getByLabel('Title', { exact: true }).click();
  await inspector(page).getByLabel('Show only when a condition matches', { exact: true }).check();
  await inspector(page).getByLabel('Variable key', { exact: true }).fill('mobileVisible');
  await inspector(page).getByRole('combobox', { name: 'Data source', exact: true }).selectOption('mobile-sample');
  await inspector(page).getByLabel('Value path', { exact: true }).fill('value');
  await inspector(page).locator('summary').filter({ hasText: /^Advanced properties$/ }).click();
  await inspector(page).getByRole('textbox', { name: /^Component props JSON(?:\s|$)/ }).fill('{"showState":false}');
  await inspector(page).getByLabel('Title', { exact: true }).click();
  const edited = await editorDocument(page);
  expect(edited.pages[0].components.find(component => component.id === 'mobile-service')).toMatchObject({
    action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.mobile_fixture', data: { brightness_pct: 25 } },
    visibility: { source: 'variable', key: 'mobileVisible', operator: 'truthy' },
    binding: { sourceId: 'mobile-sample', path: 'value' }, props: { showState: false },
  });
  await pane(page, 'Inspect');
  await inspector(page).getByRole('combobox', { name: 'Data source', exact: true }).selectOption('');
  await pane(page, 'Project');
  await project(page).getByRole('button', { name: /^Data sources/ }).click();
  await page.getByRole('textbox', { name: /^Sample data JSON(?:\s|$)/ }).fill('{"value":"sample only","count":3}');
  await page.getByLabel('Source name', { exact: true }).click();
  await projectBrowser(page);
  await project(page).getByRole('button', { name: /^Variables & conditions/ }).click();
  await page.getByRole('switch', { name: 'Preview value for mobileVisible', exact: true }).click();
  await projectBrowser(page);
  await pane(page, 'Preview');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(node(page, 'mobile-service')).toHaveCount(0);
  await pane(page, 'Project');
  await project(page).getByRole('button', { name: /^Variables & conditions/ }).click();
  await page.getByRole('switch', { name: 'Preview value for mobileVisible', exact: true }).click();
  await projectBrowser(page);
  await pane(page, 'Preview');
  await node(page, 'mobile-service').getByRole('button', { name: 'Synthetic light', exact: true }).tap();
  await expect(page.getByText('Simulated light.turn_on. No Home Assistant device was changed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Activity(?:\s*\d+)?$/ }).click();
  await expect(page.getByText(/SIMULATED light\.turn_on.*light\.mobile_fixture/)).toBeVisible();
  expect((await draft(request)).document).toEqual(mobileEditorDocument());
  expect((await editorDocument(page)).variables.mobileVisible).toBe(true);
});

test('M3 project routes, shared/unassigned pages, modal and activity variants can be managed without a pointer context menu', async ({ page }, testInfo) => {
  await page.goto('/');
  await pane(page, 'Project');
  await expect(project(page).getByRole('button', { name: 'Child page', exact: true })).toBeVisible();
  await expect(project(page).getByRole('button', { name: 'Shared page', exact: true })).toBeVisible();
  await expect(project(page).getByRole('button', { name: 'Unassigned page', exact: true })).toBeVisible();
  await project(page).getByRole('button', { name: 'Actions for Unassigned page', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Rename...', exact: true }).tap();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Renamed unassigned');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).tap();
  await expect(project(page).getByRole('button', { name: 'Renamed unassigned', exact: true })).toBeVisible();
  await project(page).getByRole('button', { name: 'Fixture sheet', exact: true }).tap();
  await pane(page, 'Inspect');
  await expect(inspector(page).getByRole('combobox', { name: 'Presentation', exact: true })).toHaveValue('sheet');
  await inspector(page).getByRole('combobox', { name: 'Sheet height', exact: true }).selectOption('medium');
  await pane(page, 'Project');
  await project(page).getByRole('button', { name: /^Fixture activity/ }).tap();
  for (const [label, title] of [['Expanded', 'Expanded content'], ['Minimal', 'Minimal content'], ['Lock Screen', 'Lock content']]) {
    await pane(page, 'Project');
    await project(page).getByRole('button', { name: label, exact: true }).tap();
    await pane(page, 'Preview');
    await expect(canvas(page).getByText(`${title} synthetic content`, { exact: true }).first()).toBeVisible();
  }
  await screenshot(page, testInfo, 'compact-live-activity-layout-only');
  const document = await editorDocument(page);
  expect(document.modals[0].detent).toBe('medium');
  expect(document.pages.find(item => item.id === 'mobile-unassigned')?.title).toBe('Renamed unassigned');
});

test('M3 compact Save and stale conflicts preserve local work across pane switches', async ({ page, request }) => {
  await page.goto('/');
  await pane(page, 'Inspect');
  await inspector(page).getByLabel('Page title', { exact: true }).fill('Saved mobile revision');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(async () => (await draft(request)).document.pages[0].title).toBe('Saved mobile revision');
  await page.reload();
  await pane(page, 'Inspect');
  await expect(inspector(page).getByLabel('Page title', { exact: true })).toHaveValue('Saved mobile revision');
  await inspector(page).getByLabel('Page title', { exact: true }).fill('Local mobile work');
  const remote = await draft(request);
  remote.document.name = 'Other synthetic session';
  const response = await request.put(`${origin}/api/draft`, { data: { document: remote.document, expectedRevision: remote.revision } });
  expect(response.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  const conflict = page.getByRole('alert').filter({ hasText: 'The server draft changed in another session.' });
  await expect(conflict).toBeVisible();
  await reachable(page, conflict.getByRole('button', { name: 'Keep local & replace server', exact: true }));
  await reachable(page, conflict.getByRole('button', { name: 'Reload server version', exact: true }));
  await pane(page, 'Project');
  await pane(page, 'Inspect');
  await expect(inspector(page).getByLabel('Page title', { exact: true })).toHaveValue('Local mobile work');
  expect((await draft(request)).document.name).toBe('Other synthetic session');
  await conflict.getByRole('button', { name: 'Keep local & replace server', exact: true }).tap();
  await expect.poll(async () => (await draft(request)).document.pages[0].title).toBe('Local mobile work');
});

test('M4 compact pane focus, hidden accessibility, Escape restoration, keyboard and 44px editor alternatives', async ({ page }, testInfo) => {
  await page.goto('/');
  const targets = [];
  for (const name of ['Project', 'Preview', 'Inspect', 'Insert', 'Save', 'Undo', 'Redo']) {
    const control = page.getByRole('button', { name, exact: true });
    await reachable(page, control);
    const box = await control.boundingBox();
    expect(box!.width, `${name} target width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} target height`).toBeGreaterThanOrEqual(44);
    targets.push({ name, ...box! });
  }
  await pane(page, 'Inspect');
  const title = inspector(page).getByLabel('Page title', { exact: true });
  await expect.poll(() => title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await title.focus();
  await page.getByRole('button', { name: 'Project', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(project(page)).toBeVisible();
  await expect(inspector(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveCount(0);
  expect(await page.getByRole('region', { name: 'Project pane', exact: true }).evaluate(element => element === document.activeElement || element.contains(document.activeElement))).toBe(true);
  const actions = project(page).getByRole('button', { name: 'Actions for First item', exact: true });
  for (const alternative of [project(page).getByRole('button', { name: 'First item', exact: true }), project(page).getByRole('button', { name: 'Reorder First item', exact: true }), actions]) {
    await reachable(page, alternative);
    const box = await alternative.boundingBox();
    expect(box!.width, 'Unscaled editor/tree target; not simulated device geometry').toBeGreaterThanOrEqual(44);
    expect(box!.height, 'Our editor target-size goal, not a native point measurement').toBeGreaterThanOrEqual(44);
    targets.push({ name: await alternative.getAttribute('aria-label') ?? await alternative.innerText(), ...box! });
  }
  await testInfo.attach('unscaled-editor-target-metrics', { body: JSON.stringify(targets, null, 2), contentType: 'application/json' });
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Edit component', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Rename...', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(actions).toBeFocused();
  await pane(page, 'Preview');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search components', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Quick insert components', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Search components', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Insert', exact: true })).toBeFocused();
  await expect(project(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Actions for First item', exact: true })).toHaveCount(0);
});

test('M4 keyboard and external pointer drag retain placement cues on a touch-capable host', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await pane(page, 'Preview');
  const handle = node(page, 'mobile-first').getByRole('button', { name: 'Drag First item on canvas', exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(node(page, 'mobile-second').locator(':scope > [data-drop-placement="after"][data-drop-active="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  const from = await center(handle);
  const box = await node(page, 'mobile-second').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 2, { steps: 15 });
    await expect(node(page, 'mobile-second').locator(':scope > [data-drop-placement="after"][data-drop-active="true"]')).toBeVisible();
  } finally {
    await page.mouse.up();
  }
  expect((await editorDocument(page)).pages[0].components.slice(0, 2).map(component => component.id)).toEqual(['mobile-second', 'mobile-first']);
});

test('M4 200 percent editor text-scale stress and reduced motion/transparency preserve compact workflows', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await pane(page, 'Inspect');
  const title = inspector(page).getByLabel('Page title', { exact: true });
  const initialFont = await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await page.evaluate(() => {
    const targets = [...document.querySelectorAll<HTMLElement>('.studio h1,.studio h2,.studio h3,.studio p,.studio strong,.studio span,.studio small,.studio button,.studio input,.studio select,.studio textarea,.studio summary,.studio label')]
      .filter(element => !element.closest('.native-app'));
    const sizes = targets.map(element => parseFloat(getComputedStyle(element).fontSize));
    targets.forEach((element, index) => element.style.setProperty('font-size', `${sizes[index] * 2}px`, 'important'));
  });
  await expect.poll(() => title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(initialFont * 2, 1);
  await inspector(page).getByLabel('Page title', { exact: true }).fill('Large readable editor text');
  await reachable(page, inspector(page).getByLabel('Page title', { exact: true }));
  await noDocumentOverflow(page);
  await screenshot(page, testInfo, 'editor-200-percent-text-scale-inspect');
  await pane(page, 'Project');
  await reachable(page, project(page).getByRole('button', { name: /^Variables & conditions/ }));
  await noDocumentOverflow(page);
  await pane(page, 'Preview');
  await page.getByRole('button', { name: 'Opaque chrome', exact: true }).click();
  await expect(page.locator('.native-tabbar')).toHaveCSS('backdrop-filter', 'none');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await node(page, 'mobile-sheet-link').getByRole('button', { name: 'Open fixture sheet', exact: true }).click();
  await expect(page.locator('.native-modal')).toHaveCSS('transform', 'none');
  await screenshot(page, testInfo, 'editor-200-percent-text-scale-reduced-effects');
});

type ZoomExtensionAPI = {
  tabs: {
    query(query: { url: string[] }): Promise<{ id?: number }[]>;
    setZoomSettings(id: number, settings: { mode: 'automatic'; scope: 'per-tab' }): Promise<void>;
    setZoom(id: number, factor: number): Promise<void>;
    getZoom(id: number): Promise<number>;
  };
};

test('M4 actual Chromium tab zoom at 200 and 400 percent reflows independently from preview and authored text scale', async ({ request }, testInfo) => {
  test.setTimeout(90_000);
  const extension = testInfo.outputPath('zoom-extension');
  const profile = testInfo.outputPath('zoom-profile');
  await mkdir(extension, { recursive: true });
  let zoomContext: BrowserContext | undefined;
  try {
    await writeFile(join(extension, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Isolated Studio browser zoom acceptance', version: '1.0',
      permissions: ['tabs'], host_permissions: [`${origin}/*`],
      background: { service_worker: 'zoom.js' },
    }));
    await writeFile(join(extension, 'zoom.js'), 'chrome.runtime.onInstalled.addListener(() => {});\n');
    // chrome.tabs.setZoom changes real tab zoom; CDP pageScaleFactor only pinches the visual viewport.
    zoomContext = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
      hasTouch: false, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const forbidden = await guardRequests(zoomContext);
    const worker = zoomContext.serviceWorkers()[0] ?? await zoomContext.waitForEvent('serviceworker', { timeout: 15_000 });
    const zoomPage = zoomContext.pages()[0] ?? await zoomContext.newPage();
    await zoomPage.goto(`${origin}/`);
    await selectLayer(zoomPage, 'First item');
    await pane(zoomPage, 'Inspect');
    await inspector(zoomPage).getByLabel('Title', { exact: true }).fill('Browser zoom retained edit');
    await inspector(zoomPage).locator('summary').filter({ hasText: /^Advanced properties$/ }).click();
    const raw = inspector(zoomPage).getByRole('textbox', { name: /^Component props JSON(?:\s|$)/ });
    await raw.fill('{"browserZoomDraft":');
    const initial = await zoomPage.evaluate(() => ({
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visualScale: visualViewport?.scale,
    }));
    const measurements = [];
    for (const factor of [2, 4]) {
      await raw.focus();
      const actual = await worker.evaluate(async ({ factor, url }) => {
        const api = (globalThis as typeof globalThis & { chrome: ZoomExtensionAPI }).chrome;
        const tabs = await api.tabs.query({ url: [`${url}/*`] });
        if (tabs.length !== 1 || tabs[0].id === undefined) throw new Error('Expected exactly one isolated Studio tab for real browser zoom');
        await api.tabs.setZoomSettings(tabs[0].id, { mode: 'automatic', scope: 'per-tab' });
        await api.tabs.setZoom(tabs[0].id, factor);
        return api.tabs.getZoom(tabs[0].id);
      }, { factor, url: origin });
      expect(actual).toBeCloseTo(factor, 12);
      await expect.poll(() => zoomPage.evaluate(() => innerWidth)).toBeCloseTo(initial.width / factor, 0);
      const measured = await zoomPage.evaluate(() => ({
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visualScale: visualViewport?.scale,
      }));
      measurements.push({ requestedZoom: factor, actualZoom: actual, ...measured });
      expect(measured.dpr).toBeCloseTo(initial.dpr * factor, 1);
      expect(measured.visualScale, 'Tab zoom is not emulated visual-viewport pinch scale').toBe(initial.visualScale);
      if (factor === 4) expect(measured.width, '1280 CSS px at 400% provides the 320 CSS px reflow study').toBe(320);
      await expect(inspector(zoomPage)).toBeVisible();
      await expect(raw).toBeFocused();
      await expect(raw).toHaveValue('{"browserZoomDraft":');
      await expect(inspector(zoomPage).getByLabel('Title', { exact: true })).toHaveValue('Browser zoom retained edit');
      await noDocumentOverflow(zoomPage);
      await screenshot(zoomPage, testInfo, `actual-browser-zoom-${factor * 100}-inspect`);
      await pane(zoomPage, 'Project');
      await reachable(zoomPage, project(zoomPage).getByRole('button', { name: /^Variables & conditions/ }));
      await noDocumentOverflow(zoomPage);
      await pane(zoomPage, 'Preview');
      for (const name of ['Project', 'Preview', 'Inspect', 'Insert', 'Save', 'View and edit source']) {
        await reachable(zoomPage, zoomPage.getByRole('button', { name, exact: true }));
      }
      await noDocumentOverflow(zoomPage);
      await screenshot(zoomPage, testInfo, `actual-browser-zoom-${factor * 100}-preview`);
      await pane(zoomPage, 'Inspect');
      await expect(raw).toHaveValue('{"browserZoomDraft":');
    }
    await testInfo.attach('actual-browser-zoom-measurements', {
      body: JSON.stringify({ initial, measurements }, null, 2), contentType: 'application/json',
    });
    expect(forbidden, 'The isolated zoom context also rejects live service and external requests').toEqual([]);
    expect((await draft(request)).document).toEqual(mobileEditorDocument());
  } finally {
    try {
      await zoomContext?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
      await rm(extension, { recursive: true, force: true });
    }
  }
});

test('M4 320px editor reflows with user text-spacing overrides without clipping commands', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.addStyleTag({ content: `
    .studio, .studio :not(.native-app):not(.native-app *):not(svg):not(svg *) {
      line-height: 1.5 !important;
      letter-spacing: 0.12em !important;
      word-spacing: 0.16em !important;
    }
    .studio p:not(.native-app *) { margin-block-end: 2em !important; }
  ` });
  await pane(page, 'Inspect');
  const title = inspector(page).getByLabel('Page title', { exact: true });
  const spacing = await title.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight),
      letter: parseFloat(style.letterSpacing), word: parseFloat(style.wordSpacing),
    };
  });
  expect(spacing.line).toBeCloseTo(spacing.font * 1.5, 1);
  expect(spacing.letter).toBeCloseTo(spacing.font * 0.12, 1);
  expect(spacing.word).toBeCloseTo(spacing.font * 0.16, 1);
  await title.fill('Readable spacing fixture');
  await reachable(page, title);
  await reachable(page, inspector(page).getByRole('button', { name: 'Add header action', exact: true }));
  await noDocumentOverflow(page);
  await screenshot(page, testInfo, 'editor-320px-text-spacing-inspect');
  await pane(page, 'Project');
  for (const name of ['Navigation & theme', 'Data sources', 'Variables & conditions']) {
    const command = project(page).getByRole('button', { name: new RegExp(`^${name}`) });
    await reachable(page, command);
    expect(await command.evaluate(element => element.scrollWidth - element.clientWidth), `${name} text must wrap, not clip`).toBeLessThanOrEqual(1);
  }
  const paragraph = project(page).locator('p').first();
  expect(await paragraph.evaluate(element => {
    const style = getComputedStyle(element);
    return parseFloat(style.marginBlockEnd) / parseFloat(style.fontSize);
  })).toBeCloseTo(2, 1);
  await noDocumentOverflow(page);
  await screenshot(page, testInfo, 'editor-320px-text-spacing-project');
  await pane(page, 'Preview');
  for (const name of ['Save', 'View and edit source', 'Import JSON or YAML']) {
    await reachable(page, page.getByRole('button', { name, exact: true }));
  }
  await noDocumentOverflow(page);
});

test('M3 compact import rejects invalid content, accepts synthetic data, and undo restores the local document', async ({ page, request }) => {
  await page.goto('/');
  await pane(page, 'Preview');
  const before = await editorDocument(page);
  await page.getByRole('button', { name: 'Import JSON or YAML', exact: true }).tap();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import document source', { exact: true }).fill('{"schemaVersion":"invalid"}');
  await dialog.getByRole('button', { name: 'Validate & import', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await editorDocument(page)).toEqual(before);
  const imported = mobileEditorDocument();
  imported.name = 'Imported mobile fixture';
  await page.getByRole('button', { name: 'Import JSON or YAML', exact: true }).tap();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Choose JSON or YAML document', { exact: true }).setInputFiles({
    name: 'synthetic-mobile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
  });
  await dialog.getByRole('button', { name: 'Validate & import', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  expect(await editorDocument(page)).toEqual(imported);
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  expect(await editorDocument(page)).toEqual(before);
  expect((await draft(request)).document).toEqual(before);
});
