import type { CompositionDocument, CallService } from '../shared/composition/schema';
import { initialLocalValue, type LocalValue } from '../shared/composition/shell';
import type { NativeCurrentUser, NativeState } from '../shared/native-state';
import type { Json } from '../shared/types';
import { evaluateOperand, finiteNumber, loading, scalarText, unavailable, value, type Environment, type ReadResult, type Viewer } from './evaluate';

/**
 * Data-source models resolved from house states, for the 2.0 preview. Phase 1 resolves `ha-entity`, `power-toggle@1`,
 * `home-status@1`, `home-light@1`, `alarm-mode@1` and `security-door@1`; every other model is `unavailable`, which a node
 * draws as its own `unavailableText`. The text rules follow `RoomFormat` and `ServerUIHomeStatus` in the app; the room and
 * detail sentences and the climate and air-quality summaries are simplified (a state, not the full sentence).
 */

/** The house as the preview sees it: `states` is undefined until the first read arrives. */
export interface House {
  states?: ReadonlyMap<string, NativeState>;
  viewer?: Viewer;
}
/** Simulated changes laid over the house. A call updates this, never a device. */
export interface Overlay {
  /** Entity fields that replace what the house says, by entity id. */
  entities: Readonly<Record<string, Partial<NativeState>>>;
  /** Scene values written by `set-local`, by local state id. */
  local: Readonly<Record<string, LocalValue>>;
}
export const emptyOverlay: Overlay = { entities: {}, local: {} };
export type Phase = 'loading' | 'unavailable' | 'ready';
/** What a source resolves to: a phase and the named fields a `read` may ask for. */
export interface Projection { model: string; phase: Phase; fields: Readonly<Record<string, Json>> }

/** Builds a house from a `/api/native-home` snapshot. */
export function houseFrom(snapshot: { states: NativeState[]; currentUser?: NativeCurrentUser }): House {
  const user = snapshot.currentUser;
  return {
    states: new Map(snapshot.states.map(state => [state.entityId, state])),
    viewer: user ? { userId: user.id, isAdmin: user.isAdmin, personEntityId: user.personEntityId } : undefined,
  };
}

// MARK: Entities

const isDead = (state: string | undefined) => !state || ['unavailable', 'unknown'].includes(state.trim().toLowerCase());
/** The entity as shown: the house's state with the overlay's fields on top. Undefined when the house lacks it. */
export function shownEntity(house: House, overlay: Overlay, entityId: string): NativeState | undefined {
  const base = house.states?.get(entityId), change = overlay.entities[entityId];
  return base && change ? { ...base, ...change } : base ?? (change ? { entityId, state: 'unknown', name: entityId, ...change } : undefined);
}
const domainOf = (entityId: string) => entityId.split('.')[0];
const titleCase = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const snake = (name: string) => name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
const attributeAliases: Record<string, keyof NativeState> = {
  friendly_name: 'name', unit_of_measurement: 'unit', device_class: 'deviceClass',
};
/** A Home Assistant attribute from a flat `NativeState`, by its snake-case name. */
export function attributeOf(entity: NativeState, name: string): Json | undefined {
  const field = attributeAliases[name] ?? snake(name);
  const found = (entity as Record<string, unknown>)[field];
  return found === undefined ? undefined : found as Json;
}

/** `RoomFormat.compact`: the state a tile line shows. */
export function compactState(entity: NativeState | undefined): string {
  if (!entity || entity.state === 'unavailable') return 'Unavailable';
  if (domainOf(entity.entityId) === 'binary_sensor' && entity.entityId.split('.')[1]?.startsWith('contact')) return entity.state === 'on' ? 'Open' : 'Closed';
  if (domainOf(entity.entityId) === 'binary_sensor') return entity.state === 'on' ? 'Active' : 'Clear';
  if (domainOf(entity.entityId) === 'light') return entity.state === 'on' ? 'On' : 'Off';
  return titleCase(entity.state);
}
const occupancyText = (entity: NativeState | undefined) =>
  !entity || entity.state === 'unavailable' ? 'Unavailable' : entity.state === 'unknown' ? 'Unknown'
    : ['on', 'active', 'occupied'].includes(entity.state) ? 'Detected' : ['off', 'inactive', 'clear', 'not_occupied'].includes(entity.state) ? 'Clear' : titleCase(entity.state);
const contactText = (entity: NativeState | undefined) =>
  !entity || entity.state === 'unavailable' ? 'Unavailable' : entity.state === 'unknown' ? 'Unknown'
    : ['on', 'open'].includes(entity.state) ? 'Open' : ['off', 'closed'].includes(entity.state) ? 'Closed' : titleCase(entity.state);
