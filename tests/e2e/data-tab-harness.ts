import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { newFlow } from '../../src/workspace2/data/flow';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import type { EntityAreas, HaEntity } from '../../src/api';

export const haToken = 'synthetic-lane-b-ha-token-not-for-the-browser';

export function panelDocument(): CompositionDocument {
  let document = (JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/logic-gallery.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
  for (const [kind, title] of [['group', 'Kitchen Lights'], ['attribute', 'Door Status'], ['none', 'House Summary']] as const) {
    document = newFlow(document, kind, { title, entityId: kind === 'group' ? 'switch.demo_light_1' : 'switch.demo_door' }).document;
  }
  return document;
}

type House = { setEntity(id: string, state: string): void };

// Only HA-facing browser responses are simulated here. ha-areas.test.ts covers the real authenticated registry/websocket transport.
// The normal Playwright config owns the Studio server, port, data directory and global warm-up.
export const test = base.extend<{ ha: House }>({
  ha: [async ({ page }, use) => {
    const entities: HaEntity[] = [
      { entityId: 'switch.demo_light_1', name: 'Kitchen Lamp', state: 'on' },
      { entityId: 'switch.demo_light_2', name: 'Hall Lamp', state: 'off' },
      { entityId: 'switch.demo_light_3', name: 'Desk Lamp', state: 'on' },
      { entityId: 'switch.demo_door', name: 'Front Door', state: 'off' },
      { entityId: 'switch.demo_window', name: 'Study Window', state: 'off' },
      { entityId: 'person.demo_sam', name: 'Sam', state: 'home' },
      { entityId: 'person.demo_alex', name: 'Alex', state: 'home' },
      { entityId: 'sensor.demo_loft_temperature', name: 'Loft Temperature', state: '24.3', unit: 'C' },
    ];
    const areas: EntityAreas = {
      areas: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'hall', name: 'Hall' }, { id: 'loft', name: 'Loft' }],
      entities: [
        { entityId: 'switch.demo_light_1', areaId: 'kitchen', device: 'Entry Hub' },
        { entityId: 'switch.demo_light_2', areaId: 'hall', device: 'Entry Hub' },
        { entityId: 'switch.demo_light_3', areaId: 'kitchen' },
        { entityId: 'switch.demo_door', areaId: 'hall', device: 'Entry Hub' },
        { entityId: 'sensor.demo_loft_temperature', areaId: 'loft' },
      ],
    };
    await page.route('**/native/api/ha/areas', route => route.fulfill({ json: areas }));
    await page.route('**/native/api/ha/entities', route => route.fulfill({ json: entities }));
    await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: entities } }));
    await page.route('**/api/live/states', route => route.fulfill({
      contentType: 'text/event-stream',
      body: `event: snapshot\ndata: ${JSON.stringify({ connected: true, states: entities })}\n\n`,
    }));
    await use({ setEntity(id, state) {
      const entity = entities.find(entity => entity.entityId === id);
      if (!entity) throw new Error(`Unknown synthetic entity ${id}`);
      entity.state = state;
    } });
  }, { auto: true }],
});
export { expect } from '@playwright/test';
