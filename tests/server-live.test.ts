import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import { fakeHomeAssistant } from './fake-ha-publication';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const haToken = 'synthetic-ha-token-that-must-never-leave-the-server';
const token = 'synthetic-live-studio-token';

async function studio(configured = true) {
  const fake = await fakeHomeAssistant({
    token: haToken, houseConfig: { home: { lamp: 'light.demo_cfg_lamp', hall: 'sensor.demo_cfg_hall' } },
    entities: { 'light.demo_cfg_lamp': { state: 'on', attributes: { friendly_name: 'Lamp', brightness: 200 } }, 'sensor.demo_cfg_hall': { state: '20' }, 'sensor.demo_unrelated': { state: '1' } },
  });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'server-live-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: token, ...(configured ? { haUrl: fake.url, haToken } : {}) });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { fake, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

interface Frame { event: string; data: Record<string, unknown> }
/** Opens the stream and collects its frames; `until` resolves when a frame satisfies the predicate. */
async function stream(base: string, headers: Record<string, string> = { Authorization: `Bearer ${token}` }) {
  const controller = new AbortController();
  cleanup.push(async () => controller.abort());
  const response = await fetch(`${base}/api/live/states`, { headers, signal: controller.signal });
  const frames: Frame[] = [];
  const waiting: { test: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];
  let raw = '';
  void (async () => {
    if (!response.body) return;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        raw += decoder.decode(value, { stream: true });
        for (let end = raw.indexOf('\n\n'); end >= 0; end = raw.indexOf('\n\n')) {
          const block = raw.slice(0, end); raw = raw.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !data) continue;
          const frame = { event, data: JSON.parse(data) as Record<string, unknown> };
          frames.push(frame);
          for (const wait of [...waiting]) if (wait.test(frame)) { waiting.splice(waiting.indexOf(wait), 1); wait.resolve(frame); }
        }
      }
    } catch { /* aborted */ }
  })();
  const until = (test: (frame: Frame) => boolean, ms = 4000) => {
    const found = frames.find(test);
    if (found) return Promise.resolve(found);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No matching frame; saw ${frames.map(frame => frame.event).join(',')}`)), ms);
      waiting.push({ test, resolve: frame => { clearTimeout(timer); resolve(frame); } });
    });
  };
  return { response, frames, until, close: () => controller.abort() };
}
const states = (frame: Frame) => frame.data.states as { entityId: string; state: string; brightness?: number }[];

describe('GET /api/live/states', () => {
  it('needs the studio sign-in and a configured Home Assistant', async () => {
    const { base } = await studio();
    expect((await fetch(`${base}/api/live/states`)).status).toBe(401);
    const bare = await studio(false);
    const response = await fetch(`${bare.base}/api/live/states`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(503);
  });

  it('sends the entities the house configuration names, then each change, without the token', async () => {
    const { base, fake } = await studio();
    const live = await stream(base);
    expect(live.response.headers.get('content-type')).toContain('text/event-stream');
    const snapshot = await live.until(frame => frame.event === 'snapshot');
    // The house configuration's two entities, not the unrelated one.
    expect(states(snapshot).map(state => state.entityId).sort()).toEqual(['light.demo_cfg_lamp', 'sensor.demo_cfg_hall']);
    expect(snapshot.data.connected).toBe(true);

    fake.setEntity('light.demo_cfg_lamp', 'off');
    const update = await live.until(frame => frame.event === 'update' && states(frame).some(state => state.entityId === 'light.demo_cfg_lamp'));
    expect(states(update)).toEqual([expect.objectContaining({ entityId: 'light.demo_cfg_lamp', state: 'off', brightness: 200, name: 'Lamp' })]);
    fake.setEntity('sensor.demo_unrelated', '2');
    fake.setEntity('sensor.demo_cfg_hall', '21');
    const next = await live.until(frame => frame.event === 'update' && states(frame).some(state => state.entityId === 'sensor.demo_cfg_hall'));
    expect(states(next).map(state => state.entityId)).toEqual(['sensor.demo_cfg_hall']);

    live.close();
    const text = JSON.stringify(live.frames);
    expect(text).not.toContain(haToken);
    expect(text).not.toContain(fake.url);
    expect(text).not.toContain(token);
    expect(live.response.headers.get('set-cookie')).toBeNull();
  });

  it('shares one Home Assistant subscription between pages and keeps going after Home Assistant drops', async () => {
    const { base, fake } = await studio();
    const first = await stream(base), second = await stream(base);
    const snapshot = await first.until(frame => frame.event === 'snapshot');
    await second.until(frame => frame.event === 'snapshot');
    expect(fake.subscribeCount).toBe(1);

    fake.dropSockets();
    const down = await first.until(frame => first.frames.indexOf(frame) > first.frames.indexOf(snapshot) && frame.event === 'status' && frame.data.connected === false);
    // No state was blanked while it was down.
    expect(first.frames.filter(frame => frame.event === 'update' && frame.data.removed && (frame.data.removed as string[]).length)).toEqual([]);
    await first.until(frame => first.frames.indexOf(frame) > first.frames.indexOf(down) && frame.event === 'status' && frame.data.connected === true, 8000);
    expect(fake.subscribeCount).toBe(2);
    fake.setEntity('light.demo_cfg_lamp', 'off');
    await first.until(frame => frame.event === 'update' && states(frame).some(state => state.state === 'off'));
    await second.until(frame => frame.event === 'update' && states(frame).some(state => state.state === 'off'));
  }, 20000);
});