/** `RoomFormat.isActive`: alarm panels are active unless disarmed; others when on, open, playing, recording, home, heat or cool. */
export function isActiveState(entity: NativeState | undefined): boolean {
  if (!entity) return false;
  if (domainOf(entity.entityId) === 'alarm_control_panel') return entity.state !== 'disarmed';
  return ['on', 'open', 'playing', 'recording', 'home', 'heat', 'cool'].includes(entity.state);
}

// MARK: Models

type Source = CompositionDocument['dataSources'][number];
type Literal = { type: 'literal'; value: string };
const literal = (operand: Literal | undefined) => operand?.value;
const stateText = (entity: NativeState | undefined) => !entity || isDead(entity.state) ? 'Unavailable' : titleCase(entity.state);
const phaseOf = (house: House, entity: NativeState | undefined): Phase =>
  !house.states ? 'loading' : !entity || isDead(entity.state) ? 'unavailable' : 'ready';
const result = (model: string, phase: Phase, fields: Record<string, Json>): Projection => ({ model, phase, fields });

function homeStatus(source: Extract<Source, { model: 'home-status@1' }>, house: House, overlay: Overlay): Projection {
  const { inputs, labels } = source, read = (id: string) => shownEntity(house, overlay, id);
  const fields = (state: string, text: string, active = false): Record<string, Json> => ({ stateText: text, state, isActive: active });
  const done = (state: string, text: string, phase: Phase, active = false) => result(source.model, phase, { ...fields(state, text, active), phase });
  if (!house.states) return done('loading', labels.loading, 'loading');
  const ids = inputs.entityIds.map(entry => entry.value);
  if (!ids.length) return done('empty', labels.empty, 'ready');
  const entities = ids.map(read), missing = entities.filter(entity => !entity || isDead(entity.state)).length;
  const usable = (id?: string) => { const found = id ? read(id) : undefined; return !!found && !isDead(found.state); };
  const rescued = inputs.projection === 'climate' ? usable(inputs.rangeEntityId?.value) : inputs.projection === 'air-quality' ? usable(inputs.secondaryEntityId?.value) : false;
  if (missing === entities.length && !rescued) return done('unavailable', labels.unavailable, 'unavailable');
  if (inputs.projection === 'entity') return done(entities[0]!.state, entities[0]!.state, 'ready');
  if (inputs.projection === 'lights' || inputs.projection === 'occupancy' || inputs.projection === 'contacts') {
    const test = inputs.projection === 'lights' ? isActiveState : inputs.projection === 'occupancy'
      ? (entity?: NativeState) => ['on', 'active', 'occupied'].includes(entity?.state ?? '') : (entity?: NativeState) => ['on', 'open'].includes(entity?.state ?? '');
    const count = entities.filter(entity => entity && test(entity)).length, active = count > 0;
    // A partial sensor set cannot vouch for a closed, unoccupied or off house.
    if (missing > 0 && !active) return done('unavailable', labels.unavailable, 'unavailable');
    const text = inputs.format === 'item'
      ? inputs.projection === 'contacts' ? contactText(entities[0]) : inputs.projection === 'occupancy' ? occupancyText(entities[0]) : compactState(entities[0])
      : inputs.format === 'summary' ? active ? inputs.projection === 'occupancy' ? labels.active : `${count}${labels.countSuffix}` : labels.idle
        : active ? `${count} of ${ids.length}` : labels.idle;
    const state = inputs.projection === 'contacts' && active ? 'open-home' : active ? 'active' : 'idle';
    return done(state, text, 'ready', active);
  }
  if (inputs.projection === 'climate') {
    const lead = (inputs.rangeEntityId ? read(inputs.rangeEntityId.value) : undefined) ?? entities.find(entity => entity && !isDead(entity.state));
    const text = lead ? `${lead.state}${lead.unit && inputs.format !== 'summary' ? lead.unit : ''}` : labels.unavailable;
    return done('idle', text, 'ready');
  }
  const aqi = entities[0], pm25 = inputs.secondaryEntityId ? read(inputs.secondaryEntityId.value) : undefined;
  const part = (entity?: NativeState) => !entity || isDead(entity.state) ? 'Unavailable' : `${entity.state}${entity.unit ? ` ${entity.unit}` : ''}`;
  return done('idle', `${part(aqi)} • ${part(pm25)}`, 'ready');
}

/**
 * Resolves one source against the house. Returns `unavailable` fields for a model phase 1 does not resolve.
 * `entityOf` turns a `ha-entity`/`power-toggle` entity value (a literal or a read) into an entity id.
 */
