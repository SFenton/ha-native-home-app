import type { CompositionIssue } from './json';
import type { CompositionDocument } from './schema';
import { appStateFields } from './app-state';
import { checkPipelineRead } from './pipeline/compile';

/**
 * What a document may read from a model source, in one place for every consumer: a slot `read`, a `read` operand and a condition leaf all
 * resolve a source and a path through `checkModelRead`. A source that has no read fields is not readable.
 */
type Source = CompositionDocument['dataSources'][number];
type Kind = 'string' | 'number' | 'boolean';

/** Capability of the counts `home-status@1` gives. */
export const HOME_STATUS_COUNTS_CAPABILITY = 'sh.home-status-counts@1';
/** The count fields of `home-status@1`, which need `sh.home-status-counts@1`. */
export const homeStatusCountFields = ['count', 'total', 'unavailableCount'] as const;

/** The read fields of a model source and what each reads as; `undefined` when the model is not read by name (or is read some other way). */
export function modelReadFields(source: Source): Record<string, Kind> | undefined {
  if (source.kind !== 'model') return undefined;
  switch (source.model) {
    case 'power-toggle@1': return { stateText: 'string', isOn: 'boolean', phase: 'string', isError: 'boolean' };
    case 'inventory-summary@1': case 'todo-counts@1': return { stateText: 'string', phase: 'string' };
    case 'home-status@1': return { stateText: 'string', phase: 'string', state: 'string', isActive: 'boolean', count: 'number', total: 'number', unavailableCount: 'number' };
    case 'climate@1': return source.inputs.tracking ? {
      phase: 'string', selectedCount: 'number', criticalCount: 'number', occupiedOnlyCount: 'number',
      totalRooms: 'number', selectedEnabled: 'boolean', criticalEnabled: 'boolean',
    } : { phase: 'string' };
    case 'sprinkler-state@1': return {
      status: 'string', mode: 'string', phase: 'string', batteryPercent: 'number', batteryLow: 'boolean',
      fault: 'boolean', hubConnected: 'boolean', watering: 'boolean', available: 'boolean', rainDelay: 'boolean', smartWatering: 'boolean',
    };
    case 'vacuum@1': return { stateText: 'string', batteryText: 'string', phase: 'string' };
    case 'household-away-status@1': return { mode: 'string', state: 'string', phase: 'string' };
    case 'camera-stream@1': return { stateText: 'string', phase: 'string' };
    case 'alarm-mode@1': case 'security-door@1': return { phase: 'string' };
    case 'app-state@1': return appStateFields[source.inputs.topic];
    default: return undefined;
  }
}

/**
 * Checks a read of a model source by an operand or a condition leaf. `kind` is what a `read` operand asks for; a condition leaf passes none.
 * Returns the issue's code and its pointer suffix (relative to the reference), or undefined when the read is sound; `capability` names what the
 * read needs beyond the source's own.
 */
export function checkModelRead(source: Source, path: readonly string[], kind: 'string' | 'number' | 'boolean' | 'entity-id' | undefined):
  { code: CompositionIssue['code']; suffix: string } | { capability: string } | undefined {
  const at = kind === undefined ? '/path' : '/from/path';
  if (source.kind === 'model' && source.model === 'pipeline@1') {
    const found = checkPipelineRead(source.inputs, path, kind ?? 'string');
    return found ? { code: found.code, suffix: found.suffix === '/as' ? '/as' : at } : undefined;
  }
  const fields = modelReadFields(source);
  if (!fields || path.length !== 1 || !Object.hasOwn(fields, path[0])) return { code: 'invalid_reference', suffix: at };
  if (kind !== undefined && fields[path[0]] !== kind) return { code: 'binding_type', suffix: '/as' };
  return (homeStatusCountFields as readonly string[]).includes(path[0]) && source.kind === 'model' && source.model === 'home-status@1'
    ? { capability: HOME_STATUS_COUNTS_CAPABILITY } : undefined;
}
