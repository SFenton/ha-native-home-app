import { expect, it } from 'vitest';
import { HomeAssistantClient } from '../server/ha';
import { fakeHomeAssistant } from './fake-ha-publication';

it('refreshes the cached core zone after the existing live connection reconnects', async () => {
  const options = { token: 'demo_fake_ha_token', coreConfig: { time_zone: 'America/Los_Angeles' } };
  const ha = await fakeHomeAssistant(options);
  const client = new HomeAssistantClient({ production: false, port: 0, host: '127.0.0.1', dataDir: 'unused', haUrl: ha.url, haToken: options.token });
  const nextConnection = () => new Promise<void>(resolve => {
    const unsubscribe = client.live!.subscribe(event => {
      if (event.type === 'status' && event.connected) { unsubscribe(); resolve(); }
    });
  });
  try {
    expect((await client.nativeHome()).timeZone).toBe('America/Los_Angeles');
    expect((await client.nativeHome()).timeZone).toBe('America/Los_Angeles');
    expect(ha.log.filter(entry => entry === 'http /api/config')).toHaveLength(1);
    await nextConnection();
    expect((await client.nativeHome()).timeZone).toBe('America/Los_Angeles');
    options.coreConfig.time_zone = 'Asia/Tokyo';
    const reconnected = nextConnection();
    ha.dropSockets();
    await reconnected;
    expect((await client.nativeHome()).timeZone).toBe('Asia/Tokyo');
    options.coreConfig.time_zone = 'Invalid/Zone';
    const again = nextConnection();
    ha.dropSockets();
    await again;
    expect(Object.hasOwn(await client.nativeHome(), 'timeZone')).toBe(false);
    expect(ha.log.filter(entry => entry === 'http /api/config')).toHaveLength(4);
    expect(ha.authorizations.filter(value => value !== undefined).every(value => value === `Bearer ${options.token}`)).toBe(true);
  } finally { client.close(); await ha.close(); }
});
