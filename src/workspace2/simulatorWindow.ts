import { createContext, useContext } from 'react';
import type { PreviewWindow } from '../preview2';

/** The simulator's window and the one way to move it, for an inspector row that says "show me this" (`Show Partly Folded`). */
export interface SimulatorWindow {
  window: PreviewWindow;
  /** Moves the simulator, as the rail does: the rig animates the move on its own token. */
  move(next: PreviewWindow): void;
}

/** Provided by the workspace; absent outside it (a bare form), where the row shows no link. */
export const SimulatorWindowContext = createContext<SimulatorWindow | undefined>(undefined);
/** The simulator's window and its mover. */
export const useSimulatorWindow = (): SimulatorWindow | undefined => useContext(SimulatorWindowContext);