export function projectSource(source: Source, house: House, overlay: Overlay, entityOf: (entityId: unknown) => string | undefined): Projection {
  const entity = (id: string | undefined) => id ? shownEntity(house, overlay, id) : undefined;
  if (source.kind === 'ha-entity') {
    const id = entityOf(source.entityId), found = entity(id);
    return result('ha-entity', phaseOf(house, found), found ? { state: found.state, entityId: found.entityId } : {});
  }
  switch (source.model) {
    case 'power-toggle@1': {
      const found = entity(entityOf(source.inputs.entityId)), phase = phaseOf(house, found);
      return result(source.model, phase, {
        stateText: phase === 'loading' ? 'Loading' : stateText(found), isOn: found?.state === 'on', phase, isError: false,
      });
    }
    case 'home-status@1': return homeStatus(source, house, overlay);
    case 'home-light@1': {
      const found = entity(literal(source.inputs.entityId)), phase = phaseOf(house, found);
      const members = (source.inputs.memberEntityIds ?? []).map(member => entity(member.value));
      const on = found?.state === 'on' || members.some(member => member?.state === 'on');
      const brightness = found?.brightness;
      return result(source.model, phase, {
        phase, isOn: on, state: found?.state ?? 'unavailable', stateText: phase === 'loading' ? 'Loading' : stateText(found),
        brightnessPercent: typeof brightness === 'number' ? Math.round(brightness / 255 * 100) : null,
        memberCount: members.length, membersOn: members.filter(member => member?.state === 'on').length,
      });
    }
    case 'alarm-mode@1': {
      const found = entity(literal(source.inputs.entityId)), phase = phaseOf(house, found);
      return result(source.model, phase, { phase, state: found?.state ?? 'unavailable', isActive: isActiveState(found) });
    }
    case 'security-door@1': {
      const found = entity(literal(source.inputs.entityId)), phase = phaseOf(house, found), kind = source.inputs.kind;
      const state = found?.state ?? 'unavailable';
      return result(source.model, phase, {
        phase, state, kind, isActive: kind === 'lock' ? state !== 'locked' : state !== 'closed', isError: state === 'jammed',
      });
    }
    default: return result(source.model, house.states ? 'unavailable' : 'loading', {});
  }
}

// MARK: Environment

/**
 * An evaluation environment over `document`'s sources, the house and the overlay. A `ha-entity` read of `['state']` gives
 * the state text, `['attributes', name]` an attribute; a model read gives the field it names (`stateText`, `isOn`, `phase`,
 * `isActive` and so on). A source of a model phase 1 does not resolve reads as unavailable, or loading before the first read.
 */
export function createEnvironment(document: Pick<CompositionDocument, 'dataSources'>, house: House, overlay: Overlay = emptyOverlay, control?: Json): Environment {
  const sources = new Map(document.dataSources.map(source => [source.id, source]));
  const resolving = new Set<string>();
  const env: Environment = {
    viewer: house.viewer,
    controlValue: control,
    viewerPersonState: () => {
      const id = house.viewer?.personEntityId;
      if (!house.viewer) return loading;
      const found = id ? shownEntity(house, overlay, id) : undefined;
      return found ? value(found.state) : unavailable;
    },
    read(sourceId, path) {
      const source = sources.get(sourceId);
      if (!source) return unavailable;
      const projection = projectSource(source, house, overlay, entityId => {
        if (!entityId || typeof entityId !== 'object') return undefined;
        const operand = entityId as { type: string; value?: unknown };
        if (operand.type === 'literal') return typeof operand.value === 'string' ? operand.value : undefined;
        if (resolving.has(sourceId)) return undefined;
        resolving.add(sourceId);
        try {
          const resolved = evaluateOperand(operand as never, env);
          return resolved.status === 'value' && typeof resolved.value === 'string' ? resolved.value : undefined;
        } finally { resolving.delete(sourceId); }
      });
      if (source.kind === 'ha-entity') return readEntity(house, overlay, projection, path);
      if (projection.phase === 'loading' && path[0] !== 'phase') return loading;
      const field = path.length === 1 ? projection.fields[path[0]] : undefined;
      return field === undefined ? projection.phase === 'loading' ? loading : unavailable : value(field);
    },
  };
  return env;
}
function readEntity(house: House, overlay: Overlay, projection: Projection, path: string[]): ReadResult {
  if (!house.states) return loading;
  const id = projection.fields.entityId, found = typeof id === 'string' ? shownEntity(house, overlay, id) : undefined;
  if (!found) return unavailable;
  if (path.length === 1 && path[0] === 'state') return value(found.state);
  if (path[0] !== 'attributes' || path.length < 2) return unavailable;
  const attribute = attributeOf(found, path[1]);
  return attribute === undefined ? unavailable : value(attribute);
}
/** The current value of a local state field: the overlay's write, else its initial value. */
export function localValue(document: Pick<CompositionDocument, 'localState'>, overlay: Overlay, stateId: string): LocalValue | undefined {
  const field = document.localState?.find(item => item.id === stateId);
  return overlay.local[stateId] ?? (field ? initialLocalValue(field) : undefined);
}

