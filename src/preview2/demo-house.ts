import type { CompositionDocument } from '../shared/composition/schema';
import type { NativeState } from '../shared/native-state';
import { houseFrom, type House } from './projections';

/**
 * The friendly name the demo house gives an entity, standing in for Home Assistant's: a synthetic `demo_` id reads as words
 * ("light.demo_kitchen_lamp" is "Kitchen lamp"). Any other id has no friendly name, so it stays the raw id.
 */
export function demoFriendlyName(entityId: string): string {
  const object = entityId.split('.')[1] ?? '';
  if (!object.startsWith('demo_')) return entityId;
  const words = object.slice('demo_'.length).replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : entityId;
}

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
  const states: NativeState[] = ids.map((entityId, index) => ({ entityId, name: demoFriendlyName(entityId), state: stateFor(entityId, index), ...(entityId.startsWith('light.') ? { brightness: 180 } : {}) }));
  return houseFrom({ states });
}
