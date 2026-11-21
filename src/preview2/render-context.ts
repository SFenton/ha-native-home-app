import { createContext, useContext } from 'react';
import type { CompositionActionSlot, CompositionDocument } from '../shared/composition/schema';
import type { LocalField, LocalValue } from '../shared/composition/shell';
import type { Json } from '../shared/types';
import type { Environment } from './evaluate';
import type { House, Overlay } from './projections';
import type { SelectionStore } from './selection-store';
import type { StateStyleLibrary } from '../shared/composition/state-styles';
import type { AlertSpec } from './alert';
import { useLiveRender } from './live-binding';
import type { LiveHouse } from './live-house';
import type { WindowFold } from './fold';
import type { ItemScope, UseRecords } from './flow-records';

/** A state the Studio forces on one state tile while it is selected: a state of the style, or a phase of the tap that follows. */
export interface StatePreview { nodeId: string; state: string; phase?: 'sending' | 'failed' }

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
  /** Runs an action in Use mode; a no-op in Edit. `control` is the new value of the control that sent it; `scope` is the cell of a repeat the action is in; `sender` is the leading column of a split, so a push from it cuts the trailing column first. */
  run(action: CompositionActionSlot, control?: Json, scope?: ItemScope, controlValues?: Record<string, Json>, sender?: string): void;
  store: SelectionStore;
  /** The document's state style library, which `state-tile` nodes apply by id. */
  stateStyles?: StateStyleLibrary;
  /** The document's sources as authored, for what a node draws from a source's own settings even while its data is loading (a map's flips). */
  sources?: CompositionDocument['dataSources'];
  /** The state forced on a state tile in Edit (the States group's "Show state"). */
  statePreview?: StatePreview;
  /** Shows an alert in Use and runs `then` when the person confirms. */
  ask?(alert: AlertSpec, then: () => void): void;
  /** Reports a simulated call, for the Studio's note under the preview. */
  note?(summary: string): void;
  /** The last answer of each node's rule, so `keep` repeats it while the data is unknown. */
  previous: Map<string, boolean>;
  /** What each slot last showed (by node and slot), so a value that is `loading` keeps it rather than blanking (`sh.rules@1`). */
  kept?: Map<string, unknown>;
  /** The Studio's Appearance setting when the author chose Light or Dark: the scheme a `system` sheet is drawn in. Absent when the Studio follows the system (the browser decides). */
  appearance?: 'light' | 'dark';
  /** Set when the window draws the tabs at the top, in the navigation bar's row (the iPad): the app draws no menu button there. */
  topTabs?: boolean;
  /** The navigation flyout in a window that keeps its tab bar (the iPhone): the header's `shell-menu` button toggles it. */
  menu?: { open: boolean; toggle(): void };
  /**
   * Set when the system draws the bars on the trailing vertical edge (the Duo's rail): no menu button, the page title is the fixed
   * inline title in the header row, and the trailing header items (Quick Links, Profile) sit in the rail (`ShellChrome.resolve(inVerticalBar:)`).
   */
  verticalBar?: boolean;
  /**
   * Set when the house is a live store. A node that reads `house` or `env` through `useRender` then hears only the entities it
   * read (`useLiveRender`); the context's own `house` and `env` do not change with an entity.
   */
  live?: { store: LiveHouse; dataSources: CompositionDocument['dataSources'] };
  /**
   * Reads a map camera's picture (`camera.<vacuum map id>_map_data`) as PNG bytes through the Studio's own server, never from a
   * browser to Home Assistant. Absent when the Studio is not connected to Home Assistant: a map then draws as a schematic.
   */
  mapPicture?(cameraEntityId: string, signal: AbortSignal): Promise<ArrayBuffer | undefined>;
  /** Whether the simulator's text size is one of the largest, where a tab bar becomes a menu of titles (`ModalTabBar`). */
  largeText?: boolean;
  /** The simulated text size, as a fraction of the app's default; a paged repeat counts its page by it. */
  textScale?: number;
  /** The flows a repeat draws from (`sh.repeat@1`): every source the nodes read, and the host's hook that runs one. Absent where nothing runs flows. */
  records?: { sources: CompositionDocument['dataSources']; use: UseRecords };
  /** Set inside a cell of a repeat: the record and position that `item` and `index` read, kept when a live render rebuilds the environment. */
  scope?: ItemScope;
  /** The window's fold (`WindowFold`): grids that follow it read the hinge band and the pose. Absent outside a Screen. */
  fold?: WindowFold;
}

export const RenderCtx = createContext<RenderContext | undefined>(undefined);
/** The context of the nearest Preview2. */
export function useRender(): RenderContext {
  const value = useContext(RenderCtx);
  if (!value) throw new Error('A preview node rendered outside Preview2.');
  return useLiveRender(value);
}
