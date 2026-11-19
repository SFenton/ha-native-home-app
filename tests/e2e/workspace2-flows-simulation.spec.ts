import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { CHORES_RESPONSE } from '../flows-canvas/simulation/data';

const harness = './tests/flows-canvas/simulation/harness.html';
const harnessHTML = readFileSync(new URL('../flows-canvas/simulation/harness.html', import.meta.url), 'utf8')
  .replace('<script type="module" src="./harness.tsx">', `<script type="module">
    import RefreshRuntime from "./@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script><script type="module" src="./tests/flows-canvas/simulation/harness.tsx">`);
async function attachNetwork(info: TestInfo, value: unknown) {
  const path = info.outputPath('intercepted-network.json');
  writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach('intercepted-network.json', { path, contentType: 'application/json' });
}
const output = (page: Page, name: string) => page.getByRole('article', { name: `Output ${name}`, exact: true }).locator('output');
async function open(page: Page) {
  const network: { method: string; url: string }[] = [];
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/*', async route => {
    const request = route.request();
    if (['fetch', 'xhr'].includes(request.resourceType())) network.push({ method: request.method(), url: request.url() });
    if (new URL(request.url()).pathname.endsWith('/simulation/harness.html')) {
      await route.fulfill({ body: harnessHTML, contentType: 'text/html' });
    } else if (new URL(request.url()).pathname.endsWith('/native/api/ha/flow-run')) {
      await route.fulfill({ json: { source: 'live', at: '2026-11-18T23:59:59.000Z', response: CHORES_RESPONSE, output: 6, items: 8 } });
    } else await route.continue();
  });
  await page.goto(harness);
  await expect(output(page, 'Chores count')).toHaveText('6');
  expect(network).toHaveLength(1);
  expect(network[0].url).toMatch(/\/native\/api\/ha\/flow-run$/);
  return network;
}
async function inspectBedroom(page: Page) {
  await page.getByRole('button', { name: 'Inspect Bedroom', exact: true }).click();
  return page.getByRole('region', { name: 'Where its value comes from' });
}
async function closeInspector(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Simulation inspector', exact: true });
  if (await sheet.isVisible()) await sheet.getByRole('button', { name: 'Done', exact: true }).click();
}
async function scenarios(page: Page) {
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  return page.getByRole('dialog', { name: 'Scenarios', exact: true });
}
test('S-pins / S-trace: pin, Live, clock edge, actual drawers and no simulation network', async ({ page }, info) => {
  const network = await open(page), initialReads = network.length;
  await expect(output(page, 'Bedroom')).toHaveText('21.9 °C');
  const inspector = await inspectBedroom(page);
  await inspector.getByRole('radio', { name: /^Pin a number/ }).check();
  await inspector.getByLabel('Number for Bedroom', { exact: true }).fill('25');
  await inspector.getByRole('button', { name: 'Apply pin', exact: true }).click();
  await closeInspector(page);
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  await expect(output(page, 'Bedroom')).toHaveText('25.0 °C');
  await page.screenshot({ path: info.outputPath('pinned-too-warm.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Each Run & Items', exact: true }).first().click();
  const evidence = page.getByRole('dialog', { name: 'Run evidence', exact: true });
  await evidence.getByRole('button', { name: 'Items', exact: true }).click();
  await expect(evidence.getByRole('region', { name: 'Chores count items evidence', exact: true }).getByText('8 before / 6 after', { exact: true })).toBeVisible();
  await expect(evidence.getByRole('region', { name: 'Chores display items evidence', exact: true }).getByText('First Few cut: 1. Earlier counts are unchanged.', { exact: true })).toBeVisible();
  await evidence.getByRole('combobox', { name: 'Show items', exact: true }).click();
  await page.getByRole('option', { name: 'Dropped', exact: true }).click();
  await expect(evidence.getByRole('region', { name: 'Chores count items evidence', exact: true }).getByRole('list', { name: 'Keep Where items' })).toHaveAttribute('data-total', '2');
  await evidence.getByRole('button', { name: 'Each Run', exact: true }).click();
  const lights = evidence.getByRole('region', { name: 'Lights on each evidence', exact: true });
  await expect(lights.getByText('Actual output: 1', { exact: true })).toBeVisible();
  await expect(lights.getByRole('list', { name: 'Lights on iterations' })).toHaveAttribute('data-total', '3');
  await lights.getByRole('button', { name: /1\. Lamp/ }).click();
  await expect(lights.getByRole('heading', { name: 'Actual raw reads' })).toBeVisible();
  await evidence.getByRole('button', { name: 'Close Run evidence', exact: true }).click();
  await inspectBedroom(page);
  await page.getByRole('group', { name: 'Source', exact: true }).getByRole('button', { name: 'Pinned', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill('2026-11-19');
  await page.getByLabel('Pinned time', { exact: true }).fill('00:00');
  await closeInspector(page);
  await expect(output(page, 'Today')).toHaveText('Nov 19, 2026');
  expect(network).toHaveLength(1);
  const simulationFetches = network.length - initialReads;
  await page.getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Live', exact: true }).click();
  await expect(output(page, 'Bedroom')).toHaveText('21.9 °C');
  await expect(output(page, 'Subtitle')).toHaveText('Comfortable');
  await expect(output(page, 'Today')).toHaveText('Nov 18, 2026');
  await page.screenshot({ path: info.outputPath('live-restored.png'), animations: 'disabled' });
  await attachNetwork(info, { initialReads, simulationFetches, requestsIncludingExplicitReturnLive: network });
  expect(network.every(request => request.method === 'POST' && request.url.endsWith('/native/api/ha/flow-run'))).toBe(true);
});
test('S-scenarios: explicit results, capture review, save, reload and reopen Live without network', async ({ page }, info) => {
  const network = await open(page), initialReads = network.length;
  await page.getByRole('button', { name: 'Load fixture scenarios', exact: true }).click();
  let drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }).click();
  await drawer.getByRole('button', { name: 'Run All', exact: true }).click();
  await expect(drawer.getByRole('cell', { name: 'Hot afternoon: Passed', exact: true })).toContainText('Matches');
  await expect(drawer.getByRole('cell', { name: 'Wrong expectation: Failed', exact: true })).toContainText('Expected');
  await expect(drawer.getByRole('cell', { name: 'Missing input: Incomplete', exact: true })).toHaveText('Incomplete');
  expect(network).toHaveLength(1);
  await drawer.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }).click();
  await expect(drawer.getByRole('group', { name: 'Review scenario before saving', exact: true })).toBeVisible();
  await drawer.getByLabel('Scenario name', { exact: true }).fill('Captured acceptance');
  await drawer.getByRole('button', { name: 'Save scenario', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scenarios saved in this browser.' })).toBeVisible();
  expect(network).toHaveLength(1);
  const simulationFetches = network.length - initialReads;
  await page.reload();
  await expect(output(page, 'Bedroom')).toHaveText('21.9 °C');
  drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Captured acceptance', exact: true }).click();
  await drawer.getByRole('button', { name: 'Close Scenarios', exact: true }).click();
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  await page.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen canvas', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(output(page, 'Bedroom')).toHaveText('21.9 °C');
  drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Run All', exact: true }).click();
  await page.screenshot({ path: info.outputPath('scenario-results.png'), animations: 'disabled' });
  await attachNetwork(info, { initialReads, simulationFetches, requestsIncludingReloadAndReopen: network });
  expect(network.every(request => request.url.endsWith('/native/api/ha/flow-run'))).toBe(true);
});
test('design fidelity: Sensor offline in light/dark, phone sheets and contained sticky table', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 1100 });
  const network = await open(page);
  await page.getByRole('button', { name: 'Load fixture scenarios', exact: true }).click();
  const drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Sensor offline', exact: true }).click();
  await drawer.getByRole('button', { name: 'Run All', exact: true }).click();
  await expect(output(page, 'Bedroom')).toHaveText('Unavailable');
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  const scroller = drawer.getByRole('region', { name: 'Scenario comparison table', exact: true });
  await scroller.evaluate(element => { element.scrollLeft = 300; });
  const bounds = await scroller.boundingBox();
  const name = await drawer.getByRole('rowheader').filter({ hasText: 'Sensor offline' }).boundingBox();
  expect(Math.abs(name!.x - bounds!.x)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await scroller.evaluate(element => { element.scrollLeft = 0; });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
    await page.screenshot({ path: info.outputPath(`sensor-offline-${theme}.png`), animations: 'disabled' });
  }
  await drawer.getByRole('button', { name: 'Close Scenarios', exact: true }).click();
  await inspectBedroom(page);
  await expect(page.getByRole('radio', { name: /^From the scenario.*Sensor offline/ })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Evaluation trace', exact: true }).getByRole('button', { name: 'Subtitle kept', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('sensor-offline-inspector-dark.png'), animations: 'disabled', fullPage: info.project.name === 'desktop' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.screenshot({ path: info.outputPath('sensor-offline-inspector-light.png'), animations: 'disabled', fullPage: info.project.name === 'desktop' });
  await expect(page.getByLabel('Pinned time', { exact: true })).toHaveValue('23:30');
  await page.getByRole('group', { name: 'Source', exact: true }).getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByLabel('Pinned time', { exact: true })).toHaveValue('23:59');
  await expect(page.getByRole('group', { name: 'Source', exact: true }).getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('select')).toHaveCount(0);
  const text = await page.getByRole('region', { name: 'Flow simulation', exact: true }).innerText();
  expect(text).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
  expect(network).toHaveLength(1);
  await attachNetwork(info, { initialReads: 1, simulationFetches: 0, requests: network });
});
