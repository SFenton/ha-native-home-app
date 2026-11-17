import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, request as apiRequest, test, type Page } from '@playwright/test';
import { addStateTile, newStateTile } from '../../src/shared/composition/state-style-library';
import { fakeHomeAssistant } from '../fake-ha-publication';
import { openWorkspace, previewRoot, seed } from './workspace2-helpers';

/**
 * The simulator draws live Home Assistant states and keeps them current. This spec runs its own Studio server against a fake
 * Home Assistant (a websocket that answers `subscribe_entities`), so no real house is involved: the server holds one websocket,
 * the page opens its stream, and a change in the fake house reaches the tile within about a second.
 */
const port = process.env.STUDIO_E2E_LIVE_PORT ?? '4816';
const studioToken = 'e2e-token-for-workspace2-tests-0001';
const haToken = 'synthetic-e2e-ha-token-that-must-never-reach-a-page';
test.use({ baseURL: `http://127.0.0.1:${port}`, actionTimeout: 8000 });
test.describe.configure({ mode: 'serial' });

const home = (JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string }[] } }).document;
const lock = { ...newStateTile('lock.demo_front', 'Demo Front Lock', undefined, undefined)!, id: 'demo-front-lock' };
const garage = { ...newStateTile('cover.demo_garage', 'Demo Garage', 'garage', undefined)!, id: 'demo-garage' };
const withTiles = addStateTile(addStateTile(home as never, home.pages[0].id, lock), home.pages[0].id, garage);

let fake: Awaited<ReturnType<typeof fakeHomeAssistant>>;
let server: ChildProcess;
let data: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(150_000);
  fake = await fakeHomeAssistant({ token: haToken, entities: {
    'lock.demo_front': { state: 'locked', attributes: { friendly_name: 'Demo Front Lock' } },
    'cover.demo_garage': { state: 'closed', attributes: { friendly_name: 'Demo Garage', device_class: 'garage' } },
  } });
  data = await mkdtemp(path.join(os.tmpdir(), 'studio-live-e2e-'));
  server = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: port, HOST: '127.0.0.1', DATA_DIR: data, STUDIO_AUTH_TOKEN: studioToken, HA_URL: fake.url, HA_TOKEN: haToken, NODE_ENV: 'development' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Authorization: `Bearer ${studioToken}` } })).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error('The live-test Studio did not start');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${port}`, extraHTTPHeaders: { Authorization: `Bearer ${studioToken}` } });
  await seed(api, withTiles);
  await api.dispose();
  // A fresh server pays two costs on the first visit, and no test should: Vite optimizing the page's dependencies, and the server's first
  // connection to Home Assistant (the hub connects when the first stream opens). Wait for both here: the Publish button says the page is up, and a
  // tile reading its live state says the stream has delivered the house. The hub then stays connected through its idle time for the tests that follow.
  const warm = await browser.newPage({ baseURL: `http://127.0.0.1:${port}`, extraHTTPHeaders: { Authorization: `Bearer ${studioToken}` } });
  await warm.goto('/');
  await expect(warm.getByRole('button', { name: 'Publish' })).toBeVisible({ timeout: 90_000 });
  await expect(tileLine(warm, 'demo-front-lock')).toHaveText('Locked', { timeout: 90_000 });
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
  fake.setEntity('lock.demo_front', 'locked');
  fake.setEntity('cover.demo_garage', 'closed');
  await seed(request, withTiles);
});

const tileLine = (page: Page, id: string) => previewRoot(page).locator(`[data-sel="node:${id}"] .sh-tile-line`).first();

test('a change in the house reaches its tile within about a second, and only that tile', async ({ page }) => {
  await openWorkspace(page);
  await expect(tileLine(page, 'demo-front-lock')).toHaveText('Locked');
  await expect(tileLine(page, 'demo-garage')).toHaveText('Closed');
  // The page's stream is open: the server holds the one Home Assistant subscription.
  await expect.poll(() => fake.subscribeCount).toBe(1);

  const garageTile = await previewRoot(page).locator('[data-sel="node:demo-garage"]').elementHandle();
  const started = Date.now();
  fake.setEntity('lock.demo_front', 'unlocked');
  await expect(tileLine(page, 'demo-front-lock')).toHaveText('Unlocked', { timeout: 3000 });
  const took = Date.now() - started;
  expect(took, `the tile took ${took} ms`).toBeLessThan(2000);
  // The other tile was neither redrawn nor replaced.
  expect(await garageTile!.evaluate(element => element.isConnected)).toBe(true);
  await expect(tileLine(page, 'demo-garage')).toHaveText('Closed');

  fake.setEntity('cover.demo_garage', 'open');
  await expect(tileLine(page, 'demo-garage')).toHaveText('Open', { timeout: 3000 });
});

test('a drop between the server and Home Assistant never blanks the preview, and the stream resumes', async ({ page }) => {
  await openWorkspace(page);
  await expect(tileLine(page, 'demo-front-lock')).toHaveText('Locked');
  await expect.poll(() => fake.subscribeCount).toBeGreaterThanOrEqual(1);
  const before = fake.subscribeCount;
  fake.dropSockets();
  // While it is down, and after, the tile keeps its words.
  for (let step = 0; step < 6; step += 1) {
    await expect(tileLine(page, 'demo-front-lock')).not.toHaveText(/Unavailable|^$/);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => fake.subscribeCount, { timeout: 15_000 }).toBeGreaterThan(before);
  fake.setEntity('lock.demo_front', 'jammed');
  await expect(tileLine(page, 'demo-front-lock')).toHaveText('Jammed', { timeout: 5000 });
});

test('the page is never given the Home Assistant token, and Use taps stay local', async ({ page, request }) => {
  const bodies: string[] = [];
  page.on('response', async response => {
    if (!/\/api\/native-home/.test(response.url())) return;
    bodies.push(await response.text().catch(() => ''));
  });
  const writes: string[] = [];
  page.on('request', req => { if (req.method() !== 'GET') writes.push(`${req.method()} ${new URL(req.url()).pathname}`); });
  await openWorkspace(page);
  await expect(tileLine(page, 'demo-front-lock')).toBeVisible();
  // The stream is open-ended: read it from the page and stop at the first snapshot.
  const sse = await page.evaluate(async () => {
    const controller = new AbortController();
    const response = await fetch('./api/live/states', { signal: controller.signal });
    const reader = response.body!.getReader();
    let text = '';
    const decoder = new TextDecoder();
    const stop = Date.now() + 4000;
    while (Date.now() < stop && !text.includes('event: snapshot')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    controller.abort();
    return text;
  });
  expect(sse).toContain('event: snapshot');
  expect(sse).not.toContain(haToken);
  expect(sse).not.toContain(fake.url);
  expect(bodies.join('')).not.toContain(haToken);
  expect(await (await request.get('/api/health')).text()).not.toContain(haToken);
  // Opening the workspace made no write to Home Assistant's service routes.
  expect(writes.filter(line => /\/ha\/(call|service)/.test(line))).toEqual([]);
});
