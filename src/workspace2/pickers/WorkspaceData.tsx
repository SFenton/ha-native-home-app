import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { House } from '../../preview2/projections';
import type { LiveHouse } from '../../preview2/live-house';
import type { Environment } from '../../preview2/evaluate';
import type { Overlay } from '../../preview2/projections';
import { noTries, type TryApi } from '../expr/useTryValues';
import { rowsFromDocument, rowsFromStates, type EntityRow } from './entities';

/** What a creation flow made: its id, and the document as it stands with the new page or sheet in it. */
export interface Made { id: string; document: CompositionDocument }
/** Starts a creation flow and calls `done` with what it made (not called when the person cancels). Absent, the picker row is hidden. */
export type CreateFlow = (done: (made: Made) => void) => void;

/** What the pickers and editors read besides the document: the entities Home Assistant has and the creation flows. */
export interface WorkspaceData {
  /** Every entity Home Assistant has (or, offline, the ones the document names), sorted by name. */
  entities: readonly EntityRow[];
  /** Whether the list is Home Assistant's own. */
  connected: boolean;
  onCreatePage?: CreateFlow;
  onCreateSheet?: CreateFlow;
  /** The house the preview reads, for "Shown now" and "Hidden now" in the rule editor. */
  environment?: Environment;
  /** The house and overlay the preview reads, so an editor can evaluate its own draft (which may hold sources the document lacks). */
  house?: House;
  overlay?: Overlay;
  /** The house's store, which a reader subscribes to hear one entity change (the `house` map is mutated in place and never changes identity). */
  live?: LiveHouse;
  /** Try Values: the overrides the open editor applies to the simulator and its result lines. */
  tried: TryApi;
}
const Data = createContext<WorkspaceData>({ entities: [], connected: false, tried: noTries });
/** The data the pickers read. */
export const useWorkspaceData = () => useContext(Data);

/** Provides {@link WorkspaceData} from the house the preview already reads, so there is no second request. */
export function WorkspaceDataProvider({ document, house, live: store, environment, overlay, tried = noTries, onCreatePage, onCreateSheet, children }: { document: CompositionDocument | undefined; house: House; live?: LiveHouse; environment?: Environment; overlay?: Overlay; tried?: TryApi; onCreatePage?: CreateFlow; onCreateSheet?: CreateFlow; children: ReactNode }) {
  const states = house.states;
  // Offline, the entities come from walking the document. Nothing needs them while a field is typed into, so they are read on
  // demand and kept for the document they were read from.
  const latest = useRef(document);
  latest.current = document;
  const value = useMemo<WorkspaceData>(() => {
    const live = Boolean(states && states.size > 0);
    const cache: { for?: CompositionDocument; rows?: EntityRow[] } = {};
    const liveRows = live ? rowsFromStates(states!.values()) : undefined;
    return {
      get entities() {
        if (liveRows) return liveRows;
        const current = latest.current;
        if (!current) return [];
        if (cache.for !== current) { cache.for = current; cache.rows = rowsFromDocument(current); }
        return cache.rows!;
      },
      connected: live, onCreatePage, onCreateSheet, environment, house, live: store, overlay, tried,
    };
  }, [states, house, store, onCreatePage, onCreateSheet, environment, overlay, tried]);
  return <Data.Provider value={value}>{children}</Data.Provider>;
}
