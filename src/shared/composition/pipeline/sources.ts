import type { Json } from '../../types';
import { ANY, BOOLEAN, NUMBER, STRING, arrayOf, merge, objectOf, orNull, text, type Shape } from './shape';
import type { PipelineRequest } from './schema';

/**
 * What each live subscription pushes, as shapes. The list of kinds is closed because the app holds every subscription on its one Home
 * Assistant connection (resubscribing on reconnect, keeping the last answer), and a layout must not be able to send any other websocket command.
 * Both commands were read in Home Assistant core: `todo/item/subscribe` (`homeassistant/components/todo/__init__.py`) pushes `{items: [...]}` on
 * subscribe and on every change; `weather/subscribe_forecast` (`components/weather/websocket_api.py`) pushes `{type, forecast}`.
 */
export const subscriptionCommands = {
  'todo-items': 'todo/item/subscribe',
  'weather-forecast': 'weather/subscribe_forecast',
} as const;
/** The entity domain each subscription kind takes. */
export const subscriptionDomains = { 'todo-items': 'todo', 'weather-forecast': 'weather' } as const;

const optionalText = orNull(STRING);
/** The shape of one to-do item as Home Assistant serializes it. `due` is a date or a date and time. */
export const todoItemShape: Shape = objectOf({
  uid: STRING, summary: STRING, status: { kind: 'string', enum: ['completed', 'needs_action'] },
  due: orNull(merge(text('date'), text('date-time'))), description: optionalText,
}, ['due', 'description']);
const optionalNumber = orNull(NUMBER);
/** The shape of one forecast entry. Every field but `datetime` is optional: a provider fills what it has. */
export const forecastEntryShape: Shape = objectOf({
  datetime: text('date-time'), condition: optionalText, temperature: optionalNumber, templow: optionalNumber, apparent_temperature: optionalNumber,
  dew_point: optionalNumber, precipitation: optionalNumber, precipitation_probability: optionalNumber, humidity: optionalNumber, pressure: optionalNumber,
  cloud_coverage: optionalNumber, uv_index: optionalNumber, wind_speed: optionalNumber, wind_gust_speed: optionalNumber,
  wind_bearing: orNull(merge(NUMBER, STRING)), is_daytime: orNull(BOOLEAN),
}, ['condition', 'temperature', 'templow', 'apparent_temperature', 'dew_point', 'precipitation', 'precipitation_probability', 'humidity', 'pressure',
  'cloud_coverage', 'uv_index', 'wind_speed', 'wind_gust_speed', 'wind_bearing', 'is_daytime']);

/** The shape of the data the request hands the first step. */
export function requestShape(request: PipelineRequest): Shape {
  if (request.type === 'entities') {
    return arrayOf(objectOf({ entityId: text('entity-id'), state: STRING, ...Object.fromEntries(request.attributes.map(name => [name, ANY])) }));
  }
  // The value of a `none` request is typed by the compiler, which has the scope.
  if (request.type === 'none') return ANY;
  if (request.type !== 'ha-subscription') return request.responseShape;
  if (request.kind === 'todo-items') return objectOf({ items: arrayOf(todoItemShape) });
  return objectOf({ type: { kind: 'string', enum: ['daily', 'hourly', 'twice_daily'] }, forecast: arrayOf(forecastEntryShape) });
}

/** What the app holds about one entity. */
export interface HeldEntity { state: string; attributes: { [key: string]: Json } }
/**
 * The answer of an `entities` request: one row per listed entity in the order listed, `{entityId, state, ...attributes}`. An entity the app does not
 * hold gives state "unavailable"; an attribute it lacks is `null`. A name that is `entityId` or `state` is the compiler's to refuse.
 */
export function entityRows(request: Extract<PipelineRequest, { type: 'entities' }>, held: (entityId: string) => HeldEntity | undefined): Json[] {
  return request.entityIds.map(({ value: entityId }) => {
    const entity = held(entityId);
    const row: { [key: string]: Json } = { entityId, state: entity?.state ?? 'unavailable' };
    for (const name of request.attributes) if (!(name in row)) row[name] = entity && Object.hasOwn(entity.attributes, name) ? entity.attributes[name] : null;
    return row;
  });
}
