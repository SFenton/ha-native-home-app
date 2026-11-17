import type { CompositionDocument } from '../shared/composition/schema';
import type { NativeState } from '../shared/native-state';
import type { Json } from '../shared/types';
import { finiteNumber } from './evaluate';
import type { Projection } from './projections';

/**
 * Device-model projections for the 2.0 preview: `climate@1`, `custom-lights@1`, `sprinkler-controller@1`, `vacuum@1` and
 * `media-remote@1`. Each reads the entities its source names through `read` (the house with the overlay on top) and gives flat
 * fields the drawn nodes ask for. A model whose entity is missing or dead is `unavailable`; before the first read it is
 * `loading`. Nothing here knows the app's provider logic: it is a state, not the app's full sentence.
 */

type Source = CompositionDocument['dataSources'][number];
/** Reads one entity as the preview shows it. */
export type EntityRead = (entityId: string | undefined) => NativeState | undefined;

/** Whether a state says "no data". */
export const isDeadState = (state: string | undefined) => !state || ['unavailable', 'unknown'].includes(state.trim().toLowerCase());
/** The entity's state as a number, when it is one. */
export const numericState = (entity: NativeState | undefined): number | undefined => entity && !isDeadState(entity.state) ? finiteNumber(entity.state) : undefined;
/** `a_b` as `A B`. */
export const titleCase = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
/** The fields with every undefined value dropped, so they are valid JSON. */
const compact = (fields: Record<string, Json | undefined>): Record<string, Json> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Record<string, Json>;
/** A select's `options`, empty when it has none. */
const optionsOf = (entity: NativeState | undefined): string[] => entity?.options ?? [];
const live = (entity: NativeState | undefined) => !!entity && !isDeadState(entity.state);
const phaseFor = (loaded: boolean, ...lead: (NativeState | undefined)[]): Projection['phase'] =>
  !loaded ? 'loading' : lead.some(live) ? 'ready' : 'unavailable';
const done = (model: string, phase: Projection['phase'], fields: Record<string, Json | undefined>): Projection => ({ model, phase, fields: compact({ ...fields, phase }) });

