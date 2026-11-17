import { useMemo } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Environment } from '../../shared/composition/evaluator';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { environmentFor } from './useTryValues';
import type { NameContext } from './condition';

/** What naming a source needs, for the document an editor shows (its draft, which may hold sources the saved document lacks). */
export function useNameContext(document: Pick<CompositionDocument, 'dataSources'>): NameContext {
  const { entities, connected } = useWorkspaceData();
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  return useMemo(() => ({ document, entityName: id => names.get(id), entityExists: connected ? (id: string) => names.has(id) : undefined }), [document, names, connected]);
}

/** The evaluation environment of an editor's draft: the house, the overlay and Try Values. Undefined before the workspace has a house. */
export function useDraftEnvironment(document: Pick<CompositionDocument, 'dataSources'>): Environment | undefined {
  const { house, overlay, tried } = useWorkspaceData();
  return useMemo(() => house ? environmentFor(document, house, overlay, tried) : undefined, [document, house, overlay, tried]);
}
/** The data tag of a result: Live when connected, Demo when not, Test while a Try Values override is set. */
export function useDataTag(): 'Live' | 'Demo' | 'Test' {
  const { connected, tried } = useWorkspaceData();
  return tried.count ? 'Test' : connected ? 'Live' : 'Demo';
}
