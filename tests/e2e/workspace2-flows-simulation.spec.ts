import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { CHORES_RESPONSE } from '../flows-canvas/simulation/data';
import { simulationFocusPair, simulationTextPairs } from '../flows-canvas/simulation/contrast';
import type { SimulationCase } from '../../src/shared/composition/graph/types';
import { contrast, over, type Rgb } from '../../src/workspace2/theme';

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
type NetworkRead = { method: string; url: string };
const IMPORT_TIMER_BOUND_MS = 5_000;
const IMPORT_TIMER_CALLBACK_LIMIT = 100;
const IMPORT_REQUEST_DELAYS_MS = [0, 300, 600, 1_500, 3_000, IMPORT_TIMER_BOUND_MS - 1];
type ImportTimer = { kind: 'timeout' | 'interval' | 'animation frame' | 'idle callback'; due: number };
declare global {
  interface Window {
    __simulationImportTraffic: {
      requests: NetworkRead[]; pending: number; startedAt: number;
      timers: Map<number, ImportTimer>; callbacks: number;
    };
  }
}
async function pauseImportClock(page: Page) {
  await page.clock.install({ time: new Date('2026-11-19T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-19T12:01:00Z'));
}
async function observeImport(page: Page) {
  await page.evaluate(({ bound, callbackLimit }) => {
    const browser: Window = window;
    const traffic = window.__simulationImportTraffic = {
      requests: [] as NetworkRead[], pending: 0, startedAt: performance.now(),
      timers: new Map<number, ImportTimer>(), callbacks: 0,
    };
    const fire = (callback: () => void) => {
      if (++traffic.callbacks > callbackLimit) throw new Error(`Import timers did not settle within ${bound} ms: exceeded ${callbackLimit} callbacks.`);
      callback();
    };
    const timeout = browser.setTimeout.bind(browser), interval = browser.setInterval.bind(browser);
    const clearTimeout = browser.clearTimeout.bind(browser), clearInterval = browser.clearInterval.bind(browser);
    const schedule = (repeat: boolean, handler: TimerHandler, delay = 0, ...args: unknown[]) => {
      if (typeof handler !== 'function') throw new Error('Import timer audit requires a function callback.');
      const id = (repeat ? interval : timeout)(() => {
        if (repeat) traffic.timers.set(id, { kind: 'interval', due: performance.now() + Math.max(1, delay) });
        else traffic.timers.delete(id);
        fire(() => handler(...args));
      }, delay);
      traffic.timers.set(id, { kind: repeat ? 'interval' : 'timeout', due: performance.now() + Math.max(0, delay) });
      return id;
    };
    browser.setTimeout = (handler, delay, ...args) => schedule(false, handler, delay, ...args);
    browser.setInterval = (handler, delay, ...args) => schedule(true, handler, delay, ...args);
    browser.clearTimeout = id => { if (id !== undefined) traffic.timers.delete(id); clearTimeout(id); };
    browser.clearInterval = id => { if (id !== undefined) traffic.timers.delete(id); clearInterval(id); };
    const frame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = frame(time => { traffic.timers.delete(id); fire(() => callback(time)); });
      traffic.timers.set(id, { kind: 'animation frame', due: performance.now() + 16 });
      return id;
    };
    window.cancelAnimationFrame = id => { traffic.timers.delete(id); cancelFrame(id); };
    const idle = window.requestIdleCallback.bind(window), cancelIdle = window.cancelIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) => {
      const id = idle(deadline => { traffic.timers.delete(id); fire(() => callback(deadline)); }, options);
      traffic.timers.set(id, { kind: 'idle callback', due: performance.now() + 1 });
      return id;
    };
    window.cancelIdleCallback = id => { traffic.timers.delete(id); cancelIdle(id); };
    const fetch = window.fetch;
    window.fetch = function (input, init) {
      traffic.requests.push({
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        url: new URL(input instanceof Request ? input.url : String(input), document.baseURI).href,
      });
      traffic.pending++;
      return fetch.call(this, input, init).finally(() => { traffic.pending--; });
    };
    const requests = new WeakMap<XMLHttpRequest, NetworkRead>();
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
      requests.set(this, { method, url: new URL(String(url), document.baseURI).href });
      return open.call(this, method, url, async, username, password);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const request = requests.get(this);
      if (!request) throw new Error('Import audit observed XMLHttpRequest.send without open.');
      traffic.requests.push(request);
      traffic.pending++;
      this.addEventListener('loadend', () => { traffic.pending--; }, { once: true });
      return send.call(this, body);
    };
  }, { bound: IMPORT_TIMER_BOUND_MS, callbackLimit: IMPORT_TIMER_CALLBACK_LIMIT });
}
async function drainImportTimers(page: Page) {
  for (let step = 0; step < IMPORT_TIMER_CALLBACK_LIMIT; step++) {
    await page.waitForFunction(() => window.__simulationImportTraffic.pending === 0, undefined, { timeout: 8_000 });
    const state = await page.evaluate(() => {
      const traffic = window.__simulationImportTraffic;
      const now = performance.now();
      return { now, elapsedMs: now - traffic.startedAt, callbacks: traffic.callbacks, timers: [...traffic.timers.values()] };
    });
    if (!state.timers.length) return { elapsedMs: state.elapsedMs, callbacks: state.callbacks, pendingTimers: 0 };
    const remaining = IMPORT_TIMER_BOUND_MS - state.elapsedMs;
    if (remaining <= 0) throw new Error(`Import timers did not settle within ${IMPORT_TIMER_BOUND_MS} ms: ${JSON.stringify(state.timers)}`);
    const nextDue = Math.min(...state.timers.map(timer => timer.due));
    await page.clock.runFor(Math.min(remaining, Math.max(1, nextDue - state.now)));
  }
  throw new Error(`Import timers did not settle within ${IMPORT_TIMER_BOUND_MS} ms: exceeded ${IMPORT_TIMER_CALLBACK_LIMIT} drain steps.`);
}
async function assertNoImportRequests(page: Page, network: readonly NetworkRead[], initialReads: number) {
  await drainImportTimers(page);
  const requests = await page.evaluate(() => window.__simulationImportTraffic.requests);
  expect(requests, 'No requests may start during import, including delayed flow-run reads.').toEqual([]);
  expect(network.length - initialReads, 'The final live route delta must also stay zero.').toBe(0);
}
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
async function loadFixtureScenarios(page: Page, network: readonly NetworkRead[]) {
  // The fixture remounts in Live. Its allowed refresh must finish before measuring simulation traffic.
  const initialReads = network.length;
  const refreshed = page.waitForResponse(response => response.url().endsWith('/native/api/ha/flow-run') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Load fixture scenarios', exact: true }).click();
  expect(await (await refreshed).finished()).toBeNull();
  await expect(output(page, 'Chores count')).toHaveText('6');
  expect(network).toHaveLength(initialReads + 1);
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
  expect(network.length - initialReads, 'Pinning and using simulation must not start requests.').toBe(0);
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
  const network = await open(page);
  await loadFixtureScenarios(page, network);
  const initialReads = network.length;
  let drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }).click();
  await drawer.getByRole('button', { name: 'Run All', exact: true }).click();
  await expect(drawer.getByRole('cell', { name: 'Hot afternoon: Passed', exact: true })).toContainText('Matches');
  await expect(drawer.getByRole('cell', { name: 'Wrong expectation: Failed', exact: true })).toContainText('Expected');
  await expect(drawer.getByRole('cell', { name: 'Missing input: Incomplete', exact: true })).toHaveText('Incomplete');
  expect(network.length - initialReads, 'Entering a scenario and Run All must not start requests.').toBe(0);
  await drawer.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }).click();
  await expect(drawer.getByRole('group', { name: 'Review scenario before saving', exact: true })).toBeVisible();
  await drawer.getByLabel('Scenario name', { exact: true }).fill('Captured acceptance');
  await drawer.getByRole('button', { name: 'Save scenario', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scenarios saved in this browser.' })).toBeVisible();
  expect(network.length - initialReads, 'Capturing and saving in simulation must not start requests.').toBe(0);
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
  await loadFixtureScenarios(page, network);
  const initialReads = network.length;
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
  expect(network.length - initialReads, 'Using an offline scenario must not start requests.').toBe(0);
  await attachNetwork(info, { initialReads, simulationFetches: network.length - initialReads, requests: network });
});
test('scenario import and deletion preserve simulated mode and make no requests', async ({ page }, info) => {
  const network = await open(page);
  await loadFixtureScenarios(page, network);
  const initialReads = network.length;
  const drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }).click();
  await drawer.getByText('Import or export scenarios', { exact: true }).click();
  await drawer.getByRole('button', { name: 'Prepare export', exact: true }).click();
  const exchange = drawer.getByLabel('Scenario exchange JSON', { exact: true });
  const exported = await exchange.inputValue();
  await page.clock.install();
  await drawer.getByRole('button', { name: 'Import scenarios (replace browser list)', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scenarios imported. Active simulation was not changed.' })).toBeVisible();
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  await drawer.getByRole('button', { name: 'Delete Hot afternoon', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true })).toHaveCount(0);
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  await exchange.fill(JSON.stringify({ version: 1, scenarios: [] }));
  await drawer.getByRole('button', { name: 'Import scenarios (replace browser list)', exact: true }).click();
  await expect(drawer.getByRole('button', { name: /^Use scenario / })).toHaveCount(0);
  await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
  await expect(page.getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Simulated', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(1000);
  expect(network.length - initialReads, 'Entering simulation, importing and deleting scenarios must not start requests.').toBe(0);
  await exchange.fill(exported);
  await drawer.getByRole('button', { name: 'Import scenarios (replace browser list)', exact: true }).click();
  await page.clock.runFor(1000);
  expect(network.length - initialReads, 'Reimporting after deletion must keep simulation request-free.').toBe(0);
  await attachNetwork(info, { initialReads, simulationFetches: network.length - initialReads, requests: network });
});
for (const change of ['active', 'unchanged', 'inactive'] as const) {
  test(`import preserves the captured active scenario: ${change}`, async ({ page }, info) => {
    const network = await open(page);
    await loadFixtureScenarios(page, network);
    const initialReads = network.length;
    const drawer = await scenarios(page);
    await drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }).click();
    await drawer.getByText('Import or export scenarios', { exact: true }).click();
    await drawer.getByRole('button', { name: 'Prepare export', exact: true }).click();
    const exchange = drawer.getByLabel('Scenario exchange JSON', { exact: true });
    const imported: { version: 1; scenarios: SimulationCase[] } = JSON.parse(await exchange.inputValue());
    const changedId = change === 'inactive' ? 'offline' : 'hot';
    const changed = imported.scenarios.find(scenario => scenario.id === changedId)!;
    if (change !== 'unchanged') {
      imported.scenarios = imported.scenarios.map(scenario => scenario.id !== changedId ? scenario : {
        ...scenario, pins: scenario.pins.map(pin => pin.kind === 'source' && pin.sourceId === 'bedroom'
          ? { ...pin, answer: { status: 'value', value: '19' } } : pin),
      });
    }
    await exchange.fill(JSON.stringify(imported));
    await page.clock.install();
    await drawer.getByRole('button', { name: 'Import scenarios (replace browser list)', exact: true }).click();
    await expect(output(page, 'Bedroom')).toHaveText('25.0 °C');
    await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
    await expect(page.getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Simulated', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(drawer.getByRole('note').filter({ hasText: 'Saved version differs. Reselect to apply.' })).toHaveCount(change === 'active' ? 1 : 0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('sh-studio.logic-scenarios.v1:'))!)!));
    expect(stored).toEqual(imported);
    if (change === 'active') {
      await expect(drawer.getByRole('row').filter({ has: page.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }) })).toContainText('19.0 °C');
      await drawer.getByRole('button', { name: 'Close Scenarios', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Flow simulation', exact: true }).getByRole('note').filter({ hasText: 'Saved version differs. Reselect to apply.' })).toBeVisible();
      await scenarios(page);
    }
    await page.clock.runFor(1000);
    expect(network.length - initialReads, 'Entering simulation and importing must not start requests.').toBe(0);
    await drawer.getByRole('button', { name: `Use scenario ${changed.name}`, exact: true }).click();
    await expect(output(page, 'Bedroom')).toHaveText(change === 'unchanged' ? '25.0 °C' : '19.0 °C');
    await expect(page.getByRole('note').filter({ hasText: 'Saved version differs. Reselect to apply.' })).toHaveCount(0);
    await page.clock.runFor(1000);
    expect(network.length - initialReads, 'Reselecting the imported scenario must not start requests.').toBe(0);
    await attachNetwork(info, { change, initialReads, activeCaptureUnchangedUntilSelection: true, persistedImport: true, simulationFetches: network.length - initialReads, requests: network });
  });
}
for (const failure of ['SecurityError', 'QuotaExceededError']) for (const delayMs of [null, ...IMPORT_REQUEST_DELAYS_MS]) {
  test(`failed import is transactional and visible: ${failure}${delayMs !== null ? ` (delayed flow-run negative control: ${delayMs} ms)` : ''}`, async ({ page }, info) => {
    const cpuRate = Number(process.env.STUDIO_E2E_CPU_RATE ?? 1);
    expect(Number.isFinite(cpuRate) && cpuRate >= 1, 'STUDIO_E2E_CPU_RATE must be a finite number >= 1.').toBe(true);
    if (cpuRate !== 1) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }
    const network = await open(page);
    await loadFixtureScenarios(page, network);
    const initialReads = network.length;
    const drawer = await scenarios(page);
    await drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }).click();
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('sh-studio.logic-scenarios.v1:'))!;
      return { key, value: localStorage.getItem(key) };
    });
    const names = await drawer.getByRole('button', { name: /^Use scenario / }).allTextContents();
    await drawer.getByText('Import or export scenarios', { exact: true }).click();
    const exchange = drawer.getByLabel('Scenario exchange JSON', { exact: true });
    const replacement = JSON.stringify({ version: 1, scenarios: [] });
    await exchange.fill(replacement);
    await page.evaluate(({ failure, key, delayMs }) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          if (delayMs !== null) setTimeout(() => { void fetch('./native/api/ha/flow-run', { method: 'POST' }); }, delayMs);
          throw new DOMException('Test storage failure', failure);
        }
        return set.call(this, name, value);
      };
    }, { failure, key: saved.key, delayMs });
    await pauseImportClock(page);
    await observeImport(page);
    await drawer.getByRole('button', { name: 'Import scenarios (replace browser list)', exact: true }).click();
    const warning = page.getByRole('status').filter({ hasText: 'Import not saved.' });
    await expect(warning).toContainText('The saved scenario list is unchanged.');
    await expect(exchange).toHaveValue(replacement);
    expect(await drawer.getByRole('button', { name: /^Use scenario / }).allTextContents()).toEqual(names);
    expect(await page.evaluate(key => localStorage.getItem(key), saved.key)).toBe(saved.value);
    await expect(page.getByRole('group', { name: 'Simulation mode', exact: true }).getByRole('button', { name: 'Simulated', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(output(page, 'Subtitle')).toHaveText('Too Warm');
    const timerDrain = await drainImportTimers(page);
    const warningText = await warning.textContent();
    const simulationRequests = await page.evaluate(() => window.__simulationImportTraffic.requests);
    await attachNetwork(info, { failure, cpuRate, delayMs, timerBoundMs: IMPORT_TIMER_BOUND_MS, timerDrain, initialReads, unchangedPersistedList: true, unsavedImportRetained: true, warning: warningText, simulationFetches: simulationRequests.length, simulationRequests, requests: network });
    // Re-read both counters after the asynchronous evidence work; no import endpoint is exempt.
    if (delayMs !== null) {
      expect(simulationRequests).toEqual([{ method: 'POST', url: network[0].url }]);
      expect(network.length - initialReads).toBe(1);
      await expect(assertNoImportRequests(page, network, initialReads)).rejects.toThrow('No requests may start during import');
    } else await assertNoImportRequests(page, network, initialReads);
  });
}
for (const timer of ['beyond bound', 'recurring', 'self-rescheduling'] as const) {
  test(`import timer drain fails finitely: ${timer}`, async ({ page }) => {
    await page.goto('about:blank');
    await pauseImportClock(page);
    await observeImport(page);
    await page.evaluate(({ timer, bound }) => {
      if (timer === 'beyond bound') setTimeout(() => {}, bound + 1);
      else if (timer === 'recurring') setInterval(() => {}, 500);
      else {
        const again = () => { setTimeout(again, 0); };
        again();
      }
    }, { timer, bound: IMPORT_TIMER_BOUND_MS });
    await expect(drainImportTimers(page)).rejects.toThrow(`Import timers did not settle within ${IMPORT_TIMER_BOUND_MS} ms:`);
  });
}
test('AA contrast for every rendered simulation text/background pair in both appearances', async ({ page }, info) => {
  test.setTimeout(90_000);
  const network = await open(page);
  const records: { theme: string; scene: string; text: string; foreground: Rgb; background: Rgb; ratio: number; classes: string }[] = [];
  const audit = async (scene: string) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
      // Finish sheet transitions before sampling their actual painted colours.
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
      for (const pair of await page.evaluate(simulationTextPairs)) {
        expect(pair.opacity, `${scene}: unexpected translucent text: ${pair.text}`).toBe(1);
        const background = pair.backgrounds.reduce((ground, top) => over(top, ground), { r: 255, g: 255, b: 255, a: 1 });
        records.push({ theme, scene, text: pair.text, foreground: pair.foreground, background, ratio: contrast(pair.foreground, background), classes: pair.classes });
      }
    }
  };
  await audit('Live values and toolbar');
  await loadFixtureScenarios(page, network);
  let drawer = await scenarios(page);
  await drawer.getByRole('button', { name: 'Use scenario Sensor offline', exact: true }).click();
  await drawer.getByRole('button', { name: 'Run All', exact: true }).click();
  await audit('Selected scenario, all status badges and drawer actions');
  await drawer.getByRole('button', { name: 'Use scenario Sensor offline', exact: true }).hover();
  await audit('Hovered scenario row');
  await drawer.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }).click();
  await drawer.getByText('Captured values and expectations', { exact: true }).click();
  await audit('Review fields, warnings and JSON');
  await drawer.getByRole('button', { name: 'Close Scenarios', exact: true }).click();
  const inspector = await inspectBedroom(page);
  await audit('Source radios, disabled replay, clock, ticks and trace chips');
  await inspector.getByRole('radio', { name: /^Pin a number/ }).check();
  await inspector.getByRole('button', { name: 'Apply pin', exact: true }).click();
  await audit('Number field and direct pin tags');
  await inspector.getByRole('radio', { name: /^Pin a state/ }).check();
  await audit('State field');
  await page.getByRole('region', { name: 'Evaluation trace', exact: true }).getByRole('button', { name: /^Average / }).click();
  await page.getByRole('radio', { name: /^Pin a typed value/ }).check();
  await audit('Typed pin fields');
  await page.getByRole('combobox', { name: 'Pin status', exact: true }).click();
  await audit('Typed pin status menu');
  await page.getByRole('option', { name: 'Loading', exact: true }).click();
  await closeInspector(page);
  await page.getByRole('button', { name: 'Each Run & Items', exact: true }).first().click();
  const evidence = page.getByRole('dialog', { name: 'Run evidence', exact: true });
  for (const tab of ['Each Run', 'Items', 'Trace']) {
    await evidence.getByRole('button', { name: tab, exact: true }).click();
    await audit(`${tab} evidence`);
  }
  await evidence.getByRole('button', { name: 'Close Run evidence', exact: true }).click();
  drawer = await scenarios(page);
  await drawer.getByText('Import or export scenarios', { exact: true }).click();
  await drawer.getByRole('button', { name: 'Prepare export', exact: true }).click();
  await audit('Import/export fields');
  const path = info.outputPath('contrast.json');
  const seen = new Set<string>();
  const pairs = records.filter(row => {
    const key = JSON.stringify([row.theme, row.scene, row.foreground, row.background]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  writeFileSync(path, JSON.stringify({ minimum: Math.min(...records.map(row => row.ratio)), samples: records.length, pairs }, null, 2));
  await info.attach('contrast.json', { path, contentType: 'application/json' });
  expect(records.length).toBeGreaterThan(300);
  expect(records.filter(row => row.ratio < 4.5)).toEqual([]);
});
test('bounded step evidence raises the trace-wide warning without changing the actual count', async ({ page }, info) => {
  const network = await open(page);
  const response = { items: Array.from({ length: 60 }, (_, index) => ({ ...CHORES_RESPONSE.items[0], uid: `bounded-${index}`, summary: `Fixture item ${index + 1}` })) };
  await page.route('**/native/api/ha/flow-run', route => route.fulfill({ json: { source: 'live', at: '2026-11-18T23:59:59.000Z', response } }));
  await page.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen canvas', exact: true }).click();
  await expect(output(page, 'Chores count')).toHaveText('60');
  await inspectBedroom(page);
  await expect(page.getByRole('region', { name: 'Evaluation trace', exact: true })).toContainText('Trace truncated. Unrecorded values are not evidence.');
  await closeInspector(page);
  await page.getByRole('button', { name: 'Each Run & Items', exact: true }).first().click();
  const evidence = page.getByRole('dialog', { name: 'Run evidence', exact: true });
  const chores = evidence.getByRole('region', { name: 'Chores count each evidence', exact: true });
  await expect(chores.getByRole('note')).toHaveText('Trace truncated. Unrecorded values and iterations are not evidence.');
  await expect(chores).toContainText('Actual output: 60');
  await evidence.getByRole('button', { name: 'Items', exact: true }).click();
  await expect(evidence.getByRole('region', { name: 'Chores count items evidence', exact: true })).toContainText('60 before / 60 after');
  await page.screenshot({ path: info.outputPath('truncated-trace.png'), animations: 'disabled' });
  expect(network.every(request => request.url.endsWith('/native/api/ha/flow-run'))).toBe(true);
});
test('focus indicators exceed 3:1 for every simulation control type in both appearances', async ({ page }, info) => {
  test.setTimeout(90_000);
  const network = await open(page);
  const beforeSimulation = network.length;
  const records: { theme: string; control: string; foreground: Rgb; background: Rgb; ratio: number; width: number; offset: number }[] = [];
  const audit = async (control: string, locator: Locator, screenshot?: string) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
      await page.keyboard.press('Shift');
      await locator.focus();
      await expect(locator).toBeFocused();
      const pair = await page.evaluate(simulationFocusPair);
      expect(pair.focusVisible, control).toBe(true);
      expect(pair.outline, control).toBe('solid');
      expect(pair.width, control).toBeGreaterThanOrEqual(2);
      expect(pair.opacity, control).toBe(1);
      const parent = pair.backgrounds.reduce((ground, top) => over(top, ground), { r: 255, g: 255, b: 255, a: 1 });
      const grounds = pair.offset > 0 ? [parent] : [parent, over(pair.controlBackground, parent)];
      for (const background of grounds) records.push({ theme, control, foreground: pair.foreground, background, ratio: contrast(pair.foreground, background), width: pair.width, offset: pair.offset });
      if (screenshot && theme === 'light') await page.screenshot({ path: info.outputPath(`${screenshot}.png`), animations: 'disabled' });
    }
  };
  const mode = page.getByRole('group', { name: 'Simulation mode', exact: true });
  await mode.getByRole('button', { name: 'Simulated', exact: true }).click();
  await audit('Selected mode segment', mode.getByRole('button', { name: 'Simulated', exact: true }), 'focus-mode-light');
  await audit('Unselected mode segment', mode.getByRole('button', { name: 'Live', exact: true }));
  await audit('Tonal toolbar button', page.getByRole('button', { name: 'Scenarios', exact: true }));
  await audit('Values-ground link button', page.getByRole('button', { name: 'Inspect Bedroom', exact: true }));
  await audit('Values disclosure', page.getByText('Other blocks', { exact: true }));
  expect(network.length - beforeSimulation, 'Entering and inspecting simulation must not start requests.').toBe(0);
  await loadFixtureScenarios(page, network);
  const initialReads = network.length;
  const drawer = await scenarios(page);
  const selectedRow = drawer.getByRole('button', { name: 'Use scenario Sensor offline', exact: true });
  await selectedRow.click();
  await audit('Selected scenario row', selectedRow, 'focus-scenario-light');
  await audit('Unselected scenario row', drawer.getByRole('button', { name: 'Use scenario Hot afternoon', exact: true }));
  await audit('Primary action', drawer.getByRole('button', { name: 'Run All', exact: true }));
  await audit('Default action', drawer.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }));
  await audit('Icon action on selected row', drawer.getByRole('button', { name: 'Edit Sensor offline', exact: true }));
  await audit('Scrollable comparison region', drawer.getByRole('region', { name: 'Scenario comparison table', exact: true }));
  await drawer.getByRole('button', { name: 'Save Live Values as Scenario', exact: true }).click();
  await audit('Text field', drawer.getByLabel('Scenario name', { exact: true }));
  await drawer.getByText('Captured values and expectations', { exact: true }).click();
  await audit('JSON textarea', drawer.getByLabel('Scenario data (JSON)', { exact: true }));
  await drawer.getByRole('button', { name: 'Close Scenarios', exact: true }).click();
  const inspector = await inspectBedroom(page);
  await audit('Source radio', inspector.getByRole('radio', { name: /^Pin a number/ }));
  await inspector.getByRole('radio', { name: /^Pin a number/ }).check();
  await audit('Selected source radio', inspector.getByRole('radio', { name: /^Pin a number/ }));
  await audit('Number field', inspector.getByLabel('Number for Bedroom', { exact: true }));
  await audit('Number slider', inspector.getByRole('slider', { name: 'Pin Bedroom number', exact: true }), 'focus-inspector-light');
  await audit('Selected clock source segment', page.getByRole('group', { name: 'Source', exact: true }).getByRole('button', { name: 'Pinned', exact: true }));
  await audit('Unselected clock source segment', page.getByRole('group', { name: 'Source', exact: true }).getByRole('button', { name: 'Live', exact: true }));
  await audit('Time field', page.getByLabel('Pinned time', { exact: true }));
  await audit('Clock slider', page.getByRole('slider', { name: 'Time of day', exact: true }));
  await audit('Date field', page.getByLabel('Date', { exact: true }));
  await audit('Trace chip', page.getByRole('region', { name: 'Evaluation trace', exact: true }).getByRole('button').first());
  await page.getByRole('region', { name: 'Evaluation trace', exact: true }).getByRole('button', { name: /^Average / }).click();
  await page.getByRole('radio', { name: /^Pin a typed value/ }).check();
  await audit('Combobox trigger', page.getByRole('combobox', { name: 'Pin status', exact: true }));
  await page.getByRole('combobox', { name: 'Pin status', exact: true }).click();
  await audit('Menu option', page.getByRole('option', { name: 'Loading', exact: true }), 'focus-menu-light');
  await page.getByRole('option', { name: 'Loading', exact: true }).click();
  await closeInspector(page);
  await page.getByRole('button', { name: 'Each Run & Items', exact: true }).first().click();
  const evidence = page.getByRole('dialog', { name: 'Run evidence', exact: true });
  const lights = evidence.getByRole('region', { name: 'Lights on each evidence', exact: true });
  await audit('Scrollable iterations', lights.getByRole('list', { name: 'Lights on iterations', exact: true }));
  await audit('Iteration button', lights.getByRole('button', { name: /1\. Lamp/ }));
  const path = info.outputPath('focus-contrast.json');
  writeFileSync(path, JSON.stringify({ samples: records.length, minimum: Math.min(...records.map(row => row.ratio)), pairs: records }, null, 2));
  await info.attach('focus-contrast.json', { path, contentType: 'application/json' });
  expect(records.filter(row => row.ratio < 3)).toEqual([]);
  expect(network.length - initialReads, 'Using simulation controls must not start requests.').toBe(0);
});
