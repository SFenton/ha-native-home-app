import { expect, test, type Page } from '@playwright/test';
import { compileCompositionDocument } from '../../src/shared/composition/compiler';
import { createCompositionDocument } from '../../src/shared/composition/workspace';
import { encodeStudioCanvas } from '../../src/shared/composition/studio-logic';
import { liftField } from '../../src/workspace2/logic-fields/registry';
import { isPhone, openLibrary, seed, waitForWorkspace } from './workspace2-helpers';

async function openCanvas(page: Page) {
  let panel;
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    panel = page.locator('.w2-data');
  } else {
    await openLibrary(page, 'Flows');
    panel = page.getByTestId('flows-panel');
  }
  const group = panel.getByRole('button', { name: /^Flows, \d+$/ });
  if (await group.count() && await group.getAttribute('aria-expanded') === 'false') await group.click();
  await panel.getByRole('button', { name: /^Compact entities/ }).first().click();
  await page.getByTestId('flow-editor').getByRole('button', { name: 'Edit Flow in Canvas', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}

test('persisted compact cards keep neighbouring headers clickable and Tidy Up separates selected chrome', async ({ page, request }) => {
  const document = compileCompositionDocument({
    ...createCompositionDocument('demo-compact-layout'),
    dataSources: [{
      id: 'demo-compact-flow', kind: 'model', model: 'pipeline@1', inputs: {
        title: 'Compact entities', parameters: [],
        request: { type: 'entities', entityIds: [{ type: 'literal', value: 'light.demo_compact' }], attributes: [] },
        steps: [{ id: 'on', op: 'filter', where: {
          type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: 'on' },
        } }],
        output: { kind: 'rows', max: 4, row: { id: { type: 'item', path: ['entityId'] }, title: { type: 'item', path: ['entityId'] } } },
        schema: { kind: 'array', of: { kind: 'object', fields: { entityId: { shape: { kind: 'string' } }, state: { shape: { kind: 'string' } } } } },
      },
    }],
  }).document;
  const graph = liftField(document, ['dataSources', 0], 'flow').graph;
  const positions = Object.fromEntries(graph.nodes.map((node, index) => [node.id,
    node.payload.kind === 'request' ? { x: 24, y: 24 } : node.payload.kind === 'step' ? { x: 24, y: 144 }
      : { x: 450 + index * 260, y: 24 },
  ]));
  const studioCanvas = encodeStudioCanvas(document, [{ id: 'demo-compact-canvas', roots: graph.roots.map(root => ({
    anchor: root.anchor, nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, ...positions[node.id] })),
  })) }]);
  await seed(request, { ...document, studioCanvas });
  await page.route('**/api/native-home', route => route.fulfill({ json: {
    mode: 'live', houseConfig: { schema: 2, hash: 'demo-compact', config: {} },
    states: [{ entityId: 'light.demo_compact', name: 'Demo compact light', state: 'on' }],
    currentUser: { id: 'demo-owner', name: 'Demo owner', isOwner: true, isAdmin: true },
  } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForWorkspace(page);
  await openCanvas(page);
  const many = page.getByRole('button', { name: /^Select Many Entities \d+/ });
  const filter = page.getByRole('button', { name: /^Select Filter \d+/ });
  const closePeek = () => page.getByRole('button', { name: /^Close (data peek|Data peek:)/ }).click();
  await many.click();
  await closePeek();
  if (isPhone(page)) await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  else await page.getByRole('button', { name: 'Rename or describe Many Entities', exact: true }).click();
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill('My entities');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Read the configured demo entities and keep the ones that are on.');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Close block inspector', exact: true }).click();
  await filter.click();
  await closePeek();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  const annotated = page.getByRole('button', { name: /^Select My entities, Many Entities \d+/ });
  await annotated.click();
  await closePeek();
  const unchanged = await page.locator('.w2-canvas-node').evaluateAll(cards =>
    Object.fromEntries(cards.map(card => [card.getAttribute('data-node-id'), { x: (card as HTMLElement).style.left, y: (card as HTMLElement).style.top }])));
  const requestNode = graph.nodes.find(node => node.payload.kind === 'request')!;
  const stepNode = graph.nodes.find(node => node.payload.kind === 'step')!;
  expect(parseFloat(unchanged[stepNode.id].y) - parseFloat(unchanged[requestNode.id].y)).toBe(120);
  await page.getByRole('button', { name: 'Tidy Up', exact: true }).click();
  await expect(page.locator('.w2-canvas-footer [role=status]')).toHaveText(/Tidied: wire crossings \d+ → \d+/);
  const overlaps = await page.locator('.w2-canvas-node').evaluateAll(cards => {
    const boxes = cards.map(card => {
      const rect = card.getBoundingClientRect();
      const scale = rect.width / (card as HTMLElement).offsetWidth;
      const reserve = card.querySelector('.w2-canvas-node-actions') ? 0 : innerWidth < 600 ? 55 : 45;
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom + reserve * scale };
    });
    return boxes.some((a, i) => boxes.slice(i + 1).some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
  });
  expect(overlaps).toBe(false);
  await annotated.click();
  await closePeek();
  await page.getByRole('button', { name: 'Rename or describe My entities, Many Entities', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Read only the configured demo entities.');
  await page.getByRole('button', { name: 'Apply details', exact: true }).click();
  await filter.click();
  await closePeek();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
});
