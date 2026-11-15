import type { CompositionDocument } from '../shared/composition/schema';
import type { NativeState } from '../shared/native-state';
import { houseFrom, type House } from './projections';

/** A plausible state for an entity, chosen by its domain. */
function stateFor(entityId: string, index: number): string {
  switch (entityId.split('.')[0]) {
    case 'light': case 'switch': return index % 3 === 0 ? 'off' : 'on';
    case 'input_boolean': return index % 2 === 0 ? 'on' : 'off';
    case 'binary_sensor': return 'off';
    case 'sensor': return '21.5';
    case 'climate': return 'heat';
    case 'lock': return 'locked';
    case 'cover': return 'closed';
    case 'alarm_control_panel': return 'disarmed';
    case 'weather': return 'sunny';
    default: return 'idle';
  }
}

/**
 * A made-up house for the entities a document names, so the preview shows states without a Home Assistant connection (the
 * dev story page and the tests). Every `domain.object_id` string in the document gets a state.
 */
export function demoHouse(document: CompositionDocument): House {
  const ids = [...new Set(JSON.stringify(document).match(/"((?:light|switch|binary_sensor|sensor|climate|alarm_control_panel|lock|cover|camera|weather|person|input_boolean|fan|media_player|select)\.[a-z0-9_]+)"/g) ?? [])]
    .map(match => match.slice(1, -1));
  const states: NativeState[] = ids.map((entityId, index) => ({ entityId, name: entityId, state: stateFor(entityId, index), ...(entityId.startsWith('light.') ? { brightness: 180 } : {}) }));
  return houseFrom({ states });
}
