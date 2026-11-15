import { createContext, useContext } from 'react';
import type { CompositionAction } from '../shared/composition/schema';
import type { LocalField, LocalValue } from '../shared/composition/shell';
import type { Json } from '../shared/types';
import type { Environment } from './evaluate';
import type { House, Overlay } from './projections';
import type { SelectionStore } from './selection-store';

/** What every drawn node reads. Its identity changes with the house, the overlay and the mode, never with a node edit. */
export interface RenderContext {
  mode: 'edit' | 'use';
  env: Environment;
  house: House;
  overlay: Overlay;
  /** The declared local field, if any. */
  field(stateId: string): LocalField | undefined;
  /** The current value of a local field: the overlay's write, else its initial value. */
  local(stateId: string): LocalValue | undefined;
  /** Runs an action in Use mode; a no-op in Edit. `control` is the new value of the control that sent it. */
  run(action: CompositionAction, control?: Json): void;
  store: SelectionStore;
  /** The last answer of each node's rule, so `keep` repeats it while the data is unknown. */
  previous: Map<string, boolean>;
}

export const RenderCtx = createContext<RenderContext | undefined>(undefined);
/** The context of the nearest Preview2. */
export function useRender(): RenderContext {
  const value = useContext(RenderCtx);
  if (!value) throw new Error('A preview node rendered outside Preview2.');
  return value;
}
