import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { DerivedTheme } from '../theme';
import { canvasTheme } from './theme';

export default function CanvasDialog({ title, children, close, theme, sheet = false, wide = false, focusHeading = false, returnFocus }: {
  title: string; children: ReactNode; close: () => void; theme: DerivedTheme; sheet?: boolean; wide?: boolean; focusHeading?: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Backdrop className="w2-canvas-backdrop"/><Dialog.Viewport className="w2-canvas-dialog-viewport" data-sheet={sheet || undefined}>
      <Dialog.Popup className="w2-canvas-dialog" data-sheet={sheet || undefined} data-wide={wide || undefined}
        style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties}
        initialFocus={focusHeading ? heading : undefined}
        finalFocus={returnFocus ?? false}>
        <div className="w2-canvas-panel-head"><Dialog.Title ref={heading} tabIndex={-1}>{title}</Dialog.Title><button type="button" aria-label={`Close ${title}`} onClick={close}><X size={18}/></button></div>
        <div className="w2-canvas-dialog-body">{children}</div>
      </Dialog.Popup>
    </Dialog.Viewport></Dialog.Portal>
  </Dialog.Root>;
}
