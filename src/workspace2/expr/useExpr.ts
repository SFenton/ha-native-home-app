import { useMemo } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Environment } from '../../shared/composition/evaluator';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import type { LogicEntry } from '../../shared/composition/logic-library';
import { wallClock } from '../../preview2/clock';
import { environmentFor } from './useTryValues';
import type { NameContext } from './condition';
import { registerFill } from '../data/logic/logicEval';
import { useLogicScope } from '../data/logic/logicScope';
import { resolvedLogicValue } from '../logic-fields/templates';

/** What naming a source needs, for the document an editor shows (its draft, which may hold sources the saved document lacks). */
export function useNameContext(document: Pick<CompositionDocument, 'dataSources'>): NameContext {
  const { entities, connected } = useWorkspaceData();
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const scope = useLogicScope();
  const library = (document as { logicLibrary?: LogicEntry[] }).logicLibrary;
  const logic = useMemo(() => library ? { library, settings: scope ? library.find(entry => entry.id === scope.entryId)?.params : undefined,
    resolve: (value: unknown) => resolvedLogicValue(document, value) } : undefined, [document, library, scope]);
  return useMemo(() => ({ document, logic, entityName: id => names.get(id), entityExists: connected ? (id: string) => names.has(id) : undefined }), [document, logic, names, connected]);
}

/** The evaluation environment of an editor's draft: the house, the overlay and Try Values. Undefined before the workspace has a house. */
export function useDraftEnvironment(document: Pick<CompositionDocument, 'dataSources'>): Environment | undefined {
  const { house, overlay, tried } = useWorkspaceData();
  // The clock is read when the environment is built: an editor shows what the value is now, and the preview is what ticks.
  const scope = useLogicScope();
  const library = (document as { logicLibrary?: LogicEntry[] }).logicLibrary;
  return useMemo(() => {
    if (!house) return undefined;
    const env = environmentFor(document, house, overlay, tried, wallClock());
    const own = scope ? library?.find(entry => entry.id === scope.entryId) : undefined;
    return registerFill(env, library ? { library, samples: own ? Object.fromEntries(own.params.map(param => [param.name, param.sample])) : undefined,
      resolve: (value: unknown) => resolvedLogicValue(document, value) } : undefined);
  }, [document, house, overlay, tried, library, scope]);
}
/** The data tag of a result: Live when connected, Demo when not, Test while a Try Values override is set. */
export function useDataTag(): 'Live' | 'Demo' | 'Test' {
  const { connected, tried } = useWorkspaceData();
  return tried.count ? 'Test' : connected ? 'Live' : 'Demo';
}
