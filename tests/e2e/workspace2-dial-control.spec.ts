import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, snap } from './workspace2-helpers';
import { newClimateSource, newDialControl, newThermostat } from '../../src/shared/composition/dial-control-edit';

/**
 * The Dial Control (`sh.dial-control@1`) in the workspace, on desktop and phone: adding one, one stopper or two, Stay Apart by a number and by a value,
 * dragging and arrow keys in Use, and the Thermostat preset, which leaves the thermostat's document as it was. The entities and names are invented.
 * Captures (light and dark) go to `STUDIO_EVIDENCE_DIR`.
 */
type J = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; components: unknown[] }[]; dataSources: unknown[] } };
const lit = (value: unknown) => ({ type: 'literal', value });
const base = { id: 'study-dial', title: 'Study humidity', layout: { span: 1 } };
const dial = (start: 'one' | 'range', tweak?: (node: J) => void): J => { const node = newDialControl(start, base, { min: 20, max: 80, step: 1 }) as J; tweak?.(node); return node; };
function documentWith(node: J, sources: unknown[] = []) {
  const copy = structuredClone(fixture.document);
  copy.pages.find(page => page.id === 'page-home')!.components = [node];
  copy.dataSources.push(...sources);
  return copy;
}
const where = (page: Page) => (isPhone(page) ? 'phone' : 'desktop');
const dialBox = (page: Page) => page.getByTestId('dial-control').locator('svg');
const stopper = (page: Page, id: string) => page.getByTestId(`stopper-${id}`);
const value = async (page: Page, id: string) => Number(await stopper(page, id).getAttribute('aria-valuenow'));
/** The point on the 316 pt ring (as drawn, scaled) where a value of the 20 to 80 range stands. */
async function onRing(page: Page, at: number) {
  const box = (await dialBox(page).boundingBox())!;
  const angle = (135 + 270 * ((at - 20) / 60)) * Math.PI / 180, radius = (145 / 320) * box.width;
  return { x: box.x + box.width / 2 + radius * Math.cos(angle), y: box.y + box.height / 2 + radius * Math.sin(angle) };
}
async function dragTo(page: Page, id: string, to: number) {
  const from = await onRing(page, await value(page, id)), target = await onRing(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
}
const use = async (page: Page) => {
  // On a phone the properties sheet covers the bar: close it first.
  const close = page.getByLabel('Properties').getByRole('button', { name: 'Close', exact: true });
  if (isPhone(page) && await close.isVisible().catch(() => false)) await close.click();
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
};
const edit = async (page: Page) => { await page.getByRole('button', { name: 'Edit', exact: true }).first().click(); };
/** Selects the dial in the preview: its ring, never a stopper (a stopper is inert in Edit and passes the click on). */
const select = async (page: Page) => { await dialBox(page).click({ position: { x: 20, y: 20 }, force: true }); await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Study humidity' })).toBeVisible(); };
/** Brings a group of the inspector on screen and checks it is there: on a phone the sheet goes full height first, then scrolls to the group. */
async function reveal(page: Page, name: string) {
  const group = page.getByLabel('Properties').getByRole('region', { name, exact: true });
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await group.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await expect(group.getByRole('heading', { name, exact: true })).toBeInViewport({ ratio: 0.9 });
}
const pickMenu = async (page: Page, name: string, option: string) => {
  await page.getByLabel('Properties').getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

test('adding a dial control gives one stopper, and Add Stopper makes it two with the rule between', async ({ page, request }) => {
  await seed(request);
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  await picker.getByRole('listitem').filter({ hasText: 'Dial Control' }).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'New dial control' })).toBeVisible();
  for (const title of ['Start From', 'Range', 'Stoppers', 'When Released', 'Middle', 'States']) await expect(panel.getByRole('region', { name: title })).toBeAttached();
  await expect(panel.getByRole('region', { name: 'Between Stoppers' })).toHaveCount(0);
  await expect(page.getByTestId('dial-control').getByRole('slider')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Add Stopper' }).click();
  await expect(page.getByTestId('dial-control').getByRole('slider')).toHaveCount(2);
  await expect(panel.getByRole('region', { name: 'Between Stoppers' })).toBeAttached();
  await expect(panel.getByRole('button', { name: 'Add Stopper' })).toHaveCount(0);
});

test('Stay Apart by a number is written by the inspector and held by the dial', async ({ page, request }) => {
  await seed(request, documentWith(dial('range')));
  await openWorkspace(page);
  await select(page);
  const panel = page.getByLabel('Properties');
  await pickMenu(page, 'Rule', 'Stay Apart');
  await expect(panel.getByLabel('Gap', { exact: true })).toBeVisible();
  await panel.getByLabel('Gap', { exact: true }).fill('10');
  await panel.getByLabel('Gap', { exact: true }).blur();
  await use(page);
  // Low is 35 and high is 65: low may go no higher than 55.
  await dragTo(page, 'low', 75);
  expect(await value(page, 'low')).toBe(55);
  await stopper(page, 'low').focus();
  await page.keyboard.press('ArrowUp');
  expect(await value(page, 'low')).toBe(55);
});

test('Stay Apart by a value holds the gap an entity reports', async ({ page, request }) => {
  const source = { id: 'gap-source', kind: 'ha-entity', entityId: lit('input_number.demo_gap') };
  const read = { type: 'read', from: { type: 'source', sourceId: 'gap-source', path: ['state'] }, as: 'number', missing: 'unavailable' };
  const node = dial('range', item => { item.props.between = { rule: 'stop', gap: read }; });
  await seed(request, documentWith(node, [source]));
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: [{ entityId: 'input_number.demo_gap', name: 'Demo gap', state: '8' }] } }));
  await openWorkspace(page);
  await use(page);
  await dragTo(page, 'low', 75);
  expect(await value(page, 'low')).toBe(57);
});