/** The projection of a device model, or undefined for a model this file does not own. */
export function projectDevice(source: Source, sources: ReadonlyMap<string, Source>, read: EntityRead, loaded: boolean): Projection | undefined {
  if (source.kind !== 'model') return undefined;
  switch (source.model) {
    case 'climate@1': {
      const input = source.inputs, entity = read(input.entityId), sensor = read(input.sensorEntityId), occupancy = read(input.occupancyEntityId), action = read(input.actionEntityId);
      const lead = live(entity) ? entity : undefined;
      return done(source.model, phaseFor(loaded, entity), {
        entityId: input.entityId, state: entity?.state, isOn: entity?.state === 'on' || (entity?.entityId.startsWith('climate.') === true && live(entity) && entity.state !== 'off'),
        hvacAction: action?.state ?? lead?.hvacAction, fan: lead?.fanMode, preset: lead?.presetMode, current: lead?.currentTemperature, target: lead?.temperature,
        low: lead?.targetTempLow, high: lead?.targetTempHigh, minTemp: lead?.minTemp, maxTemp: lead?.maxTemp, unit: lead?.unit,
        sensor: numericState(sensor), occupancy: occupancy?.state,
        homeMode: live(read(input.homeAway?.modeEntityId)) ? read(input.homeAway?.modeEntityId)!.state : live(read(input.effectiveAway?.modeEntityId)) ? read(input.effectiveAway?.modeEntityId)!.state : undefined,
      });
    }
    case 'custom-lights@1': {
      const input = source.inputs, manual = read(input.manualEntityId), mode = read(input.modeEntityId);
      return done(source.model, phaseFor(loaded, manual, mode), {
        manualEntityId: input.manualEntityId, manualOn: manual?.state === 'on', mode: live(mode) ? mode!.state : undefined, modes: input.fallbackModes, customMode: input.customMode,
        manualTitle: input.manualTitle, modeTitle: input.modeTitle, sectionTitle: input.sectionTitle,
        swatch: input.palettes.find(palette => palette.mode === (mode?.state ?? input.customMode))?.colors.map(color => `rgb(${color.red} ${color.green} ${color.blue})`),
      });
    }
    case 'sprinkler-controller@1': {
      const c = source.inputs.controller, battery = read(c.batteryEntityId), next = read(c.nextWateringEntityId), hub = read(c.hubConnectedEntityId);
      const zones = c.zones.map(zone => ({ valve: read(zone.valveEntityId)?.state ?? null, program: read(zone.programEntityId)?.state ?? null, last: live(read(zone.historyEntityId)) ? read(zone.historyEntityId)!.state : null }));
      const percent = numericState(battery);
      return done(source.model, phaseFor(loaded, battery, next, hub, read(c.stateEntityId)), {
        title: c.title, batteryPercent: percent, batteryLow: percent !== undefined && percent <= source.inputs.lowBatteryPercent,
        next: live(next) ? next!.state : undefined, hubConnected: live(hub) ? hub!.state === 'on' : undefined, fault: read(c.faultEntityId)?.state === 'on',
        mode: read(c.modeEntityId)?.state, rainDelay: read(c.rainDelayEntityId)?.state === 'on', smart: read(c.smartWateringEntityId)?.state === 'on',
        watering: zones.some(zone => zone.valve === 'open'), stateText: read(c.stateEntityId)?.state, zones, last: zones.find(zone => zone.last)?.last,
      });
    }
    case 'vacuum@1': {
      const d = source.inputs, entity = read(d.entityId), battery = read(d.batteryEntityId), pick = (id?: string) => live(read(id)) ? read(id)!.state : undefined;
      const text = (id: string) => { const found = read(id); return live(found) ? `${found!.state}${found!.unit ? ` ${found!.unit}` : ''}` : null; };
      return done(source.model, phaseFor(loaded, entity), {
        state: entity?.state, battery: numericState(battery) ?? (live(entity) ? entity!.batteryLevel : undefined), status: pick(d.statusEntityId), error: pick(d.errorEntityId),
        mode: pick(d.modeTextEntityId) ?? pick(d.modeEntityId), fan: pick(d.fanEntityId), water: pick(d.waterEntityId), passes: pick(d.passesEntityId),
        // The `options` of each select, for the pull-down menus (`VacuumController.setting`).
        modeOptions: optionsOf(read(d.modeEntityId)), fanOptions: optionsOf(read(d.fanEntityId)), waterOptions: optionsOf(read(d.waterEntityId)), passesOptions: optionsOf(read(d.passesEntityId)),
        dock: pick(d.dockControls?.dockStatusEntityId),
        consumables: d.consumables.map(item => ({ title: item.title, text: text(item.entityId) })),
        autoRooms: d.autoCleanDisabledRooms.map(room => ({ title: room.title, on: read(room.entityId)?.state === 'on' })),
        zones: d.zones.map(zone => ({ title: zone.title, icon: zone.icon, mapName: zone.mapName ?? zone.title, on: read(zone.entityId)?.state === 'on' })),
        mapId: d.vacuumMapId,
        autoTitle: d.autoCleanControl?.title, autoEntityId: d.autoCleanControl?.entityId, autoKind: d.autoCleanControl?.kind,
      });
    }
    case 'media-remote@1': {
      const provider = sources.get(source.inputs.providerId);
      if (!provider || provider.kind !== 'model' || provider.model !== 'media-remote-config@1') return done(source.model, loaded ? 'unavailable' : 'loading', {});
      const c = provider.inputs, media = read(c.mediaEntityId), volume = read(c.volumeEntityId);
      const device = (title: string, entityId: string, stateEntityIds: string[] | undefined, activeStates: string[], labels: Record<string, string>, key?: string) => {
        const entity = read(stateEntityIds?.[0] ?? entityId), state = entity?.state;
        return { title, key: key ?? null, state: state ?? null, text: state && !isDeadState(state) ? labels[state] ?? null : null, active: !!state && activeStates.includes(state) };
      };
      const sync = c.lightSync;
      return done(source.model, phaseFor(loaded, media, volume), {
        mediaState: media?.state, isOn: live(media) && !['off', 'standby'].includes(media!.state), volume: volume?.volumeLevel, muted: volume?.isVolumeMuted,
        apps: c.apps.map(app => { const state = read(app.stateEntityId)?.state; return { title: app.title, active: !!state && app.activeStates.includes(state) }; }),
        devices: c.devices.map(item => device(item.title, item.entityId, item.stateEntityIds, item.activeStates, item.stateLabels)),
        cards: c.cards.map(item => device(item.configuration.title, item.configuration.entityId, item.configuration.stateEntityIds, item.configuration.activeStates, item.configuration.stateLabels, item.key)),
        hue: sync ? { power: read(sync.powerEntityId)?.state ?? null, sync: read(sync.lightSyncEntityId)?.state ?? null, mode: read(sync.syncModeEntityId)?.state ?? null,
          intensity: read(sync.intensityEntityId)?.state ?? null, brightness: numericState(read(sync.brightnessEntityId)) ?? null, input: read(sync.hdmiInputEntityId)?.state ?? null,
          connected: sync.hdmiStatusEntityIds.map(id => read(id)?.state ?? null) } : undefined,
      });
    }
    default: return undefined;
  }
}
