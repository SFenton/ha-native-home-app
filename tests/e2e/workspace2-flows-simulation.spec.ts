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
async function open(page: Page) {
  const network: { method: string; url: string }[] = [];
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
  await expect(page.getByRole('article', { name: 'Output chores-count', exact: true }).locator('output')).toHaveText('6');
  expect(network).toHaveLength(1);
  expect(network[0].url).toMatch(/\/native\/api\/ha\/flow-run$/);
  return network;
}
test('S-pins / S-trace: pin, Live, clock edge, actual drawers and no simulation network', async ({ page }, info) => {
  const network = await open(page);
  const initialReads = network.length;
  const output = (name: string) => page.getByRole('article', { name: `Output ${name}`, exact: true }).locator('output');
  await expect(output('bedroom')).toHaveText('21.9');
  await page.getByRole('combobox', { name: 'Source for Bedroom', exact: true }).selectOption('pin');
  await page.getByLabel('Typed value (JSON)', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Apply pin', exact: true }).click();
  await expect(output('subtitle')).toHaveText('Too Warm');
  await expect(output('bedroom')).toHaveText('25');
  await page.getByRole('article', { name: 'Output subtitle', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('pinned-too-warm.png') });
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await expect(page.getByRole('region', { name: 'chores-count items evidence', exact: true }).getByText('8 before / 6 after', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'chores-display items evidence', exact: true }).getByText('First Few cut: 1. Earlier counts are unchanged.', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Show items', exact: true }).selectOption('dropped');
  await expect(page.getByRole('region', { name: 'chores-count items evidence', exact: true }).getByRole('list', { name: 'keep items' })).toHaveAttribute('data-total', '2');
  await page.getByRole('button', { name: 'Each Run', exact: true }).click();
  const lights = page.getByRole('region', { name: 'lights each evidence', exact: true });
  await expect(lights.getByText('Actual output: 1', { exact: true })).toBeVisible();
  await expect(lights.getByRole('list', { name: 'lights iterations' })).toHaveAttribute('data-total', '3');
  await lights.getByRole('button', { name: /1\. lamp/ }).click();
  await expect(lights.getByRole('heading', { name: 'Actual raw reads' })).toBeVisible();
  await page.getByLabel('ISO local clock', { exact: true }).fill('2026-11-19T00:00:00');
  await page.getByRole('button', { name: 'Pin clock', exact: true }).click();
  await expect(output('today')).toHaveText('2026-11-19');
  expect(network).toHaveLength(1);
  const simulationFetches = network.length - initialReads;
  await page.getByRole('button', { name: 'Return to Live', exact: true }).click();
  await expect(output('bedroom')).toHaveText('21.9');
  await expect(output('subtitle')).toHaveText('Comfortable');
  await expect(output('today')).toHaveText('2026-11-18');
  await page.getByRole('article', { name: 'Output bedroom', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('live-restored.png') });
  await attachNetwork(info, { initialReads, simulationFetches, requestsIncludingExplicitReturnLive: network });
  expect(network.every(request => request.method === 'POST' && request.url.endsWith('/native/api/ha/flow-run'))).toBe(true);
});
test('S-scenarios: explicit results, capture review, save, reload and reopen Live without network', async ({ page }, info) => {
  const network = await open(page);
  const initialReads = network.length;
  await page.getByRole('button', { name: 'Load fixture scenarios', exact: true }).click();
  await page.getByRole('combobox', { name: 'Active scenario', exact: true }).selectOption('hot');
  await page.getByRole('button', { name: 'Run All', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hot afternoon: Passed', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wrong expectation: Failed', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Missing input: Incomplete', exact: true })).toBeVisible();
  expect(network).toHaveLength(1);
  await page.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Review scenario before saving', exact: true })).toBeVisible();
  await page.getByLabel('Scenario name', { exact: true }).fill('Captured acceptance');
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scenarios saved in this browser.' })).toBeVisible();
  expect(network).toHaveLength(1);
  const simulationFetches = network.length - initialReads;
  await page.reload();
  await expect(page.getByRole('article', { name: 'Output bedroom', exact: true }).locator('output')).toHaveText('21.9');
  await page.getByRole('combobox', { name: 'Active scenario', exact: true }).selectOption({ label: 'Captured acceptance' });
  await expect(page.getByRole('article', { name: 'Output subtitle', exact: true }).locator('output')).toHaveText('Too Warm');
  await page.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen canvas', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active scenario', exact: true })).toHaveValue('');
  await expect(page.getByRole('article', { name: 'Output bedroom', exact: true }).locator('output')).toHaveText('21.9');
  await page.getByRole('button', { name: 'Run All', exact: true }).click();
  await page.getByRole('heading', { name: 'Hot afternoon: Passed', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('scenario-results.png') });
  await attachNetwork(info, { initialReads, simulationFetches, requestsIncludingReloadAndReopen: network });
  expect(network.every(request => request.url.endsWith('/native/api/ha/flow-run'))).toBe(true);
});
