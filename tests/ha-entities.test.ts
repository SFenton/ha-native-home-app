import { describe, expect, it } from 'vitest';
import { entityExists, entityStates, historyStates, listEntities, translatedStates, type HaReads } from '../server/ha-entities';

const states = [
  { entity_id: 'light.demo_b_lamp', state: 'on', attributes: { friendly_name: 'B Lamp' } },
  { entity_id: 'light.demo_a_lamp', state: 'off', attributes: {} },
  { entity_id: 'lock.demo_front', state: 'locked', attributes: { friendly_name: 'Front' } },
  { entity_id: 'binary_sensor.demo_door', state: 'off', attributes: { device_class: 'door' } },
  { entity_id: 'Bad Id', state: 'x', attributes: {} },
];
const resources: Record<string, string> = {
  'component.lock.entity_component._.state.locked': 'Locked',
  'component.lock.entity_component._.state.open': 'Open',
  'component.binary_sensor.entity_component._.state.on': 'On',
  'component.binary_sensor.entity_component.door.state.on': 'Open',
  'component.binary_sensor.entity_component.door.state.off': 'Closed',
};
function fake(history: unknown = [[{ state: 'locked' }, { state: 'jammed' }]]): HaReads & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async get(path) {
      paths.push(path);
      if (path === '/api/states') return states;
      if (path.startsWith('/api/history/')) return history;
      const found = states.find(item => path === `/api/states/${item.entity_id}`);
      return found;
    },
    async translations() { return resources; },
  };
}

describe('Home Assistant entity reads for the style editor', () => {
  it('lists entities by name, optionally for one domain, and skips malformed ids', async () => {
    expect((await listEntities(fake())).map(item => item.entityId)).toEqual(['light.demo_b_lamp', 'binary_sensor.demo_door', 'lock.demo_front', 'light.demo_a_lamp']);
    const lights = await listEntities(fake(), 'light');
    expect(lights.map(item => item.name)).toEqual(['B Lamp', 'light.demo_a_lamp']);
    expect((await listEntities(fake())).find(item => item.entityId === 'binary_sensor.demo_door')?.deviceClass).toBe('door');
  });
  it('reads the translated names of a domain, a device class overriding the domain', () => {
    expect(translatedStates(resources, 'binary_sensor', 'door')).toEqual([{ state: 'on', name: 'Open' }, { state: 'off', name: 'Closed' }]);
    expect(translatedStates(resources, 'lock')).toEqual([{ state: 'locked', name: 'Locked' }, { state: 'open', name: 'Open' }]);
  });
  it('collects distinct history states', () => {
    expect(historyStates([[{ state: 'a' }, { state: 'a' }, { state: 'b' }], 'x', [null]])).toEqual(['a', 'b']);
    expect(historyStates('nope')).toEqual([]);
  });
  it('fills an entity from its translated states and lists history-only states apart', async () => {
    const reads = fake();
    const result = await entityStates(reads, 'lock.demo_front', new Date('2026-11-14T00:00:00Z'));
    expect(result.states).toEqual([{ state: 'locked', name: 'Locked' }, { state: 'open', name: 'Open' }]);
    expect(result.history).toEqual(['jammed']);
    expect(result.openEnded).toBe(false);
    expect(reads.paths.at(-1)).toContain('minimal_response');
  });
  it('treats a sensor as open-ended and never offers history states', async () => {
    const reads = fake();
    reads.get = async path => (path.startsWith('/api/states/') ? { state: '21', attributes: {} } : []);
    const result = await entityStates(reads, 'sensor.demo_temperature');
    expect(result).toMatchObject({ openEnded: true, states: [], history: [] });
  });
  it('keeps the current state when Home Assistant has no translation for it', async () => {
    const reads = fake();
    reads.translations = async () => ({});
    expect((await entityStates(reads, 'light.demo_b_lamp')).states).toEqual([{ state: 'on' }]);
  });
  it('rejects an unknown entity and a malformed id', async () => {
    await expect(entityStates(fake(), 'lock.demo_missing')).rejects.toMatchObject({ status: 404 });
    await expect(entityStates(fake(), 'nonsense')).rejects.toMatchObject({ status: 400 });
  });
  it('checks that a script or timer exists', async () => {
    const reads = fake();
    reads.get = async path => (path.endsWith('script.demo_known') ? { state: 'off' } : undefined);
    expect(await entityExists(reads, 'script.demo_known')).toBe(true);
    expect(await entityExists(reads, 'timer.demo_missing')).toBe(false);
    await expect(entityExists(reads, 'light.demo_x')).rejects.toMatchObject({ status: 400 });
  });
});
