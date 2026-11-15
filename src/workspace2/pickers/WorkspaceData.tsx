import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { House } from '../../preview2/projections';
import { rowsFromDocument, rowsFromStates, type EntityRow } from './entities';

/** Starts a creation flow and calls `done` with the id it made. Supplied by the navigation lane; absent, the picker row is hidden. */
export type CreateFlow = (done: (id: string) => void) => void;

/** What the pickers and editors read besides the document: the entities Home Assistant has and the creation flows. */
export interface WorkspaceData {
  /** Every entity Home Assistant has (or, offline, the ones the document names), sorted by name. */
  entities: readonly EntityRow[];
  /** Whether the list is Home Assistant's own. */
  connected: boolean;
  onCreatePage?: CreateFlow;
  onCreateSheet?: CreateFlow;
}
const Data = createContext<WorkspaceData>({ entities: [], connected: false });
/** The data the pickers read. */
export const useWorkspaceData = () => useContext(Data);

/** Provides {@link WorkspaceData} from the house the preview already reads, so there is no second request. */
export function WorkspaceDataProvider({ document, house, onCreatePage, onCreateSheet, children }: { document: CompositionDocument | undefined; house: House; onCreatePage?: CreateFlow; onCreateSheet?: CreateFlow; children: ReactNode }) {
  const states = house.states;
  const value = useMemo<WorkspaceData>(() => {
    const live = states && states.size > 0;
    return { entities: live ? rowsFromStates(states.values()) : document ? rowsFromDocument(document) : [], connected: Boolean(live), onCreatePage, onCreateSheet };
  }, [states, document, onCreatePage, onCreateSheet]);
  return <Data.Provider value={value}>{children}</Data.Provider>;
}
