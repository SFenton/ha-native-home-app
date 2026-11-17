/** The words and look of the alert the app shows before an action that asks first. */
export interface AlertSpec {
  title: string;
  message?: string;
  confirmLabel: string;
  /** The contract fixes it: the app always says Cancel. */
  cancelLabel: string;
  /** The confirm button is drawn in the system red. */
  destructive: boolean;
}

/** The alert an action's confirmation asks for; `policy` leaves the decision to the app and shows none. */
export function alertOf(confirmation: { type: string; title?: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean } | undefined): AlertSpec | undefined {
  if (!confirmation || confirmation.type !== 'additional') return undefined;
  return { title: confirmation.title ?? '', message: confirmation.message || undefined, confirmLabel: confirmation.confirmLabel ?? '', cancelLabel: confirmation.cancelLabel ?? 'Cancel', destructive: Boolean(confirmation.destructive) };
}
