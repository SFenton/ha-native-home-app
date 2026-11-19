import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, request as apiRequest, test, type Locator, type Page } from '@playwright/test';
import { fakeHomeAssistant } from '../fake-ha-publication';
import { newFlow, updateFlow } from '../../src/workspace2/data/flow';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import { openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';

/**
 * The Data tab plays a Data Flow against live Home Assistant. This spec runs its own Studio against a fake Home Assistant (a websocket that
 * answers `subscribe_entities`, `get_services` and `call_service`), so no real house is involved. A second block runs against the default
 * Studio, which has no Home Assistant, to show Paste a Sample and demo data stay as they were.
 */
const livePort = process.env.STUDIO_E2E_FLOWRUN_PORT ?? '4879';
const studioToken = 'e2e-token-for-workspace2-tests-0001';
const haToken = 'synthetic-e2e-ha-token-that-must-never-reach-a-page';
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };

/** The fixture with an invented live to-do flow. No house data. */
function withFlow(): CompositionDocument {
  const made = newFlow(fixture.document, 'live-list', { entityId: 'todo.example_chores', title: 'Overdue Chores' });
  return updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'filter-1', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['status'] }, right: { type: 'literal', value: 'needs_action' } } }] }));
}
const chore = (name: string) => ({ uid: name, summary: name, status: 'needs_action' });

const sheetPath = (page: Page) => (page.viewportSize()?.width ?? 1440) < 600;
async function openFlow(page: Page): Promise<Locator> {
  await openWorkspace(page);
  if (sheetPath(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Data$/ }).click();
  } else {
    await openLibrary(page, 'Flows');
    const group = page.getByRole('button', { name: /^Flows, \d+$/ });
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  }
  await page.getByRole('button', { name: /Overdue Chores/ }).first().click();
  return sheetPath(page) ? page.getByRole('dialog', { name: 'Project' }) : page.getByLabel('Properties');
}
const unnamed = (root: Locator) => root.evaluate(element => {
  const out: string[] = [];
  for (const control of element.querySelectorAll<HTMLElement>('button, [role=radio], [role=combobox], [role=textbox], input, [role=switch], [role=treeitem]')) {
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height || control.closest('[hidden], [inert], [aria-hidden=true]')) continue;
    if (!(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || (control as HTMLInputElement).placeholder)) out.push(control.outerHTML.slice(0, 80));
  }
  return out;
});

test.describe('with Home Assistant connected', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ baseURL: `http://127.0.0.1:${livePort}`, actionTimeout: 8000 });
  let fake: Awaited<ReturnType<typeof fakeHomeAssistant>>;
  let server: ChildProcess;
  let data: string;
  let items = [chore('Water the plants'), chore('Take out the trash')];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(150_000);
    fake = await fakeHomeAssistant({
      token: haToken,
      entities: { 'todo.example_chores': { state: '2', attributes: { friendly_name: 'Chores' } } },
      services: { todo: { get_items: { response: { optional: false } }, add_item: {} } },
      serviceResponse: () => ({ 'todo.example_chores': { items } }),
    });
    data = await mkdtemp(path.join(os.tmpdir(), 'studio-flowrun-e2e-'));
    server = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
      env: { ...process.env, PORT: livePort, HOST: '127.0.0.1', DATA_DIR: data, STUDIO_AUTH_TOKEN: studioToken, HA_URL: fake.url, HA_TOKEN: haToken, NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${livePort}/api/health`, { headers: { Authorization: `Bearer ${studioToken}` } })).ok) break; } catch { /* not yet */ }
      if (Date.now() > deadline) throw new Error('The live-test Studio did not start');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${livePort}`, extraHTTPHeaders: { Authorization: `Bearer ${studioToken}` } });
    await seed(api, withFlow());
    await api.dispose();
    const warm = await browser.newPage({ baseURL: `http://127.0.0.1:${livePort}`, extraHTTPHeaders: { Authorization: `Bearer ${studioToken}` } });
    await warm.goto('/');
    await expect(warm.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 90_000 });
    await warm.close();
  });
  test.afterAll(async () => {
    const closed = new Promise<void>(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', () => resolve()); });
    server.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 8000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await fake.close();
    await rm(data, { recursive: true, force: true });
  });
  test.beforeEach(async ({ request }) => {
    items = [chore('Water the plants'), chore('Take out the trash')];
    fake.setEntity('todo.example_chores', '2');
    await seed(request, withFlow());
  });

  test('the run bar says Live with Home Assistant\'s rows, and follows a change of the to-do list', async ({ page }) => {
    const editor = await openFlow(page);
    const bar = editor.getByTestId('run-bar');
    await expect(bar).toContainText('Live · 2 items', { timeout: 8000 });
    await expect(bar).toContainText('Home Assistant answered at');
    await snap(page, `live-run-${page.viewportSize()!.width}`);
    expect(fake.serviceCalls.at(-1)).toMatchObject({ domain: 'todo', service: 'get_items', return_response: true });
    expect(fake.serviceCalls.filter(call => call.service !== 'get_items')).toEqual([]);
    const calls = fake.serviceCalls.length;
    items = [...items, chore('Wipe the counters')];
    fake.setEntity('todo.example_chores', '3');
    await expect(bar).toContainText('Live · 3 items', { timeout: 8000 });
    expect(fake.serviceCalls.length).toBeGreaterThan(calls);
    // The page was never given the Home Assistant token.
    expect(await page.content()).not.toContain(haToken);
  });

  const families = [
    { name: 'iPhone', width: 390, height: 844 }, { name: 'Duo folded', width: 669, height: 951 }, { name: 'Duo wide', width: 951, height: 669 },
    { name: 'iPad portrait', width: 820, height: 1180 }, { name: 'iPad landscape', width: 1180, height: 820 }, { name: 'Desktop', width: 1440, height: 900 },
  ];
  for (const family of families) {
    test(`${family.name} ${family.width}x${family.height}: the Live run bar has a name and a role, fits, and its targets are 44 px on touch`, async ({ page }) => {
      await page.setViewportSize({ width: family.width, height: family.height });
      const editor = await openFlow(page);
      const bar = editor.getByTestId('run-bar');
      await expect(bar).toContainText('Live · 2 items', { timeout: 8000 });
      await expect(bar.getByRole('status')).toHaveAccessibleName(/^Live · 2 items\. Home Assistant answered/);
      expect(await unnamed(editor)).toEqual([]);
      expect(await bar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        const small = await bar.evaluate(element => [...element.querySelectorAll<HTMLElement>('button')].filter(control => control.getBoundingClientRect().height < 43.5).map(control => control.textContent?.trim()));
        expect(small).toEqual([]);
      }
    });
  }
});

test.describe('with no Home Assistant connected', () => {
  test('Demo Data stays, the page asks the server for nothing, and no Live tag appears', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', req => { if (/flow-run/.test(req.url())) asked.push(req.url()); });
    await seed(page.request, withFlow());
    const editor = await openFlow(page);
    const bar = editor.getByTestId('run-bar');
    await expect(bar).toContainText('Demo Data');
    await expect(bar).not.toContainText('Live');
    await page.waitForTimeout(1500);
    expect(asked).toEqual([]);
    await expect(bar).toContainText('Demo Data');
  });
});
