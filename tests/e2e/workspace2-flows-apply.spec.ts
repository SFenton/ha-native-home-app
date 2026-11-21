import { expect, test, type Page } from '@playwright/test';
import { demoLights, lightsDocument } from '../flows-canvas/canvas/lights-fixture';
import { isPhone, openLibrary, seed, waitForWorkspace } from './workspace2-helpers';

async function openFlow(page: Page) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
  } else await openLibrary(page, 'Flows');
  const panel = isPhone(page) ? page.locator('.w2-data') : page.getByTestId('flows-panel');
  const group = panel.getByRole('button', { name: /^Flows, \d+$/ });
  if (await group.count() && await group.getAttribute('aria-expanded') === 'false') await group.click();
  await panel.getByRole('button', { name: /^Selected Lights On/ }).first().click();
  await page.getByRole('button', { name: 'Edit Flow in Canvas', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}
test('whole data flow: sequential annotations, Tidy Up, Apply and reload preserve block details and positions', async ({ page, request }) => {
  test.setTimeout(120_000);
  await seed(request, lightsDocument());
  await page.route('**/api/native-home', route => route.fulfill({ json: {
    mode: 'live', houseConfig: { schema: 2, hash: 'demo-flow', config: {} },
    states: demoLights.map(entityId => ({ entityId, name: entityId, state: 'on' })),
    currentUser: { id: 'demo-owner', name: 'Demo Owner', isOwner: true, isAdmin: true },
  } }));
  await page.route('**/native/api/ha/flow-run', route => route.fulfill({ json: { response: [], at: '2026-11-21T22:00:00Z' } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await waitForWorkspace(page);
  await openFlow(page);
  const before = (await (await request.get('/native/api/draft')).json()).revision;
  const cards = page.locator('.w2-canvas-node');
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-node-id')!));
  const matchId = await page.getByRole('button', { name: /^Select Match Value / }).locator('xpath=ancestor::li[1]').getAttribute('data-node-id');
  const match = page.locator(`.w2-canvas-node[data-node-id="${matchId}"]`);
  const annotate = async (id: string, label: string) => {
    const block = page.locator(`.w2-canvas-node[data-node-id="${id}"]`);
    await block.getByRole('button', { name: /^Select / }).click();
    const peek = page.getByRole('button', { name: /^Close (data peek|Data peek:)/ });
    if (await peek.isVisible()) await peek.click();
    await block.getByRole('button', { name: /^Rename or describe / }).click();
    await block.getByRole('textbox', { name: 'Label', exact: true }).fill(label);
    await block.getByRole('textbox', { name: 'Description', exact: true }).fill(`Purpose of ${label}.`);
    await block.getByRole('button', { name: 'Apply details', exact: true }).click();
    await expect(block.getByRole('form', { name: 'Block details' })).toHaveCount(0);
    await expect(block.getByRole('button', { name: /^Select / })).toHaveAttribute('aria-pressed', 'true');
  };
  for (const [index, id] of ids.filter(id => id !== matchId).slice(0, 12).entries()) await annotate(id, `Light block ${index + 1}`);
  await annotate(matchId!, 'Friendly lights');
  await match.getByRole('button', { name: /^Rename or describe / }).click();
  await match.getByRole('textbox', { name: 'Label', exact: true }).fill('Cancelled label');
  await match.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(match.getByRole('form', { name: 'Block details' })).toHaveCount(0);
  const other = page.locator(`.w2-canvas-node[data-node-id="${ids.find(id => id !== matchId)}"]`);
  await other.getByRole('button', { name: /^Select / }).click();
  const peek = page.getByRole('button', { name: /^Close (data peek|Data peek:)/ });
  if (await peek.isVisible()) await peek.click();
  await expect(other.getByRole('button', { name: /^Select / })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Tidy Up', exact: true }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const positions = await cards.evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.getAttribute('data-node-id'), {
    x: (node as HTMLElement).style.left, y: (node as HTMLElement).style.top,
  }])));
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.locator('.w2-canvas-footer [role=status]')).toHaveText('Edits applied to the draft. Not published.');
  await expect.poll(async () => {
    const draft = (await (await request.get('/native/api/draft')).json());
    return draft.revision > before && Boolean(draft.document.studioCanvas) && JSON.stringify(draft.document.studioCanvas).includes('Friendly lights');
  }).toBe(true);
  const saved = (await (await request.get('/native/api/draft')).json()).document;
  expect(saved.studioCanvas.canvases.flatMap((canvas: { nodes: unknown[] }) => canvas.nodes)).toHaveLength(ids.length);
  expect(JSON.stringify(saved.studioCanvas)).toContain('Friendly lights');
  await page.reload(); await waitForWorkspace(page); await openFlow(page);
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Select Friendly lights, Match Value / })).toBeVisible();
  await expect(match.locator('.w2-canvas-node-note')).toHaveText('Purpose of Friendly lights.');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  expect(await cards.evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.getAttribute('data-node-id'), {
    x: (node as HTMLElement).style.left, y: (node as HTMLElement).style.top,
  }])))).toEqual(positions);
});
