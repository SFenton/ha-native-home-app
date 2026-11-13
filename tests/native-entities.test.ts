import { describe, expect, it } from 'vitest';
import { nativeHomeSnapshot, type NativeHouseConfig } from '../server/native-home';

const envelope = (config: NativeHouseConfig['config']): NativeHouseConfig => ({ schema: 2, hash: 'a'.repeat(64), config });
const state = (entity_id: string, value = '0') => ({ entity_id, state: value, attributes: { access_token: 'not-forwarded' } });

describe('native derived climate state coverage', () => {
  it('includes existing Swift-derived room entities without exposing unrelated states or attributes', () => {
    const config = envelope({ climate: { rooms: [{ title: 'Test Room', occupiedOnlyEntityId: 'switch.explicit_occupied_only' }] } });
    const raw = [
      state('climate.thermostat_contact_sensors_test_room_virtual_thermostat', 'heat'),
      state('sensor.thermostat_contact_sensors_test_room_temperature'),
      state('sensor.thermostat_contact_sensors_test_room_occupancy', 'on'),
      state('switch.thermostat_contact_sensors_track_test_room', 'off'),
      state('switch.thermostat_contact_sensors_test_room_force_track_when_critical', 'off'),
      state('switch.explicit_occupied_only', 'on'),
      state('sensor.thermostat_contact_sensors_other_room_temperature'),
      state('sensor.unrelated'),
    ];
    const snapshot = nativeHomeSnapshot(config, raw, []);
    expect(snapshot.states.map(item => item.entityId)).toEqual(raw.slice(0, 6).map(item => item.entity_id));
    expect(snapshot.states[1].state).toBe('0');
    expect(JSON.stringify(snapshot)).not.toContain('not-forwarded');
    expect(snapshot.houseConfig).toEqual(config);
    expect(nativeHomeSnapshot(config, [], []).states).toEqual([]);
  });

  it.each([{ rooms: {} }, { rooms: [{}] }, { rooms: [{ title: '' }] }, { rooms: [{ title: '../Invalid' }] }])('rejects invalid derivation inputs instead of inventing or repairing IDs: %j', climate => {
    expect(() => nativeHomeSnapshot(envelope({ climate }), [], [])).toThrow(/Invalid native climate|cannot produce safe entity/);
  });

  it('counts derived entities toward the existing reference limit', () => {
    const config = envelope({
      sensors: Array.from({ length: 996 }, (_, index) => `sensor.test_${index}`),
      climate: { rooms: [{ title: 'Test Room' }] },
    });
    expect(() => nativeHomeSnapshot(config, [], [])).toThrow('more than 1000 entities');
  });
});
