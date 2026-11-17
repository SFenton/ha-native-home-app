import { createContext } from 'react';
import type { GridLine } from './useFoldedGrid';

/** The grid lines each child of a measured grid takes once short rows are filled and the band is kept clear, by node id; absent until the grid is measured. */
export const GridPlacement = createContext<ReadonlyMap<string, GridLine> | undefined>(undefined);
