import { createContext, useContext } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';

/** Everything a row needs to read and change the document. */
export interface RowsContext {
  document: CompositionDocument;
  onChange: (document: CompositionDocument) => void;
  onError: (message: string) => void;
  /** Test hook: render every disclosure open so a walk can find every field. */
  openAll?: boolean;
}
/** The rows' context. Read it with {@link useRows}; a disclosure reads it softly, so it also draws outside a provider. */
export const Rows = createContext<RowsContext | undefined>(undefined);
/** Provides the document and its setters to the rows below. */
export const RowsProvider = Rows.Provider;
/** The document and its setters; throws outside a {@link RowsProvider}. */
export function useRows(): RowsContext {
  const value = useContext(Rows);
  if (!value) throw new Error('Rows need a RowsProvider');
  return value;
}
