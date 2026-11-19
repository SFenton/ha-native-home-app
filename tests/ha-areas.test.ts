import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import { fakeHomeAssistant, type FakeHaOptions } from './fake-ha-publication';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = 'synthetic-areas-ha-credential';
const authToken = 'synthetic-areas-studio-credential';
const registry: FakeHaOptions['registries'] = {
  area: [{ area_id: 'kitchen', name: 'Kitchen', private: token }, { area_id: 'hall', name: 'Hall' }, { area_id: 'secret', name: token }],
  device: [{ id: 'device-1', area_id: 'hall', name: 'Lamp hub', identifiers: [[token]], connections: [token] }],
  entity: [
    { entity_id: 'light.demo_kitchen', area_id: 'kitchen', device_id: 'device-1', unique_id: token },
    { entity_id: 'light.demo_hall', area_id: null, device_id: 'device-1' },
    { entity_id: 'sensor.demo_outside', area_id: null },
    { entity_id: 'sensor.demo_invalid', area_id: 'missing' },
  ],
};
async function fixture(options: Partial<FakeHaOptions> = {}) {
  const ha = await fakeHomeAssistant({ token, registries: registry, ...options });
  cleanup.push(() => ha.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-areas-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, host: '127.0.0.1', port: 0, dataDir: directory, authToken, haUrl: ha.url, haToken: token });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { ha, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/native/api/ha/areas` };
}
it('authenticates and projects only area names and entity membership over the existing HA connection', async () => {
  const { ha, url } = await fixture();
  expect((await fetch(url)).status).toBe(401);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain(token);
  expect(body).not.toContain(authToken);
  expect(body).not.toMatch(/unique_id|identifiers|connections|device_id/);
  expect(JSON.parse(body)).toEqual({
    areas: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'hall', name: 'Hall' }],
    entities: [{ entityId: 'light.demo_kitchen', areaId: 'kitchen', device: 'Lamp hub' }, { entityId: 'light.demo_hall', areaId: 'hall', device: 'Lamp hub' }, { entityId: 'sensor.demo_outside' }, { entityId: 'sensor.demo_invalid' }],
  });
  expect(ha.messages.filter(message => String(message.type).includes('_registry/list')).map(message => message.type).sort()).toEqual(['config/area_registry/list', 'config/device_registry/list', 'config/entity_registry/list']);
  expect(ha.subscribeCount).toBe(1);
});
it('returns explicit safe errors for denied or malformed registry replies', async () => {
  for (const options of [{ denyCommands: true }, { registries: { ...registry!, entity: { token } } }]) {
    const { url } = await fixture(options);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toMatch(/Home Assistant/);
    expect(body).not.toContain(token);
  }
});