// MARK: Simulated calls

/** A service call with its operands resolved. */
export interface ResolvedCall { domain: string; service: string; entityIds: string[]; data: Record<string, Json> }
/** Resolves a `call-service` action's target and data against `env`; undefined when an operand is not available. */
export function resolveCall(call: CallService, env: Environment): ResolvedCall | undefined {
  const entityIds: string[] = [];
  if (call.target?.entity_id) {
    const target = evaluateOperand(call.target.entity_id, env);
    if (target.status !== 'value') return undefined;
    entityIds.push(...(Array.isArray(target.value) ? target.value : [target.value]).filter((id): id is string => typeof id === 'string'));
  }
  let data: Record<string, Json> = {};
  if (call.data) {
    const resolved = evaluateOperand(call.data, env);
    if (resolved.status !== 'value') return undefined;
    data = resolved.value as Record<string, Json>;
  }
  return { domain: call.domain, service: call.service, entityIds, data };
}

const alarmStates: Record<string, string> = {
  alarm_disarm: 'disarmed', alarm_arm_home: 'armed_home', alarm_arm_away: 'armed_away', alarm_arm_night: 'armed_night',
};
/** The fields a simulated call changes on one entity, or undefined when the preview does not simulate that call. */
function changeFor(domain: string, service: string, entity: NativeState, data: Record<string, Json>): Partial<NativeState> | undefined {
  const on = entity.state === 'on';
  if (service === 'turn_on' || service === 'turn_off' || service === 'toggle') {
    const next = service === 'toggle' ? !on : service === 'turn_on';
    const change: Partial<NativeState> = { state: next ? 'on' : 'off' };
    const pct = finiteNumber(data.brightness_pct), raw = finiteNumber(data.brightness);
    if (next && (pct !== undefined || raw !== undefined)) change.brightness = pct !== undefined ? Math.round(pct * 255 / 100) : raw;
    return change;
  }
  if (domain === 'lock' && (service === 'lock' || service === 'unlock')) return { state: service === 'lock' ? 'locked' : 'unlocked' };
  if (domain === 'cover' && (service === 'open_cover' || service === 'close_cover')) return { state: service === 'open_cover' ? 'open' : 'closed' };
  if (domain === 'alarm_control_panel' && alarmStates[service]) return { state: alarmStates[service] };
  if (domain === 'climate' && service === 'set_temperature') {
    const change: Partial<NativeState> = {}, set = (key: 'temperature' | 'targetTempHigh' | 'targetTempLow', from: string) => {
      const n = finiteNumber(data[from]); if (n !== undefined) change[key] = n;
    };
    set('temperature', 'temperature'); set('targetTempHigh', 'target_temp_high'); set('targetTempLow', 'target_temp_low');
    return Object.keys(change).length ? change : undefined;
  }
  if (domain === 'climate' && service === 'set_hvac_mode' && typeof data.hvac_mode === 'string') return { state: data.hvac_mode };
  return undefined;
}

/**
 * Applies a resolved call to the overlay. The returned overlay is `overlay` itself when the call changes nothing the
 * preview simulates, so a view bound to it does not redraw. No device is touched.
 */
export function applyCall(house: House, overlay: Overlay, call: ResolvedCall): Overlay {
  let entities = overlay.entities, changed = false;
  for (const id of call.entityIds) {
    const entity = shownEntity(house, overlay, id);
    if (!entity || isDead(entity.state)) continue;
    const change = changeFor(domainOf(id), call.service, entity, call.data);
    if (!change || Object.entries(change).every(([key, next]) => (entity as Record<string, unknown>)[key] === next)) continue;
    entities = { ...entities, [id]: { ...entities[id], ...change } };
    changed = true;
  }
  return changed ? { ...overlay, entities } : overlay;
}
/** Writes a `set-local` value into the overlay. */
export const applyLocal = (overlay: Overlay, stateId: string, next: LocalValue): Overlay =>
  ({ ...overlay, local: { ...overlay.local, [stateId]: next } });
/** The text a read gave, for tests and labels. */
export const readText = (read: ReadResult) => read.status === 'value' ? scalarText(read.value) : undefined;
