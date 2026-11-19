import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { fakeHomeAssistant } from '../fake-ha-publication';
import { newFlow } from '../../src/workspace2/data/flow';
import type { CompositionDocument } from '../../src/shared/composition/schema';

const studioToken = 'e2e-token-for-workspace2-tests-0001';
export const haToken = 'synthetic-lane-b-ha-token-not-for-the-browser';
export const url = 'http://[::1]:4801';
type Fake = Awaited<ReturnType<typeof fakeHomeAssistant>>;

export function panelDocument(): CompositionDocument {
  let document = (JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/logic-gallery.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
  for (const [kind, title] of [['group', 'Kitchen Lights'], ['attribute', 'Door Status'], ['none', 'House Summary']] as const) {
    document = newFlow(document, kind, { title, entityId: kind === 'group' ? 'switch.demo_light_1' : 'switch.demo_door' }).document;
  }
  return document;
}

async function stop(server: ChildProcess) {
  if (server.exitCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => server.kill('SIGKILL'), 8000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill('SIGTERM');
  });
}

export const test = base.extend<{ ha: Fake }, { panelServer: Fake }>({
  panelServer: [async ({}, use) => {
    const fake = await fakeHomeAssistant({
      token: haToken,
      entities: {
        'switch.demo_light_1': { state: 'on', attributes: { friendly_name: 'Kitchen Lamp' } },
        'switch.demo_light_2': { state: 'off', attributes: { friendly_name: 'Hall Lamp' } },
        'switch.demo_light_3': { state: 'on', attributes: { friendly_name: 'Desk Lamp' } },
        'switch.demo_door': { state: 'off', attributes: { friendly_name: 'Front Door' } },
        'switch.demo_window': { state: 'off', attributes: { friendly_name: 'Study Window' } },
        'person.demo_sam': { state: 'home', attributes: { friendly_name: 'Sam' } },
        'person.demo_alex': { state: 'home', attributes: { friendly_name: 'Alex' } },
        'sensor.demo_loft_temperature': { state: '24.3', attributes: { friendly_name: 'Loft Temperature', unit_of_measurement: 'C' } },
      },
      registries: {
        area: [{ area_id: 'kitchen', name: 'Kitchen' }, { area_id: 'hall', name: 'Hall' }, { area_id: 'loft', name: 'Loft' }],
        device: [{ id: 'hub', area_id: 'hall', name_by_user: 'Entry Hub' }],
        entity: [
          { entity_id: 'switch.demo_light_1', area_id: 'kitchen', device_id: 'hub' },
          { entity_id: 'switch.demo_light_2', area_id: null, device_id: 'hub' },
          { entity_id: 'switch.demo_light_3', area_id: 'kitchen' },
          { entity_id: 'switch.demo_door', device_id: 'hub' },
          { entity_id: 'switch.demo_window' }, { entity_id: 'person.demo_sam' }, { entity_id: 'person.demo_alex' },
          { entity_id: 'sensor.demo_loft_temperature', area_id: 'loft' },
        ],
      },
    });
    const server = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
      env: { ...process.env, HOST: '::1', PORT: '4801', DATA_DIR: path.resolve('test-results/studio-data/lane-b'), STUDIO_AUTH_TOKEN: studioToken, HA_URL: fake.url, HA_TOKEN: haToken, SUPERVISOR_TOKEN: '', NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    try {
      await expect.poll(async () => {
        if (server.exitCode !== null) throw new Error('The isolated Lane B server exited before becoming ready');
        try { return (await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${studioToken}` } })).ok; } catch { return false; }
      }, { timeout: 60_000 }).toBe(true);
      await use(fake);
    } finally { await stop(server); await fake.close(); }
  }, { scope: 'worker', timeout: 90_000 }],
  baseURL: async ({ panelServer: _server }, use) => { await use(url); },
  ha: async ({ panelServer }, use) => { await use(panelServer); },
});
export { expect } from '@playwright/test';
