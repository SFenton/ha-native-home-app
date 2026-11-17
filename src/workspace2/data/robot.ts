import type { CompositionDocument } from '../../shared/composition/schema';
import type { VacuumDescriptor } from '../../shared/composition/vacuum';

/** What a robot needs before it exists: a name, the map's id and one entity for each required part. */
export interface RobotParts {
  title: string; vacuumMapId: string;
  entityId: string; batteryEntityId: string; errorEntityId: string; statusEntityId: string; statusFlagEntityId: string; passesEntityId: string; cleanScript: string;
}

/** The entity parts of a robot with the domains each accepts, in the order the form asks. */
export const robotRows: readonly { key: keyof Omit<RobotParts, 'title' | 'vacuumMapId'>; label: string; domains: readonly string[] }[] = [
  { key: 'entityId', label: 'Robot', domains: ['vacuum'] }, { key: 'batteryEntityId', label: 'Battery', domains: ['sensor'] },
  { key: 'errorEntityId', label: 'Error', domains: ['sensor'] }, { key: 'statusEntityId', label: 'Status', domains: ['sensor'] },
  { key: 'statusFlagEntityId', label: 'Status Flag', domains: ['sensor', 'input_text'] }, { key: 'passesEntityId', label: 'Passes', domains: ['select', 'input_select'] },
  { key: 'cleanScript', label: 'Clean Script', domains: ['script'] },
];

/** Whether the parts make a robot: every part chosen and a map id of lowercase words and underscores. */
export const robotComplete = (parts: Partial<RobotParts>): parts is RobotParts =>
  Boolean(parts.title?.trim()) && /^[a-z][a-z0-9_]*$/.test(parts.vacuumMapId ?? '') && robotRows.every(row => Boolean(parts[row.key]));

/** The `vacuum@1` source a robot's parts make. The map starts upright and unscaled; rooms, zones and consumables are added from the Data panel. */
export function robotDescriptor(parts: RobotParts): VacuumDescriptor {
  return {
    title: parts.title.trim(), entityId: parts.entityId, batteryEntityId: parts.batteryEntityId, cleanScript: parts.cleanScript, errorEntityId: parts.errorEntityId,
    passesEntityId: parts.passesEntityId, statusEntityId: parts.statusEntityId, statusFlagEntityId: parts.statusFlagEntityId,
    vacuumMapId: parts.vacuumMapId, mapRoomSelection: true, mapRotationDegrees: 0, mapScale: 1,
    consumables: [], autoCleanDisabledRooms: [], outcomeRoomNames: [], outcomeReconciliations: [], zoneDescription: [], zones: [],
  };
}

/** A new robot source for the document, with an id no source has. */
export function newRobotSource(document: CompositionDocument, parts: RobotParts): CompositionDocument['dataSources'][number] {
  const taken = new Set(document.dataSources.map(item => item.id));
  let id = `robot-${parts.vacuumMapId.replace(/_/g, '-')}`, count = 1;
  const base = id;
  while (taken.has(id)) id = `${base}-${++count}`;
  return { id, kind: 'model', model: 'vacuum@1', inputs: robotDescriptor(parts) as never } as CompositionDocument['dataSources'][number];
}
