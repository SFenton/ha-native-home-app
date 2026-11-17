import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';

const s = (entityId: string, state: string, extra: Partial<NativeState> = {}): NativeState => ({ entityId, state, name: entityId, ...extra });

/**
 * The made-up house the `device-controls` fixture reads: a heating thermostat with a setpoint range, a docked robot at 87%,
 * colour lights, a sprinkler controller, a streaming box that is playing. Synthetic `demo_` ids only. `light.demo_missing`
 * and `sensor.demo_whole_temp` are left out so the unavailable states draw.
 */
export const deviceStates: NativeState[] = [
  s('climate.demo_whole', 'heat', { temperature: 72, currentTemperature: 70.5, hvacAction: 'heating', fanMode: 'auto', presetMode: 'home', targetTempLow: 70, targetTempHigh: 76, unit: '°F' }),
  s('climate.demo_range', 'heat_cool', { temperature: 73, currentTemperature: 73, hvacAction: 'cooling', targetTempLow: 68, targetTempHigh: 72, unit: '°F' }),
  s('sensor.demo_room_temp', '70.9'), s('binary_sensor.demo_room_occ', 'on'), s('sensor.demo_room2_temp', '76.1'), s('binary_sensor.demo_room2_occ', 'off'),
  s('switch.demo_predictive', 'on'), s('select.demo_critical', 'Track Select Critical'), s('sensor.demo_home_mode', 'away'), s('input_boolean.demo_home_away', 'on'), s('input_boolean.demo_vacation', 'off'),
  s('input_boolean.demo_manual', 'on'), s('input_select.demo_mode', 'Holiday'), s('light.demo_group', 'on'),
  s('light.demo_left', 'on', { brightness: 255, rgbColor: [120, 240, 90] }), s('light.demo_right', 'on', { brightness: 230, rgbColor: [150, 120, 240] }),
  s('light.demo_bollard_1', 'on', { brightness: 204, rgbColor: [255, 120, 200] }), s('light.demo_bollard_2', 'off'),
  s('sensor.demo_sprinkler_battery', '82'), s('binary_sensor.demo_sprinkler_fault', 'off'), s('binary_sensor.demo_sprinkler_hub', 'on'), s('select.demo_sprinkler_mode', 'auto'),
  s('sensor.demo_sprinkler_next', '7:00 AM'), s('switch.demo_sprinkler_rain', 'off'), s('switch.demo_sprinkler_smart', 'on'), s('sensor.demo_sprinkler_state', 'idle'),
  s('valve.demo_zone_1', 'closed'), s('switch.demo_program_1', 'on'), s('sensor.demo_history_1', '6:00 AM'),
  s('vacuum.demo_robot', 'docked', { batteryLevel: 87 }), s('sensor.demo_robot_battery', '87'), s('sensor.demo_robot_error', 'none'), s('sensor.demo_robot_status', 'docked'),
  s('select.demo_robot_mode', 'vacuum_and_mop', { options: ['vacuum', 'mop', 'vacuum_and_mop'] }), s('select.demo_robot_fan', 'max', { options: ['quiet', 'balanced', 'turbo', 'max'] }),
  s('select.demo_robot_water', 'medium', { options: ['low', 'medium', 'high'] }), s('input_select.demo_robot_passes', '2', { options: ['1', '2', '3'] }), s('sensor.demo_dock_status', 'idle'),
  s('sensor.demo_main_brush', '233', { unit: 'h' }), s('sensor.demo_filter', '48', { unit: 'h' }),
  s('automation.demo_auto_clean', 'on'), s('switch.demo_skip_kitchen', 'off'), s('switch.demo_skip_studio', 'off'), s('switch.demo_skip_media', 'on'),
  s('input_boolean.demo_zone_kitchen', 'on'), s('input_boolean.demo_zone_living', 'off'),
  s('media_player.demo_unit', 'playing', { volumeLevel: .32, isVolumeMuted: false }), s('sensor.demo_app', 'Plex'), s('sensor.demo_pc', 'on'),
  s('switch.demo_hue_power', 'on'), s('switch.demo_hue_sync', 'on'), s('select.demo_hue_mode', 'video'), s('select.demo_hue_intensity', 'high'), s('number.demo_hue_brightness', '65'),
  s('select.demo_hue_input', 'HDMI 1'), s('binary_sensor.demo_hue_hdmi1', 'on'),
  s('input_boolean.demo_auto_lock', 'on'), s('input_boolean.demo_garage_close', 'off'), s('sensor.demo_charge', 'charging'), s('switch.demo_room_presence', 'on'),
  s('input_boolean.demo_check_sprinklers', 'on'), s('input_boolean.demo_check_garage', 'off'),
  s('person.demo_alex', 'home', { name: 'Alex' }), s('person.demo_sam', 'home', { name: 'Sam' }),
];
/** The house for the `device-controls` fixture. */
export const deviceHouse = (): House => houseFrom({ states: deviceStates });
