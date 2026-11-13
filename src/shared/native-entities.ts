import { entityIdSchema } from './schema';

// Swift ClimateConfig.Room derives these five IDs from the configured room title.
export function nativeClimateRoomEntities(title: string) {
  const key = title.toLowerCase().replaceAll(' ', '_');
  const entities = {
    thermostat: `climate.thermostat_contact_sensors_${key}_virtual_thermostat`,
    temperature: `sensor.thermostat_contact_sensors_${key}_temperature`,
    occupancy: `sensor.thermostat_contact_sensors_${key}_occupancy`,
    track: `switch.thermostat_contact_sensors_track_${key}`,
    critical: `switch.thermostat_contact_sensors_${key}_force_track_when_critical`,
  };
  if (!key || Object.values(entities).some(id => !entityIdSchema.safeParse(id).success)) {
    throw new TypeError('Native climate room title cannot produce safe entity IDs');
  }
  return entities;
}
