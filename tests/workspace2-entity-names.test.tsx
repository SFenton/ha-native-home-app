// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoFriendlyName, demoHouse } from '../src/preview2/demo-house';
import { filterEntities, rowsFromDocument, rowsFromStates } from '../src/workspace2/pickers/entities';
import { EntityRowView } from '../src/workspace2/pickers/EntityList';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const document = homeDomains.document as unknown as CompositionDocument;

describe('entity names in search and pickers', () => {
  it('uses the Home Assistant friendly name when there is one, else the raw id', () => {
    const rows = rowsFromStates([
      { entityId: 'light.demo_lamp', name: 'Reading lamp', state: 'on' },
      { entityId: 'switch.demo_plain', name: 'switch.demo_plain', state: 'off' },
    ]);
    expect(rows.map(row => row.name)).toEqual(['Reading lamp', 'switch.demo_plain']);
  });

  it('matches what is typed against the friendly name and the id', () => {
    const rows = rowsFromStates([{ entityId: 'light.demo_lamp', name: 'Reading lamp', state: 'on' }, { entityId: 'light.demo_porch', name: 'Porch', state: 'off' }]);
    expect(filterEntities(rows, 'reading').map(row => row.entityId)).toEqual(['light.demo_lamp']);
    expect(filterEntities(rows, 'demo_porch').map(row => row.entityId)).toEqual(['light.demo_porch']);
    expect(filterEntities(rows, 'lamp light').map(row => row.entityId)).toEqual(['light.demo_lamp']);
  });

  it('gives demo ids their demo friendly names without Home Assistant, and leaves other ids raw', () => {
    expect(demoFriendlyName('light.demo_kitchen_lamp')).toBe('Kitchen lamp');
    expect(demoFriendlyName('light.test_ceiling')).toBe('light.test_ceiling');
    const offline = rowsFromDocument(document);
    expect(offline.length).toBeGreaterThan(0);
    for (const row of offline) expect(row.name).toBe(demoFriendlyName(row.entityId));
    expect(offline.some(row => row.name !== row.entityId)).toBe(true);
    expect(filterEntities(offline, 'entity 308').map(row => row.entityId)).toContain('light.demo_entity_308');
    expect(filterEntities(offline, 'light.demo_entity_308')).toHaveLength(1);
    for (const state of demoHouse(document).states!.values()) expect(state.name).toBe(demoFriendlyName(state.entityId));
  });

  it('shows the id as secondary text under a friendly name, and once when it is the only name', () => {
    const named = render(<EntityRowView row={{ entityId: 'light.demo_lamp', name: 'Reading lamp', domain: 'light' }} onPick={() => {}}/>);
    expect(named.container.querySelector('.w2-entity-name')?.textContent).toBe('Reading lamp');
    expect(named.container.querySelector('.w2-entity-id')?.textContent).toBe('light.demo_lamp');
    cleanup();
    const raw = render(<EntityRowView row={{ entityId: 'switch.test_plain', name: 'switch.test_plain', domain: 'switch' }} onPick={() => {}}/>);
    expect(raw.container.querySelector('.w2-entity-name')?.textContent).toBe('switch.test_plain');
    expect(raw.container.querySelector('.w2-entity-id')).toBeNull();
  });
});
