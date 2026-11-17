import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Shape } from '../../shared/composition/pipeline';
import type { DocumentIndex, SelectionKey } from '../../preview2/model';
import { flowById } from './flow';

/**
 * What a value in a cell of a repeat may name beyond the page's own (`sh.repeat@1`): the fields of the record the repeat draws and its position. The first child of the
 * repeat has the record; the placeholder (the second child) has the position only. Absent outside a repeat, where neither exists.
 */
export interface RepeatScope {
  /** The shape of one record of the repeat's flow; absent in the placeholder or when the flow is not found. */
  item?: Shape;
}
const Scope = createContext<RepeatScope | undefined>(undefined);
/** Provides the repeat scope to the fields below. */
export function RepeatScopeProvider({ scope, children }: { scope?: RepeatScope; children: ReactNode }) {
  const value = useMemo(() => scope, [scope?.item]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}
/** The repeat scope the field is inside, if any. */
export const useRepeatScope = (): RepeatScope | undefined => useContext(Scope);

/** The scope of the node at `key`: set when the nearest repeat above it holds it, with the record's shape when it is inside the first child. */
export function repeatScopeOf(document: CompositionDocument, index: DocumentIndex, key: SelectionKey): RepeatScope | undefined {
  const chain = index.ancestors(key);
  for (let at = chain.length - 1; at >= 0; at -= 1) {
    const entry = index.get(chain[at]);
    if (entry?.node?.type !== 'repeat') continue;
    const own = index.get(key)?.path;
    if (!own || !entry.path || own.length <= entry.path.length + 1 || own[entry.path.length] !== 'children') return { item: undefined };
    const child = Number(own[entry.path.length + 1]);
    if (child !== 0) return {};
    const flow = flowById(document, entry.node.props.providerId);
    const schema = flow?.inputs.schema;
    return { item: schema && schema.kind === 'array' ? schema.of : undefined };
  }
  return undefined;
}
