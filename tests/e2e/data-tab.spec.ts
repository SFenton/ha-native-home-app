import { test, expect, panelDocument, haToken } from './data-tab-harness';
import { isPhone, openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';
import type { Page } from '@playwright/test';
import { replaceAt } from '../../src/composition-editor';
import type { CompositionDocument, CompositionRead } from '../../src/shared/composition/schema';
import { newFlow } from '../../src/workspace2/data/flow';

async function openData(page: Page) {
  if (!isPhone(page)) return openLibrary(page, 'Data');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.locator('.w2-project-sheet').getByRole('button', { name: 'Data', exact: true }).click();
}

test.beforeEach(async ({ request, ha }) => {
  ha.setEntity('switch.demo_light_1', 'on');
  await seed(request, panelDocument());
});

test('Data is read-only, grouped by area, with live state and named readers', async ({ page, ha }) => {
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  await expect(panel.getByText('From Home Assistant · read only')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'In Use · 5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Everything · 8' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Kitchen, 2' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'Hall, 2' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'No Area, 1' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: 'Kitchen, 2' })).toContainText('Desk Lamp, Kitchen Lamp');
  await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
  const lamp = panel.locator('.w2-ha-entity').filter({ hasText: 'Kitchen Lamp' });
  await expect(lamp.locator('.w2-ha-state')).toHaveText('on');
  await expect(lamp.locator('.w2-ha-readers')).toContainText('Lights');
  await expect(lamp.locator('.w2-ha-readers')).toContainText('Kitchen Lights');
  ha.setEntity('switch.demo_light_1', 'off');
  await expect(lamp.locator('.w2-ha-state')).toHaveText('off');
  await expect(panel).not.toContainText('demo-light-1');
  await expect(panel).not.toContainText('switch.demo_light_1');
  await expect(panel.getByRole('region', { name: 'Logic Templates' })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Data Flows' })).toHaveCount(0);
  await expect(panel.getByText('Listed while a tile or flow reads it. Nothing to add or clean up.')).toBeVisible();
  await panel.getByRole('button', { name: 'Everything · 8' }).click();
  await expect(panel.getByRole('button', { name: 'Loft, 1' })).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('searchbox', { name: 'Find an entity, device or area' }).fill('Loft');
  await expect(panel.getByRole('button', { name: 'Loft, 1' })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Loft Temperature', { exact: true })).toBeVisible();
  await expect(panel.getByText('24.3 C', { exact: true })).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Find an entity, device or area' }).fill('Entry Hub');
  await expect(panel.getByText('Hall Lamp', { exact: true })).toBeVisible();
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(haToken);
  await expect(panel.getByRole('region', { name: 'From Home Assistant', exact: true }).getByRole('button', { name: 'Source', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'App and model sources' }).getByRole('button', { name: 'Source', exact: true })).toBeVisible();
  const search = panel.getByRole('searchbox');
  await expect(search).toHaveAttribute('placeholder', 'Find an entity or area');
  expect(await search.evaluate(input => {
    const style = getComputedStyle(input), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    context.font = style.font;
    return context.measureText(input.getAttribute('placeholder')!).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  })).toBe(true);
});

test('App and Models remain editable and Source creation opens its fields', async ({ page }) => {
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  await panel.getByRole('button', { name: 'App, 1' }).click();
  await panel.getByRole('button', { name: /^Clock, source,/ }).click();
  await expect(page.locator('[data-field-path^="dataSources/"]').first()).toBeVisible();
  if (isPhone(page)) await page.locator('.w2-back').click();
  await panel.getByRole('region', { name: 'App and model sources' }).getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Weather', exact: true }).click();
  const editor = isPhone(page) ? page.getByRole('dialog', { name: 'Project', exact: true }) : page.getByRole('complementary', { name: 'Properties' });
  await expect(editor.getByRole('heading', { name: 'Weather', exact: true })).toBeVisible();
  const value = editor.getByRole('textbox', { name: 'Value', exact: true });
  await value.fill('weather.demo_forecast');
  await value.press('Tab');
  await expect(value).toHaveValue('weather.demo_forecast');
});

for (const surface of ['page', 'sheet level']) test(`In Use includes a placed private source passed through logic on a ${surface}`, async ({ page, request }) => {
  const base = panelDocument();
  const document: CompositionDocument = {
    ...base,
    dataSources: base.dataSources.filter(source => source.id === 'demo-light-3'),
    logicLibrary: [{
      id: 'private-value', name: 'Private value', kind: 'operand',
      params: [{ name: 'src', kind: 'source-id', sample: 'demo-light-3' }],
      body: { type: 'read', from: { type: 'source', sourceId: { type: 'hole', name: 'src' }, path: ['state'] }, as: 'string', missing: 'unavailable' },
    }],
    componentLibrary: [{
      id: 'saved-lamp', name: 'Saved lamp',
      node: { id: 'lamp-value', title: 'Placed lamp', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Lamp' }, style: 'body', unavailableText: 'Unavailable' } },
      sources: [{ id: 'private-lamp', kind: 'ha-entity', entityId: { type: 'literal', value: 'switch.demo_light_2' } }],
      params: [{ name: 'entity', kind: 'entity-id' }],
      bindings: [{ param: 'entity', sourceId: 'private-lamp', field: 'entityId/value' }],
    }],
    pages: [{ ...base.pages[0], components: [{ id: 'placed-lamp', type: 'component-ref', componentId: 'saved-lamp', layout: { span: 1 }, args: { entity: 'switch.demo_light_1' } }] }],
    modals: [],
  };
  if (surface === 'sheet level') {
    const { navigation: _navigation, ...level } = document.pages[0];
    document.levels = [{ ...level, id: 'lamp-level', toolbar: { type: 'replace', groups: [] } }];
    document.pages = [{ ...document.pages[0], components: [] }];
  }
  await seed(request, replaceAt(document, ['componentLibrary', 0, 'node', 'props', 'value'], { type: 'expr', value: { type: 'logic-ref', logicId: 'private-value', args: { src: 'private-lamp' } } }));
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  await expect(panel.getByRole('button', { name: 'In Use · 3' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
  const lamp = panel.locator('.w2-ha-entity').filter({ hasText: 'Kitchen Lamp' });
  await expect(lamp.locator('.w2-ha-readers')).toHaveText('Placed lamp');
  await expect(lamp.locator('.w2-ha-state')).toHaveText('on');
  await expect(panel.locator('.w2-ha-entity').filter({ hasText: 'Desk Lamp' }).locator('.w2-ha-readers')).toHaveText('Private value');
  await panel.getByRole('button', { name: 'Hall, 1' }).click();
  await expect(panel.locator('.w2-ha-entity').filter({ hasText: 'Hall Lamp' }).locator('.w2-ha-readers')).toHaveText('Saved lamp');
});

test('In Use includes unconsumed source and private-flow definition readers', async ({ page, request }) => {
  const base = panelDocument();
  const read = (sourceId: string) => ({ type: 'read', from: { type: 'source', sourceId, path: ['attributes', 'entity_id'] }, as: 'entity-id', missing: 'unavailable' } satisfies CompositionRead);
  const flow = newFlow(base, 'none', { title: 'Private flow' }).document.dataSources.at(-1)!;
  if (flow.kind !== 'model' || flow.model !== 'pipeline@1') throw new Error('Expected the new flow');
  await seed(request, {
    ...base,
    dataSources: [
      ...base.dataSources.filter(source => ['demo-light-1', 'demo-light-2', 'demo-light-3'].includes(source.id)),
      { id: 'entity-input', kind: 'ha-entity', entityId: read('demo-light-1') },
      { id: 'model-input', kind: 'model', model: 'power-toggle@1', inputs: { entityId: read('demo-light-2') } },
    ],
    componentLibrary: [{
      id: 'saved-flow', name: 'Saved flow',
      node: { id: 'caption', title: 'Caption', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'No flow consumer' }, style: 'body', unavailableText: 'Unavailable' } },
      flows: [{ ...flow, inputs: { ...flow.inputs, parameters: [{ name: 'input', type: 'string', value: { ...read('demo-light-3'), as: 'string', from: { type: 'source', sourceId: 'demo-light-3', path: ['state'] } } }], request: { type: 'none', value: { type: 'param', name: 'input' } } } }],
    }],
    logicLibrary: [], pages: [{ ...base.pages[0], components: [] }], modals: [],
  });
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  await expect(panel.getByRole('button', { name: 'In Use · 3' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
  await expect(panel.locator('.w2-ha-entity').filter({ hasText: 'Kitchen Lamp' }).locator('.w2-ha-readers')).toHaveText('Entity');
  await expect(panel.locator('.w2-ha-entity').filter({ hasText: 'Desk Lamp' }).locator('.w2-ha-readers')).toHaveText('Saved flow');
  await panel.getByRole('button', { name: 'Hall, 1' }).click();
  await expect(panel.locator('.w2-ha-entity').filter({ hasText: 'Hall Lamp' }).locator('.w2-ha-readers')).toHaveText('Power switch');
});

test('area groups remember expansion and a selected component reveals the entities it reads', async ({ page }) => {
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel');
  const kitchen = panel.getByRole('button', { name: 'Kitchen, 2' });
  await kitchen.click();
  await page.reload();
  if (isPhone(page)) await openData(page);
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await kitchen.click();
  if (isPhone(page)) return;
  await openLibrary(page, 'Flows');
  const flows = page.getByTestId('flows-panel');
  await flows.getByRole('button', { name: /^Inside a Field, / }).click();
  await flows.getByRole('region', { name: 'Inside a Field' }).getByRole('button', { name: /^Lights · / }).first().click();
  await openData(page);
  await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
});

test('Data disclosures still work when localStorage is denied', async ({ page }) => {
  await page.addInitScript(() => { for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { value() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await openWorkspace(page);
  await openData(page);
  const panel = page.getByTestId('data-panel'), kitchen = panel.getByRole('button', { name: 'Kitchen, 2' });
  await expect(kitchen).toHaveAttribute('aria-expanded', 'false');
  await kitchen.click();
  await expect(panel.getByText('Kitchen Lamp', { exact: true })).toBeVisible();
  const preview = panel.locator('.w2-group-preview').first();
  expect(await preview.evaluate(element => getComputedStyle(element).textAlign)).toBe('start');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Data panel evidence in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    await openData(page);
    const panel = page.getByTestId('data-panel');
    await panel.getByRole('button', { name: 'Kitchen, 2' }).click();
    await panel.getByRole('button', { name: 'Hall, 2' }).click();
    if (!isPhone(page)) await snap(page, `desktop-${scheme}-data`);
  });
}
