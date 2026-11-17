import { createContext, useContext } from 'react';
import type { AlertSpec } from '../../preview2/alert';

/** Sets the alert the simulator draws as a preview, or clears it. Absent where no simulator is beside the editor. */
export const AlertPreviewContext = createContext<((alert: AlertSpec | undefined) => void) | undefined>(undefined);
/** The setter for the simulator's alert preview. */
export const useAlertPreview = () => useContext(AlertPreviewContext);
