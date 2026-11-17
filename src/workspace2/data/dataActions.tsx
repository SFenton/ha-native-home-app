import { createContext, useContext } from 'react';

/** What the inspector's List rows need from the workspace that the rows' context does not carry: opening a Data Flow in the inspector. */
export interface DataActions { openFlow: (id: string | undefined) => void }
const Actions = createContext<DataActions>({ openFlow: () => {} });
/** Provides the actions below the properties panel. */
export const DataActionsProvider = Actions.Provider;
/** The workspace's Data actions. */
export const useDataActions = () => useContext(Actions);
