import { Toast } from '@base-ui/react/toast';

/** One manager for the workspace. Toasts are for Published, Rolled back, Imported and Copied only (spec 9). */
export const toastManager = Toast.createToastManager();

function List() {
  const { toasts } = Toast.useToastManager();
  return <>{toasts.map(toast => <Toast.Root key={toast.id} toast={toast} className="w2-toast"><Toast.Content><Toast.Title className="w2-toast-title"/></Toast.Content></Toast.Root>)}</>;
}

/** The viewport: bottom centre over the content, never taking layout space, one at a time for 4 s. */
export function ToastHost({ children }: { children?: React.ReactNode }) {
  return <Toast.Provider toastManager={toastManager} limit={1} timeout={4000}>
    {children}
    <Toast.Portal><Toast.Viewport className="w2-scope w2-toast-viewport"><List/></Toast.Viewport></Toast.Portal>
  </Toast.Provider>;
}
