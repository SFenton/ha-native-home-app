import { expect, test } from '@playwright/test';
import { createSampleDocument } from '../../src/shared/sample';
import { parse as parseYaml } from 'yaml';

test.beforeEach(async ({ request }) => {
  const draft = await (await request.get('/api/draft')).json();
  const reset = await request.put('/api/draft', {
    data: { document: createSampleDocument(), expectedRevision: draft.revision },
  });
  expect(reset.ok()).toBeTruthy();
});

test('native weather, alarm, subpage chrome and device themes stay data driven', async ({ page, request }, testInfo) => {
  const envelope = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.pages[0].layout = { columns: 1, gap: 24 };
  const binding = { sourceId: 'native-fixture' };
  document.dataSources.push({ id: 'native-fixture', name: 'Synthetic native presentation', kind: 'static', refreshSeconds: 30, sample: [
    { entityId: 'weather.fixture', name: 'Weather', state: 'rainy', temperature: 72, unit: '°F', dailyForecast: [{ datetime: '2026-11-12T00:00:00Z', temperature: 78, templow: 58, condition: 'rainy' }], hourlyForecast: Array.from({ length: 24 }, (_, hour) => ({ datetime: `2026-11-12T${String(hour).padStart(2, '0')}:00:00Z`, temperature: 72 - hour % 5, condition: 'rainy' })) },
    { entityId: 'alarm_control_panel.fixture', name: 'Security', state: 'armed_home' },
  ] });
  document.pages[0].components = [
    { id: 'weather-fixture', type: 'weather-summary', title: 'Weather', props: { entityId: 'weather.fixture' }, binding, action: { type: 'modal', modalId: 'weather-sheet' } },
    { id: 'security-link', type: 'navigation-tile', title: 'Security', props: {}, action: { type: 'modal', modalId: 'security-sheet' } },
    { id: 'scroll-space', type: 'spacer', title: '', props: { height: 900 } },
  ];
  document.modals.push(
    { id: 'weather-sheet', title: 'Weather', icon: 'CloudSun', presentation: 'sheet', detent: 'large', toolbar: [], layout: { columns: 1, gap: 24 }, components: [
      { id: 'weather-detail', type: 'weather-summary', title: 'Weather', props: { entityId: 'weather.fixture', presentation: 'detail' }, binding },
    ] },
    { id: 'security-sheet', title: 'Security System', icon: 'Shield', presentation: 'sheet', detent: 'large', toolbar: [], layout: { columns: 1, gap: 24 }, components: [
      { id: 'alarm-panel', type: 'section', title: 'Security System', binding, props: { entityId: 'alarm_control_panel.fixture', presentation: 'alarm-panel' }, children: ['Disarm', 'Home', 'Away', 'Night'].map((title, index) => ({
        id: `alarm-mode-${index}`, type: 'action-tile' as const, title, icon: ['shield.slash', 'house', 'figure.walk', 'moon'][index], color: '#007aff', binding,
        props: { entityId: 'alarm_control_panel.fixture', modeState: index ? `armed_${title.toLowerCase()}` : 'disarmed', showState: false },
        action: { type: 'service' as const, domain: 'alarm_control_panel', entityId: 'alarm_control_panel.fixture', service: index ? `alarm_arm_${title.toLowerCase()}` : 'alarm_disarm' },
      })) },
      { id: 'security-stack', type: 'section', title: '', props: { presentation: 'navigation-stack' }, children: [
        { id: 'security-rooms', type: 'section', title: 'Rooms', props: {}, children: [
          { id: 'security-room-link', type: 'navigation-tile', title: 'Office', props: { destinationId: 'security-office' } },
        ] },
        { id: 'security-office', type: 'section', title: 'Office contacts', props: {}, children: [
          { id: 'security-office-window', type: 'navigation-tile', title: 'Office Window', icon: 'mdi:window-closed', props: { readOnly: true }, subtitle: 'Closed' },
        ] },
      ] },
    ] },
  );
  expect((await request.put('/api/draft', { data: { document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.getByLabel('Device theme').selectOption('light');
  await expect(page.locator('.native-app')).toHaveClass(/appearance-light/);
  const weather = page.getByRole('button', { name: /^Open Weather forecast/ });
  await expect(weather).toContainText('72°');
  await expect(page.locator('.binding-indicator,.simulated-tag,.native-capability-note')).toHaveCount(0);
  await weather.click();
  await expect(page.locator('.modal-weather')).toHaveCSS('background-color', 'rgb(28, 28, 30)');
  await expect(page.locator('.native-weather-detail')).toBeVisible();
  await expect(page.locator('.native-modal')).toHaveCSS('opacity', '1');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('weather-detail.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Dismiss app modal' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Opaque chrome', exact: true }).click();
  await expect(page.locator('.native-app')).toHaveClass(/opaque-chrome/);
  await expect(page.locator('.native-tabbar')).toHaveCSS('backdrop-filter', 'none');
  await page.getByRole('region', { name: 'Device canvas' }).getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.locator('.native-modal')).toHaveCSS('transform', 'none');
  await expect(page.locator('.native-modal')).toHaveCSS('background-color', 'rgb(242, 242, 247)');
  await expect(page.locator('.native-alarm-panel')).toContainText('Armed Home');
  await expect(page.locator('.native-alarm-modes button')).toHaveCount(4);
  await expect(page.locator('.native-alarm-modes [data-icon="figure.walk"]')).toHaveClass(/lucide-walking-person/);
  await page.getByLabel('Device theme').selectOption('dark');
  await expect(page.locator('.native-modal')).toHaveCSS('background-color', 'rgb(28, 28, 30)');
  await expect(page.locator('.native-modal')).toHaveCSS('opacity', '1');
  await page.locator('.device-screen').screenshot({ path: testInfo.outputPath('security-dark.png'), animations: 'disabled' });
  await page.locator('.native-modal').getByRole('button', { name: 'Office', exact: true }).click();
  await expect(page.locator('.native-modal .native-inline-title')).toHaveText('Office contacts');
  await page.getByRole('button', { name: 'Back in sheet' }).click();
  await expect(page.locator('.native-modal .native-inline-title')).toHaveText('Security System');
  await page.getByRole('button', { name: 'Dismiss app modal' }).click();
  const scroller = page.locator('.native-scroll.navigation-enter');
  await scroller.hover();
  await page.mouse.wheel(0, 130);
  await expect.poll(() => scroller.evaluate(element => Number((element as HTMLElement).style.getPropertyValue('--header-progress')))).toBe(1);
  await expect(scroller.locator('.native-inline-title')).toHaveCSS('opacity', '1');
  await expect(scroller.locator('h1')).toHaveCSS('opacity', '0');
  expect((await (await request.get('/api/draft')).json()).document).toEqual(document);
});

test('edits persist across reload and publish the exact saved document', async ({ page, request }) => {
  await page.goto('/');
  await page.getByLabel('Page title', { exact: true }).fill('Arrival Hub');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect.poll(async () => (await (await request.get('/api/draft')).json()).document.pages[0].title)
    .toBe('Arrival Hub');
  await page.reload();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Arrival Hub');
  const draft = await (await request.get('/api/draft')).json();
  await page.getByRole('button', { name: /^Publish/ }).click();
  await page.getByRole('button', { name: 'Publish configuration', exact: true }).click();
  await expect.poll(async () => {
    const response = await request.get('/api/published');
    return response.ok() ? (await response.json()).revision : null;
  }).toBe(draft.revision);
  const published = await (await request.get('/api/published')).json();
  expect(published.revision).toBe(draft.revision);
  expect(published.document).toEqual(draft.document);
});

test('Edit retains the open modal, selected sheet tab and presenting page', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.pages[0].components = [{ id: 'context-link', type: 'navigation-tile', title: 'Modal host', props: {}, action: { type: 'navigate', pageId: 'context-page' } }];
  document.pages.push({ id: 'context-page', title: 'Modal host', icon: 'House', toolbar: [], layout: { columns: 1, gap: 12 }, components: [
    { id: 'context-modal-link', type: 'action-tile', title: 'Open tools', props: {}, action: { type: 'modal', modalId: 'edit-preserve-modal' } },
  ] });
  document.modals.push({ id: 'edit-preserve-modal', title: 'Tool sheet', icon: 'Settings', presentation: 'sheet', detent: 'large', toolbar: [], layout: { columns: 1, gap: 12 }, components: [
    { id: 'context-tabs', type: 'section', title: '', props: { presentation: 'tabs' }, children: ['First', 'Second'].map((title, index) => ({
      id: `context-tab-${index}`, type: 'section' as const, title, props: {}, children: [
        { id: `context-body-${index}`, type: 'text' as const, title: `${title} content`, props: {} },
      ],
    })) },
  ] });
  expect((await request.put('/api/draft', { data: { document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Device canvas' });
  await canvas.getByRole('button', { name: 'Modal host', exact: true }).click();
  await canvas.getByRole('button', { name: 'Open tools', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Tool sheet', exact: true });
  await modal.getByRole('tab', { name: 'Second', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Tool sheet');
  await expect(modal.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.native-scroll.navigation-enter')).toHaveAttribute('data-preview-page', 'context-page');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(modal.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true');
  await modal.getByRole('button', { name: 'Dismiss app modal' }).click();
  await expect(modal).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: 'Open tools', exact: true })).toBeVisible();
  expect((await (await request.get('/api/draft')).json()).document).toEqual(document);
});

test('adds, customizes, duplicates, and deletes components without code', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Components', exact: true }).click();
  await page.locator('.sidebar .palette-add').filter({ hasText: 'Status chip' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Garage temperature');
  await page.getByLabel('Display value', { exact: true }).fill('22 C');
  await page.getByRole('button', { name: 'Duplicate component', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Garage humidity');
  await page.getByRole('button', { name: 'Delete component', exact: true }).click();
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect.poll(async () => {
    const document = (await (await request.get('/api/draft')).json()).document;
    return document.pages[0].components.filter((item: { title: string }) =>
      item.title.startsWith('Garage')).map((item: { title: string }) => item.title);
  }).toEqual(['Garage temperature']);
});

test('stale saves cannot overwrite a draft edited in another browser', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByLabel('Page title', { exact: true })).toBeVisible();
  const other = await (await request.get('/api/draft')).json();
  other.document.name = 'Saved from another browser';
  expect((await request.put('/api/draft', {
    data: { document: other.document, expectedRevision: other.revision },
  })).ok()).toBeTruthy();
  await page.getByLabel('Page title', { exact: true }).fill('Local unsaved work');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText(/conflict|changed.*another|another.*changed|newer revision/i).first()).toBeVisible();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Local unsaved work');
  expect((await (await request.get('/api/draft')).json()).document.name)
    .toBe('Saved from another browser');
});

test('drags components onto a new page and supports nested settings sections', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await page.getByLabel('Page title', { exact: true }).fill('Car');
  await page.getByRole('tab', { name: 'Components', exact: true }).click();
  await page.locator('.sidebar .palette-add').filter({ hasText: /^Text/ }).hover();
  const handle = page.getByRole('button', { name: 'Drag Text to canvas', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const source = await handle.boundingBox();
  const destination = await page.locator('.native-page-content').boundingBox();
  expect(source).not.toBeNull();
  expect(destination).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination!.x + destination!.width / 2, destination!.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Text');
  await page.getByLabel('Title', { exact: true }).fill('Vehicle status');
  await page.locator('.sidebar .palette-add').filter({ hasText: /^Section/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Vehicle preferences');
  await page.locator('.sidebar .palette-add').filter({ hasText: /^Settings row/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Charging schedule');
  await page.getByRole('tab', { name: 'Project', exact: true }).click();
  const row = page.getByRole('button', { name: 'Reorder Charging schedule', exact: true });
  await row.scrollIntoViewIfNeeded();
  await row.click({ trial: true });
  const rowBox = await row.boundingBox();
  const group = page.locator('.native-node.node-section').filter({ hasText: 'Vehicle preferences' });
  await page.mouse.move(rowBox!.x + rowBox!.width / 2, rowBox!.y + rowBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowBox!.x + 25, rowBox!.y + 25, { steps: 4 });
  const inside = await group.locator('.canvas-group-drop').boundingBox();
  await page.mouse.move(inside!.x + inside!.width / 2, inside!.y + inside!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(group.locator('.node-settings-row')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click({ delay: 80 });
  await expect.poll(async () => {
    const document = (await (await request.get('/api/draft')).json()).document;
    return document.pages.find((item: { title: string }) => item.title === 'Car')?.components;
  }).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', title: 'Vehicle status' }),
    expect.objectContaining({ type: 'section', title: 'Vehicle preferences', children: [
      expect.objectContaining({ type: 'settings-row', title: 'Charging schedule' }),
    ] }),
  ]));
});

test('canvas dragging reorders existing components and library clicks insert after selection', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].components = [
    { id: 'first', type: 'text', title: 'First item', props: {}, layout: { span: 2 } },
    { id: 'second', type: 'text', title: 'Second item', props: {}, layout: { span: 2 } },
    { id: 'third', type: 'text', title: 'Third item', props: {}, layout: { span: 2 } },
  ];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.locator('[data-component-id="second"]').click();
  await page.getByRole('tab', { name: 'Components', exact: true }).click();
  await page.locator('.sidebar .palette-add').filter({ hasText: 'Status chip' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Inserted chip');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/draft')).json()).document.pages[0].components.map((item: { title: string }) => item.title))
    .toEqual(['First item', 'Second item', 'Inserted chip', 'Third item']);
  await page.locator('[data-component-id="first"] .native-text').click({ trial: true });
  const first = await page.locator('[data-component-id="first"] .native-text').boundingBox();
  const last = await page.locator('[data-component-id="third"]').boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(last!.x + last!.width / 2, last!.y + last!.height / 2, { steps: 15 });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect(page.locator('[data-component-id="third"] > .canvas-placement.after.active')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.native-page-content>.native-layout>[data-component-id]').first()).toHaveAttribute('data-component-id', 'second');
  await page.getByRole('button', { name: 'Save', exact: true }).click({ delay: 80 });
  await expect.poll(async () => (await (await request.get('/api/draft')).json()).document.pages[0].components.map((item: { title: string }) => item.title))
    .toEqual(['Second item', 'Inserted chip', 'Third item', 'First item']);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.native-page-content>.native-layout>[data-component-id]').first()).toHaveAttribute('data-component-id', 'first');
});

test('tab-linked pages keep their tab selected and contextual deletion targets the clicked page', async ({ page }) => {
  await page.goto('/');
  const foodBranch = page.getByRole('region', { name: 'Food tab', exact: true });
  await expect(foodBranch).toBeVisible();
  const pages = foodBranch.locator('.page-row');
  const originalCount = await pages.count();
  await page.getByRole('button', { name: 'Add page to Food tab' }).click();
  await expect(pages).toHaveCount(originalCount + 1);
  const child = pages.last();
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename...' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Weekly menus');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(child).toContainText('Weekly menus');
  await expect(page.locator('.native-tabbar [aria-current="page"]')).toHaveText('Food');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(page.locator('.native-tabbar [aria-current="page"]')).toHaveText('Food');

  const home = page.getByRole('region', { name: 'Home tab', exact: true }).locator('.page-row').first();
  await home.click();
  await expect(page.locator('.native-tabbar [aria-current="page"]')).toHaveText('Home');
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete page...' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Weekly menus?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(pages).toHaveCount(originalCount + 1);
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete page...' }).click();
  await page.getByRole('button', { name: 'Delete surface', exact: true }).click();
  await expect(pages).toHaveCount(originalCount);
  await expect(home).toBeVisible();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(pages).toHaveCount(originalCount + 1);
  await expect(child).toContainText('Weekly menus');
});

test('drop edges show the actual insertion point and Escape cancels without changing the document', async ({ page, request }, info) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].components = ['first', 'second', 'third'].map(id => ({ id, type: 'text', title: id, props: {}, layout: { span: 2 } }));
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  const first = page.locator('.native-page-content [data-component-id="first"]'), third = page.locator('.native-page-content [data-component-id="third"]');
  await first.click({ trial: true });
  const workspace = page.getByRole('region', { name: 'Device canvas', exact: true });
  await workspace.hover({ position: { x: 20, y: 80 } });
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(0);
  const start = await third.boundingBox(), end = await first.boundingBox();
  await page.mouse.move(start!.x + 20, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(end!.x + 20, end!.y + 3, { steps: 15 });
  await info.attach('drag-edge-measurements', { contentType: 'application/json', body: JSON.stringify({
    start, end, measured: await page.locator('.native-page-content [data-component-id], .canvas-placement').evaluateAll(elements => elements.map(element => ({
      id: element.getAttribute('data-component-id'), className: element.className, rect: element.getBoundingClientRect().toJSON(),
    }))),
  }) });
  await expect(first.locator(':scope > .canvas-placement.before.active')).toBeVisible();
  await page.mouse.up();
  const order = () => page.locator('.native-page-content > .native-layout > [data-component-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-component-id')));
  await expect.poll(order).toEqual(['third', 'first', 'second']);
  const a = await third.boundingBox(), b = await first.boundingBox();
  await page.mouse.move(a!.x + 20, a!.y + a!.height / 2); await page.mouse.down();
  await page.mouse.move(b!.x + 20, b!.y + b!.height - 2, { steps: 12 });
  await expect(first.locator(':scope > .canvas-placement.after.active')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(order).toEqual(['third', 'first', 'second']);
  await expect(page.locator('.canvas-placement.active')).toHaveCount(0);
  const keyboardHandle = third.getByRole('button', { name: 'Drag third on canvas' });
  await keyboardHandle.focus(); await page.keyboard.press('Space');
  await expect(keyboardHandle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(first.locator(':scope > .canvas-placement.after.active')).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(order).toEqual(['first', 'third', 'second']);
  await expect(keyboardHandle).not.toHaveAttribute('aria-pressed', 'true');
  await keyboardHandle.click({ trial: true });
  await keyboardHandle.focus(); await page.keyboard.press('Space');
  await expect(keyboardHandle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(first.locator(':scope > .canvas-placement.before.active')).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(order).toEqual(['third', 'first', 'second']);
});

test('keyboard cross-group drops use the same insertion edge as the resulting order', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].components = ['a', 'b'].map(id => ({
    id: `group-${id}`, type: 'section', title: `Group ${id}`, props: { columns: 1 }, layout: { span: 2 },
    children: [{ id: `child-${id}`, type: 'text', title: `Child ${id}`, props: {} }],
  }));
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  const source = page.locator('.native-page-content [data-component-id="child-a"]');
  const destination = page.locator('.native-page-content [data-component-id="child-b"]');
  const handle = source.getByRole('button', { name: 'Drag Child a on canvas', exact: true });
  await source.focus();
  await handle.click({ trial: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-component-id="group-b"] > .canvas-placement.before.active')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(destination.locator(':scope > .canvas-placement.before.active')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-component-id="group-a"] [data-component-id]')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-component-id="group-b"] [data-component-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-component-id')))).toEqual(['child-a', 'child-b']);
});

test('folded camera frames do not create a second media request or remount the app', async ({ page, request }) => {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!; context.fillStyle = '#dd1166'; context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL().split(',')[1];
  });
  let requests = 0;
  await page.route('**/api/frame-source.png', route => {
    requests++;
    return route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: Buffer.from(image, 'base64') });
  });
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].components = [{ id: 'frame-camera', type: 'camera-feed', title: 'Captured camera', props: { imageUrl: '/api/frame-source.png' }, layout: { span: 2 } }];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  await expect.poll(() => page.getByAltText('Captured camera').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(16);
  await page.getByLabel('Preview device').selectOption('duo');
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('90');
  await expect(page.locator('.duo-fold-face img')).toHaveCount(2);
  await expect.poll(() => page.locator('.duo-fold-face img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const original = await page.getByAltText('Captured camera').elementHandle();
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('30');
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('150');
  await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
  await expect(page.locator('.duo-fold-face img')).toHaveCount(2);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  expect(requests).toBe(1);
  await expect(page.locator('.native-app')).toHaveCount(1);
  await expect(page.locator('[data-preview-frame-media]')).toHaveCount(0);
});

test('device quarter turns, pointer orbit and continuous Duo fold share a single live app', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const model = page.locator('.device-model');
  await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
  await expect(model).toHaveAttribute('data-orientation', '90');
  await expect(model).toHaveClass(/landscape/);
  await page.getByRole('button', { name: 'Rotate device 90 degrees counterclockwise', exact: true }).click();
  await expect(model).toHaveAttribute('data-orientation', '0');
  await page.getByRole('button', { name: 'Rotate device 90 degrees counterclockwise', exact: true }).click();
  await expect(model).toHaveAttribute('data-orientation', '270');
  await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  const stage = page.locator('.device-stage');
  const box = await stage.boundingBox(), transform = await model.evaluate(element => element.style.transform);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 65, box!.y + box!.height / 2 + 30, { steps: 12 });
  await expect(stage).toHaveClass(/orbiting/);
  expect(await model.evaluate(element => element.style.transform)).not.toBe(transform);
  await page.mouse.up();
  await expect(stage).not.toHaveClass(/orbiting/);
  const stopped = await model.evaluate(element => element.style.transform);
  await page.mouse.move(box!.x + 5, box!.y + 5);
  expect(await model.evaluate(element => element.style.transform)).toBe(stopped);
  await stage.focus(); await page.keyboard.press('ArrowLeft');
  expect(await model.evaluate(element => element.style.transform)).not.toBe(stopped);
  await page.getByLabel('Preview device').selectOption('duo');
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('120');
  await expect(model).toHaveAttribute('data-posture', 'partial');
  await expect(page.locator('.duo-fold-face img')).toHaveCount(2);
  const foldA = await page.locator('.duo-fold-face.leading').evaluate(element => getComputedStyle(element).transform);
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('70');
  const foldB = await page.locator('.duo-fold-face.leading').evaluate(element => getComputedStyle(element).transform);
  expect(foldB).not.toBe(foldA);
  await expect(page.locator('.native-app')).toHaveCount(1);
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await stage.screenshot({ path: testInfo.outputPath('duo-hinge.png') });
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('0');
  await expect(model).toHaveAttribute('data-posture', 'closed');
  await expect(page.locator('.native-app')).toHaveCount(1);
  await page.getByRole('slider', { name: 'Fold angle', exact: true }).fill('180');
  await expect(model).toHaveAttribute('data-posture', 'open');
  await expect(page.locator('.native-app')).toHaveCount(1);
  expect((await (await request.get('/api/draft')).json()).document).toEqual(createSampleDocument());
});

test('background upload persists across reload without changing the existing layout', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Navigation & theme/ }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d')!; context.fillStyle = '#224488'; context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Upload background image', { exact: true }).setInputFiles({
    name: 'wallpaper.png', mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByAltText('Current app background')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.getByLabel('Background dimming', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/draft')).json()).document.theme.background?.dim).toBe(0.4);
  await page.reload();
  await expect(page.locator('.native-wallpaper img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.locator('.native-wallpaper>div')).toHaveCSS('background-image', /rgba\(0, 0, 0, 0\.4\) 50%/);
  expect((await (await request.get('/api/draft')).json()).document.pages).toEqual(createSampleDocument().pages);
});

test('Duo postures avoid the active landscape crease and keep a single app instance', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].layout = { columns: 1, gap: 12, foldAware: true };
  envelope.document.pages[0].components = [
    { id: 'leading', type: 'text', title: 'Leading region', props: { foldRegion: 'leading' } },
    { id: 'trailing', type: 'text', title: 'Trailing region', props: { foldRegion: 'trailing' } },
  ];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByLabel('Preview device').selectOption('duo');
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  for (const posture of ['Closed', 'Partial', 'Open']) {
    await page.getByRole('button', { name: posture, exact: true }).click();
    for (const landscape of [false, true]) {
      if (landscape) await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
      await expect(page.locator('.native-app')).toHaveCount(1);
      await expect(page.locator('.hardware-notch,.hardware-island')).toHaveCount(0);
      await expect(page.locator('.device-model')).toHaveAttribute('data-posture', posture.toLowerCase());
      await expect(page.locator('.device-model')).toHaveAttribute('data-layout', landscape || posture === 'Closed' ? 'side-controls' : 'bottom-controls');
      if (posture === 'Partial' && landscape) {
        await expect.poll(async () => {
          const leading = await page.locator('[data-component-id="leading"]').boundingBox();
          const trailing = await page.locator('[data-component-id="trailing"]').boundingBox();
          const crease = await page.locator('.duo-crease').boundingBox();
          return leading!.x + leading!.width <= crease!.x + 1 && trailing!.x >= crease!.x + crease!.width - 1;
        }).toBe(true);
      } else {
        await expect.poll(() => page.locator('.native-page-content').evaluate(element => {
          const leading = element.querySelector('[data-component-id="leading"]')!.getBoundingClientRect();
          const trailing = element.querySelector('[data-component-id="trailing"]')!.getBoundingClientRect();
          return Math.abs(leading.x - trailing.x) < 1 && trailing.y > leading.y;
        })).toBe(true);
      }
    }
    await page.getByRole('button', { name: 'Rotate device 90 degrees counterclockwise', exact: true }).click();
  }
});

test('preview navigation, conditional visibility, modals, and feedback work without real actuation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'App tabs' });
  await expect(page.locator('[data-component-id="home-cameras"]')).toBeVisible();
  await tabs.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Show cameras', exact: true }).click();
  await tabs.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('[data-component-id="home-cameras"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  await expect(page.locator('.native-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss app modal', exact: true }).click();
  await expect(page.locator('.native-modal')).toHaveCount(0);
  await tabs.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-component-id="settings-report"] button').click();
  await page.getByLabel('What went wrong?', { exact: true }).fill('Test feedback');
  await page.getByLabel('Details', { exact: true }).fill('Isolated browser test; do not submit externally.');
  await page.getByRole('button', { name: 'Save feedback', exact: true }).click();
  await expect(page.getByText('Feedback saved to the server queue. No external issue was created.')).toBeVisible();
});

test('device and Live Activity variants are selectable without changing configuration', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const initial = await (await request.get('/api/draft')).json();
  const device = page.getByLabel('Preview device', { exact: true });
  for (const kind of ['compact-island', 'notch', 'ipad', 'duo']) {
    await device.selectOption(kind);
    await expect(page.locator(`.device-model.device-${kind}`)).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const device = document.querySelector('.device-model')!.getBoundingClientRect();
      const dock = document.querySelector('.device-dock')!.getBoundingClientRect();
      const canvas = document.querySelector('.canvas-workspace')!.getBoundingClientRect();
      return device.bottom < dock.top && device.left >= canvas.left && device.right <= canvas.right;
    })).toBeTruthy();
  }
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByLabel('Fold angle', { exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Fold angle', { exact: true })).toHaveValue('0');
  await expect(page.locator('.device-model.duo-closed .native-app')).toHaveCount(1);
  await expect(page.locator('.device-model.duo-closed .native-page-title h1')).toHaveText('Home');
  await expect(page.locator('.duo-panels')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Fold angle', { exact: true })).toHaveValue('1');
  await expect(page.locator('.native-app')).toHaveCount(1);
  await expect(page.locator('.device-model')).toHaveAttribute('data-posture', 'closed');
  await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
  await expect(page.locator('.device-model')).toHaveClass(/landscape/);
  await device.selectOption('island');
  await page.getByRole('button', { name: 'Laundry cycle Enabled', exact: true }).click();
  await page.locator('.activity-variant-switch').getByRole('button', { name: 'Expanded', exact: true }).click();
  await expect(page.locator('.activity-expanded')).toBeVisible();
  await page.locator('.activity-variant-switch').getByRole('button', { name: 'Minimal', exact: true }).click();
  await expect(page.locator('.activity-minimal')).toBeVisible();
  expect((await (await request.get('/api/draft')).json()).revision).toBe(initial.revision);
});

test('rejects invalid imports and exports saved edits as parseable YAML', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import JSON or YAML', exact: true }).click();
  await page.getByLabel('Import document source', { exact: true }).fill('schemaVersion: "999"\nname: "Broken"');
  await page.getByRole('button', { name: 'Validate & import', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Home');
  await page.getByLabel('Page title', { exact: true }).fill('Exported home');
  await page.getByLabel('Export document', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export YAML', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const document = parseYaml(Buffer.concat(chunks).toString('utf8'));
  expect(document.schemaVersion).toBe('1.0');
  expect(document.pages[0].title).toBe('Exported home');
});

test('native initialization is reviewed and undoable, with live values kept out of saved samples', async ({ page, request }) => {
  const before = await (await request.get('/api/draft')).json();
  await page.route('**/api/native-home', route => route.fulfill({ json: {
    mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {
      home: { weatherEntityId: 'weather.test', statusChips: [{ title: 'Lights', tone: 'light', entityId: 'light.test' }] },
      security: {}, climate: {}, rooms: {}, chores: {},
    } }, states: [{ entityId: 'weather.test', state: 'sunny', name: 'Test weather', temperature: 23 }],
    currentUser: { id: 'fixture-user', name: 'Fixture User', isOwner: false, isAdmin: false },
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: /Data sources/ }).click();
  await page.getByRole('button', { name: 'Initialize from Native Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace editor with native reference' })).toBeEnabled();
  expect((await (await request.get('/api/draft')).json()).revision).toBe(before.revision);
  await page.getByRole('button', { name: 'Replace editor with native reference' }).click();
  await expect(page.getByRole('button', { name: 'Live data: on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Live data received', { exact: false })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'App tabs' }).getByRole('button')).toHaveText(['Home', 'Security', 'Climate', 'Chores', 'Settings']);
  await expect(page.locator('.native-status small')).toHaveText('Lights');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'App tabs' }).getByRole('button', { name: 'Food', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/draft')).json()).document.dataSources[0]).toMatchObject({ endpoint: 'house-states', sample: [] });
  expect(JSON.stringify((await (await request.get('/api/draft')).json()).document)).not.toContain('Test weather');
});

test('native readings arrive immediately and survive unsaved layout edits without being saved', async ({ page, request }) => {
  const before = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.dataSources = [{ id: 'native-states', name: 'Native Home', kind: 'native-home', endpoint: 'house-states', refreshSeconds: 30, sample: [] }];
  document.pages = [document.pages[0]];
  document.pages[0].toolbar = [];
  document.modals = [];
  document.liveActivities = [];
  document.navigation.tabs = [document.navigation.tabs[0]];
  document.pages[0].components = [
    { id: 'live-reading', type: 'settings-row', title: 'Current temperature', props: { entityId: 'sensor.test_temperature' }, binding: { sourceId: 'native-states' } },
  ];
  expect((await request.put('/api/draft', { data: { document, expectedRevision: before.revision } })).ok()).toBeTruthy();
  await page.route('**/api/health', route => route.fulfill({ json: { mode: 'live', haConnected: true } }));
  await page.route('**/api/native-home', route => route.fulfill({ json: {
    mode: 'live', houseConfig: { schema: 2, hash: 'b'.repeat(64), config: {} },
    states: [{ entityId: 'sensor.test_temperature', state: '0', unit: 'C', name: 'Live-only name' }],
  } }));
  await page.goto('/');
  const reading = page.locator('[data-component-id="live-reading"]');
  await expect(reading.getByText('0 C', { exact: true })).toBeVisible();
  await page.getByLabel('Page title', { exact: true }).fill('Unsaved live layout');
  await page.getByRole('button', { name: /^Data sources/ }).click();
  await page.getByRole('button', { name: 'Fetch preview data', exact: true }).click();
  await expect(page.locator('.data-fetch .sample-badge')).toHaveText('live');
  await page.locator('.page-row').filter({ hasText: 'Unsaved live layout' }).click();
  await expect(reading.getByText('0 C', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Live data: on', exact: true }).click();
  await expect(reading.getByText('Unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Live data: off', exact: true }).click();
  await expect(reading.getByText('0 C', { exact: true })).toBeVisible();
  const saved = await (await request.get('/api/draft')).json();
  expect(saved.document.pages[0].title).toBe('Home');
  expect(saved.document.dataSources[0].sample).toEqual([]);
  expect(JSON.stringify(saved.document)).not.toContain('Live-only name');
});

test('native camera viewers expose configured controls and stop private reads when live data is off', async ({ page, request }) => {
  const before = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.pages = [document.pages[0]];
  document.pages[0].toolbar = [];
  document.pages[0].components = [{
    id: 'test-camera', type: 'camera-button', title: 'Test camera',
    props: { entityId: 'camera.synthetic', presentation: 'camera-card' },
    action: { type: 'modal', modalId: 'test-camera-viewer' },
  }];
  document.navigation.tabs = [document.navigation.tabs[0]];
  document.liveActivities = [];
  document.dataSources = [{ id: 'native-states', name: 'Native Home', kind: 'native-home', endpoint: 'house-states', refreshSeconds: 30, sample: [] }];
  document.modals = [{
    id: 'test-camera-viewer', title: 'Camera viewer', icon: 'Camera', presentation: 'sheet', detent: 'large',
    layout: { columns: 1, gap: 16 }, toolbar: [],
    components: [{
      id: 'test-camera-feed', type: 'camera-feed', title: 'Test camera',
      props: { entityId: 'camera.synthetic', viewer: true, controls: ['snapshot', 'sound', 'record'] },
    }],
  }];
  expect((await request.put('/api/draft', { data: { document, expectedRevision: before.revision } })).ok()).toBeTruthy();
  await page.route('**/api/health', route => route.fulfill({ json: { mode: 'live', haConnected: true } }));
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', states: [] } }));
  const mediaRequests: string[] = [];
  const actionRequests: string[] = [];
  await page.route('**/api/cameras/**', route => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { released: true } });
    mediaRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { error: 'Synthetic camera unavailable' } });
  });
  page.on('request', request => { if (request.url().includes('/api/actions/execute')) actionRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Live camera playback is unavailable');
  await page.getByRole('button', { name: 'Live data: on', exact: true }).click();
  const stoppedAt = mediaRequests.length;
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.getByRole('button', { name: 'Open Test camera', exact: true }).click();
  const viewer = page.locator('.native-modal');
  await expect(viewer.getByText('Live camera reads are off. Enable live data to connect.', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Unmute camera sound', exact: true })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Snapshot (simulated)', exact: true }).click();
  await expect(viewer.locator('.camera-media-control-status')).toContainText('Snapshot simulated. No actual photo was saved.');
  await viewer.getByRole('button', { name: 'Record (simulated)', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Stop (simulated)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(mediaRequests).toHaveLength(stoppedAt);
  expect(actionRequests).toEqual([]);
  await page.getByRole('button', { name: 'Live data: off', exact: true }).click();
  await expect(viewer.getByRole('alert')).toContainText('Live camera playback is unavailable');
  expect(mediaRequests.length).toBeGreaterThan(stoppedAt);
});

test('normal status chips stay on one scrollable rail with a usable desktop scrollbar', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].layout = { columns: 1, gap: 24 };
  envelope.document.pages[0].components = [{
    id: 'rail', type: 'section', title: '', props: { presentation: 'status-rail', foldRegion: 'rail' },
    children: ['Lights throughout the house', 'Security system', 'Temperature and humidity', 'Room occupancy', 'Doors and windows', 'Air quality and particles'].map((title, index) => ({
      id: `rail-chip-${index}`, type: 'status-chip', title, props: { value: 'Current reading' }, icon: 'Activity',
    })),
  }];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByLabel('Preview device').selectOption('duo');
  await page.getByRole('button', { name: 'View controls', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const rail = page.locator('[data-component-id="rail"]');
  const measure = () => rail.evaluate(element => {
    const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')];
    const scroller = candidates.find(item => /^(auto|scroll)$/.test(getComputedStyle(item).overflowX) && item.scrollWidth > item.clientWidth + 1) as HTMLElement | undefined;
    const chips = [...element.querySelectorAll('.native-status')].map(item => item.getBoundingClientRect());
    return {
      scrollable: Boolean(scroller),
      scrollbarHidden: scroller ? getComputedStyle(scroller).scrollbarWidth === 'none' || getComputedStyle(scroller, '::-webkit-scrollbar').display === 'none' : true,
      sameRow: chips.every(chip => Math.abs(chip.top - chips[0].top) < 1),
      scrollLeft: scroller?.scrollLeft ?? 0,
    };
  });
  await expect.poll(measure).toMatchObject({ scrollable: true, scrollbarHidden: false, sameRow: true });
  await rail.hover();
  await page.mouse.wheel(350, 0);
  await expect.poll(async () => (await measure()).scrollLeft).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Rotate device 90 degrees clockwise', exact: true }).click();
  await expect.poll(measure).toMatchObject({ scrollable: true, scrollbarHidden: false, sameRow: true });
  expect((await (await request.get('/api/draft')).json()).document.pages[0].components[0].children).toHaveLength(6);
});

test('native navigation tile titles wrap without clipping and maintain minimum geometry', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.pages[0].layout = { columns: 1, gap: 24 };
  envelope.document.pages[0].components = [{
    id: 'room-grid', type: 'tile-grid', title: '', props: { columns: 4, minimumWidth: 150, adaptive: true, gap: 12 },
    children: Array.from({ length: 5 }, (_, index) => ({
      id: `room-tile-${index}`, type: 'navigation-tile', title: `Bedroom ${index + 1} and adjoining dressing room`,
      icon: 'House', props: { arrangement: 'anchored-bottom' }, action: { type: 'navigate', pageId: 'settings' },
    })),
  }];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  const tiles = page.locator('[data-component-id^="room-tile-"]');
  await expect(tiles).toHaveCount(5);
  const geometry = await tiles.evaluateAll(elements => elements.map(element => {
    const tile = element.querySelector<HTMLElement>('.native-tile')!;
    const title = tile.querySelector<HTMLElement>('strong')!;
    return {
      width: tile.offsetWidth, height: tile.offsetHeight,
      textClipped: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1,
      wrapping: getComputedStyle(title).whiteSpace !== 'nowrap',
    };
  }));
  for (const tile of geometry) {
    expect(tile.width).toBeGreaterThanOrEqual(150);
    expect(tile.height).toBeGreaterThanOrEqual(94);
    expect(tile.textClipped).toBe(false);
    expect(tile.wrapping).toBe(true);
  }
});

test('dark-filled navigation tiles retain light text inside light-appearance sheets', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.theme.appearance = 'light';
  envelope.document.theme.accent = '#ffffff';
  const modal = envelope.document.modals[0];
  modal.components = [{
    id: 'contrast-tile', type: 'navigation-tile', title: 'Room detail', subtitle: 'Current reading',
    props: { arrangement: 'row' }, action: { type: 'navigate', pageId: envelope.document.pages[0].id },
  }];
  envelope.document.pages[0].components = [{
    id: 'open-contrast', type: 'action-tile', title: 'Open contrast sheet', props: {},
    action: { type: 'modal', modalId: modal.id },
  }];
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.getByRole('region', { name: 'Device canvas' }).getByRole('button', { name: 'Open contrast sheet', exact: true }).click();
  const tile = page.locator('.native-modal [data-component-id="contrast-tile"]');
  await expect(tile.getByText('Room detail', { exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(tile.getByText('Current reading', { exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('native navigation retains scroll and component state and respects reduced motion', async ({ page, request }) => {
  const envelope = await (await request.get('/api/draft')).json();
  envelope.document.dataSources.push({ id: 'remembered', name: 'Items', kind: 'static', sample: [{ id: 'one', title: 'Remember this check' }], refreshSeconds: 30 });
  envelope.document.pages[0].components = [
    { id: 'remembered-list', type: 'list', title: 'Items', props: { showChecks: true }, binding: { sourceId: 'remembered' }, layout: { span: 2 } },
    { id: 'space', type: 'spacer', title: '', props: { height: 900 }, layout: { span: 2 } },
    { id: 'details-link', type: 'navigation-tile', title: 'Open details', props: {}, action: { type: 'navigate', pageId: 'details' }, layout: { span: 2 } },
  ];
  envelope.document.pages.push({ id: 'details', title: 'Details', icon: 'House', layout: { columns: 1, gap: 12 }, toolbar: [], components: [] });
  expect((await request.put('/api/draft', { data: { document: envelope.document, expectedRevision: envelope.revision } })).ok()).toBeTruthy();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.getByRole('button', { name: 'Remember this check', exact: true }).click();
  const home = page.locator('[data-preview-page="home"]');
  const link = page.getByRole('region', { name: 'Device canvas' }).getByRole('button', { name: 'Open details', exact: true });
  await link.scrollIntoViewIfNeeded();
  const offset = await home.evaluate(element => element.scrollTop);
  expect(offset).toBeGreaterThan(100);
  await link.click();
  await expect(page.locator('[data-preview-page="details"]')).toHaveCSS('animation-name', 'native-crossfade');
  await expect(home).toBeHidden();
  await page.getByRole('button', { name: 'Back in app preview' }).click();
  await expect(home).toBeVisible();
  expect(await home.evaluate(element => element.scrollTop)).toBe(offset);
  await expect(home.locator('.record-check.checked')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'App tabs' }).getByRole('button', { name: 'Food', exact: true }).click();
  await expect(home).toBeHidden();
  await page.getByRole('navigation', { name: 'App tabs' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(home.locator('.record-check.checked')).toHaveCount(1);
});

test('bindings override literal profile and text content and preserve zero-valued settings', async ({ page, request }) => {
  const draft = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.dataSources[0].sample = { name: 'Dana', subtitle: 'North House', initials: 'DN', count: 0 };
  document.pages[0].components = [
    { id: 'bound-profile', type: 'profile', title: 'Fallback profile', props: { initials: 'XX' }, binding: { sourceId: 'household' } },
    { id: 'bound-text', type: 'text', title: 'Fallback title', props: { text: 'Fallback body' }, binding: { sourceId: 'household', path: 'name' } },
    { id: 'bound-setting', type: 'settings-row', title: 'Count', props: {}, binding: { sourceId: 'household', path: 'count' } },
  ];
  expect((await request.put('/api/draft', { data: { document, expectedRevision: draft.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('[data-component-id="bound-profile"] .native-copy')).toHaveText('DanaNorth House');
  await expect(page.locator('[data-component-id="bound-profile"] .native-avatar')).toHaveText('DN');
  await expect(page.locator('[data-component-id="bound-text"] .native-text')).toHaveText('Dana');
  await expect(page.locator('[data-component-id="bound-setting"] .setting-value')).toHaveText('0');
});

test('source edits invalidate fetched values and ignore stale in-flight responses', async ({ page }) => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  let finished!: () => void;
  const delivered = new Promise<void>(resolve => { finished = resolve; });
  let requests = 0;
  await page.route('**/api/data/household', async route => {
    requests += 1;
    if (requests > 1) {
      started!();
      await new Promise<void>(resolve => { release = resolve; });
    }
    await route.fulfill({ json: { data: { name: 'Previously fetched' }, mode: 'sample' } });
    if (requests > 1) finished();
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Data sources/ }).click();
  await page.getByLabel('Allow fetching configured data for this preview session').check();
  await page.locator('.page-row').filter({ hasText: /^Settings/ }).click();
  await expect(page.locator('[data-component-id="settings-profile"] .native-copy strong')).toHaveText('Previously fetched');
  await page.getByRole('button', { name: /^Data sources/ }).click();
  await page.getByRole('button', { name: 'Fetch preview data', exact: true }).click();
  await waiting;
  await page.getByLabel('Sample data JSON').fill('{"name":"Current sample"}');
  await page.getByLabel('Source name', { exact: true }).click();
  release!();
  await delivered;
  await page.locator('.page-row').filter({ hasText: /^Settings/ }).click();
  await expect(page.locator('[data-component-id="settings-profile"] .native-copy strong')).toHaveText('Current sample');
});

test('carousel rows and columns determine paging and header actions drive sorting and filters', async ({ page, request }) => {
  const draft = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.variables.category = '';
  document.variables.direction = 'asc';
  document.dataSources.push({ id: 'records', name: 'Records', kind: 'static', refreshSeconds: 60, sample: Array.from({ length: 13 }, (_, index) => ({ id: index + 1, title: `Item ${index + 1}`, category: index % 2 ? 'even' : 'odd' })) });
  document.pages[0].components = [{ id: 'paged', type: 'carousel', title: 'Records', layout: { span: 2 }, binding: { sourceId: 'records' }, props: { columns: 2, rows: 2, sortBy: 'title', sortDirectionVariable: 'direction', filterPath: 'category', filterVariable: 'category' } }];
  document.pages[0].toolbar = [
    { id: 'reverse', label: 'Reverse order', icon: 'ArrowDown', placement: 'trailing', action: { type: 'set', variable: 'direction', value: 'desc' } },
    { id: 'filter', label: 'Only odd items', icon: 'Filter', placement: 'trailing', action: { type: 'set', variable: 'category', value: 'odd' } },
  ];
  expect((await request.put('/api/draft', { data: { document, expectedRevision: draft.revision } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  const cards = page.locator('.native-carousel .record-copy strong');
  await expect(cards).toHaveText(['Item 1', 'Item 2', 'Item 3', 'Item 4']);
  await expect(page.getByText('Page 1 of 4', { exact: true })).toBeVisible();
  const boxes = await page.locator('.category-card').evaluateAll(elements => elements.map(element => {
    const { x, y } = element.getBoundingClientRect(); return { x, y };
  }));
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  expect(boxes[1].y).toBe(boxes[0].y);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
  await page.getByRole('button', { name: 'Next collection page' }).click();
  await expect(cards).toHaveText(['Item 5', 'Item 6', 'Item 7', 'Item 8']);
  await page.getByRole('button', { name: 'Previous collection page' }).click();
  await page.getByRole('button', { name: 'Reverse order', exact: true }).click();
  await expect(cards.first()).toHaveText('Item 13');
  await page.getByRole('button', { name: 'Only odd items', exact: true }).click();
  await expect(cards).toHaveText(['Item 13', 'Item 11', 'Item 9', 'Item 7']);
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
});

test('validated root-relative URL actions open against the current origin', async ({ page, request }) => {
  const draft = await (await request.get('/api/draft')).json();
  const document = createSampleDocument();
  document.pages[0].components = [{ id: 'help', type: 'action-tile', title: 'Help link', props: {}, action: { type: 'url', url: '/help' } }];
  expect((await request.put('/api/draft', { data: { document, expectedRevision: draft.revision } })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    window.open = url => { window.document.documentElement.dataset.openedUrl = String(url); return null; };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.getByRole('region', { name: 'Device canvas' }).getByRole('button', { name: 'Help link', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-opened-url', new URL('/help', page.url()).href);
});
