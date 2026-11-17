import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Operand } from '../../shared/composition/expression';
import type { Shape } from '../../shared/composition/pipeline';
import type { ValueKind } from '../expr/condition';
import { itemFields, kindWords } from './flow';

/**
 * What a flow's value picker and condition editor may name (studio-ux2, L-data "Steps that use the two fields"): the fields of the item a step looks at,
 * the flow's inputs (its parameters), and Today and Now. A step cannot read an entity or the person, so the picker offers none of those inside a flow.
 */
export interface FlowScope {
  /** The shape of the data arriving at the step; its item's fields are "This Item's Fields". */
  item?: Shape;
  /** The flow's declared inputs. */
  params: readonly { name: string; type: 'string' | 'number' | 'boolean' | 'entity-id' }[];
}
const Scope = createContext<FlowScope | undefined>(undefined);
/** Provides the scope of the step being edited to the fields below. */
export function FlowScopeProvider({ item, params, children }: { item?: Shape; params: FlowScope['params']; children: ReactNode }) {
  const value = useMemo(() => ({ item, params }), [item, params]);
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}
/** The flow scope the field is inside, if any. */
export const useFlowScope = (): FlowScope | undefined => useContext(Scope);

const valueKind = (shape: Shape): ValueKind => {
  const { kind } = kindWords(shape);
  return kind === 'Number' ? 'number' : kind === 'Yes or No' ? 'yesno' : kind === 'Date' || kind === 'Date and Time' ? 'date' : 'text';
};

/** One field of the item, as the picker lists it: its name, the kind in words, its values when there are 8 or fewer, and whether some items lack it. */
export interface ItemFieldInfo { name: string; kind: ValueKind; words: string; values?: string[]; optional: boolean }
/** The fields of the item a scope looks at. */
export function itemFieldInfos(scope: FlowScope | undefined): ItemFieldInfo[] {
  if (!scope?.item) return [];
  return itemFields(scope.item).map(field => {
    const words = kindWords(field.shape);
    return { name: field.name, kind: valueKind(field.shape), words: words.kind, values: words.values, optional: field.optional };
  });
}
/** What one `item` operand reads, in the scope: its kind and its values. */
export function itemInfoOf(scope: FlowScope | undefined, operand: Operand): ItemFieldInfo | undefined {
  return operand.type === 'item' && operand.path.length === 1 ? itemFieldInfos(scope).find(info => info.name === operand.path[0]) : undefined;
}