test('arrow keys move a focused stopper by its step, and a drag follows the finger', async ({ page, request }) => {
  await seed(request, documentWith(dial('one', node => { node.props.range.step = 5; })));
  await openWorkspace(page);
  await use(page);
  await stopper(page, 'target').focus();
  await page.keyboard.press('ArrowUp');
  expect(await value(page, 'target')).toBe(55);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await value(page, 'target')).toBe(45);
  await dragTo(page, 'target', 70);
  expect(await value(page, 'target')).toBe(70);
  await expect(page.getByTestId('dial-control').locator('strong')).toHaveText('70');
  await edit(page);
  await stopper(page, 'target').focus({ timeout: 2000 }).catch(() => undefined);
  await page.keyboard.press('ArrowUp');
  expect(await value(page, 'target')).toBe(70);
});

test('one stopper and two: the readout and the stoppers follow what is authored', async ({ page, request }) => {
  await seed(request, documentWith(dial('range')));
  await openWorkspace(page);
  const rim = page.getByTestId('dial-control');
  await expect(rim.getByRole('slider')).toHaveCount(2);
  await expect(rim.locator('.sh-dc-readout span')).toHaveText('35 · 65');
  await select(page);
  await page.getByLabel('Properties').getByRole('button', { name: /^High/ }).first().click();
  await page.getByLabel('Properties').getByRole('button', { name: 'Remove Stopper High' }).click();
  await expect(rim.getByRole('slider')).toHaveCount(1);
});

test('the Thermostat preset is a view: the thermostat dial opens as Dial Control and its document is unchanged', async ({ page, request }) => {
  const source = newClimateSource('climate-demo', 'climate.demo_hall');
  const thermostat = newThermostat(base, 'climate-demo') as J;
  const seeded = documentWith(thermostat, [source]);
  await seed(request, seeded);
  await openWorkspace(page);
  await page.locator('.sh-dv-dial').first().click({ position: { x: 20, y: 20 } });
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('region', { name: 'Start From' })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Preset' })).toContainText('Thermostat');
  await expect(panel.getByText('Set by the thermostat').first()).toBeVisible();
  const draft = await (await request.get('/native/api/draft')).json();
  const node = (draft.document.pages.find((item: J) => item.id === 'page-home').components as J[])[0];
  expect(node).toEqual(thermostat);
  // Leaving the preset and coming back makes a thermostat that reads the same source and publishes as a climate control.
  await pickMenu(page, 'Preset', 'Range');
  await expect(page.getByTestId('dial-control')).toBeVisible();
  await pickMenu(page, 'Preset', 'Thermostat');
  await expect(page.locator('.sh-dv-dial').first()).toBeVisible();
  await expect(panel.getByText('Set by the thermostat').first()).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the inspector and the dial in the ${scheme} Studio`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await seed(request, documentWith(dial('range', node => { node.props.between = { rule: 'stop', gap: lit(5) }; node.props.ticks = { every: 10 }; })));
    await openWorkspace(page);
    await select(page);
    const panel = page.getByLabel('Properties');
    await snap(page, `${where(page)}-${scheme}-inspector`);
    // The phone sheet scrolls: each group is brought into view before its capture.
    await reveal(page, 'Stoppers');
    await snap(page, `${where(page)}-${scheme}-stoppers`);
    await reveal(page, 'Between Stoppers');
    await expect(panel.getByLabel('Gap', { exact: true })).toBeInViewport();
    await snap(page, `${where(page)}-${scheme}-stay-apart`);
    await use(page);
    await dialBox(page).scrollIntoViewIfNeeded();
    await snap(page, `${where(page)}-${scheme}-dial`);
    // A stopper held at its stop: the stop mark shows until it is let go.
    const from = await onRing(page, await value(page, 'low')), target = await onRing(page, 75);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(page.getByTestId('stop-mark')).toBeVisible();
    await snap(page, `${where(page)}-${scheme}-held-at-stop`);
    await page.mouse.up();
    await expect(page.getByTestId('stop-mark')).toHaveCount(0);
  });

  test(`the Thermostat preset in the ${scheme} Studio`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await seed(request, documentWith(newThermostat(base, 'climate-demo') as J, [newClimateSource('climate-demo', 'climate.demo_hall')]));
    await openWorkspace(page);
    await page.locator('.sh-dv-dial').first().click({ position: { x: 20, y: 20 } });
    const panel = page.getByLabel('Properties');
    await expect(panel.getByText('Set by the thermostat').first()).toBeVisible();
    await reveal(page, 'Stoppers');
    await expect(panel.getByText('Set by the thermostat').first()).toBeInViewport();
    await snap(page, `${where(page)}-${scheme}-thermostat-preset`);
  });
}
