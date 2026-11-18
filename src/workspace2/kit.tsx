import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Drawer } from '@base-ui/react/drawer';
import { Popover } from '@base-ui/react/popover';
import { ChevronLeft, X } from 'lucide-react';
import { layoutTier, type Tier } from './layout';

/** The phone tier (studio-ux2, L-wide): under 600 wide, or 500 tall or less. From 600 the wide forms of menus and dialogs apply. */
export const NARROW_QUERY = '(max-width: 599px), (max-height: 500px)';
/** Environments without `matchMedia` (a server render, a bare test DOM) are wide and never change. */
const hasMedia = () => typeof matchMedia === 'function';
const subscribe = (query: string) => (notify: () => void) => {
  if (!hasMedia()) return () => {};
  const media = matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const narrowSubscribe = subscribe(NARROW_QUERY);
/** Whether a media query matches now; a bare test DOM without `matchMedia` never matches. */
export function useMedia(query: string): boolean {
  const watch = useCallback((notify: () => void) => subscribe(query)(notify), [query]);
  return useSyncExternalStore(watch, () => hasMedia() && matchMedia(query).matches, () => false);
}
/** Whether the viewport is narrow. */
export function useNarrow(): boolean {
  return useSyncExternalStore(narrowSubscribe, () => hasMedia() && matchMedia(NARROW_QUERY).matches, () => false);
}

/** The Studio's own viewport, in px, kept current on resize. A bare test DOM reads its default window. */
export function useViewport(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(old => { const next = read(); return old.width === next.width && old.height === next.height ? old : next; });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}
/** The layout tier of the Studio's viewport. */
export function useTier(): Tier {
  const { width, height } = useViewport();
  return layoutTier(width, height);
}

/** A status pill: words always, colour as a second cue. */
export function Tag({ tone = 'neutral', children, className = '', ...rest }: { tone?: 'neutral' | 'success' | 'warning' | 'error'; children: ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`w2-tag w2-tag-${tone} ${className}`} {...rest}>{children}</span>;
}

/** A pushed page inside one surface: depth is a push with Back, never a second sheet (spec principle 4). */
export interface PushedPage { title: string; body: ReactNode; done?: ReactNode; /** Called by Back; returning false keeps the page (an editor with changes asks first). */ guard?: () => boolean }
interface PushApi { push(page: PushedPage): void; pop(): void; depth: number }
const PushContext = createContext<PushApi | undefined>(undefined);
export const usePush = () => useContext(PushContext);

/**
 * A surface body that can push pages. `root` is the page at depth 0; `rootTitle` its heading when it needs one.
 * The pushed page shows "‹ <previous title>", its own title and an optional trailing control.
 */
export function PushStack({ root, rootTitle, rootHeader, onBackAtRoot }: { root: ReactNode; rootTitle: string; rootHeader?: ReactNode; onBackAtRoot?: () => void }) {
  const [stack, setStack] = useState<PushedPage[]>([]);
  const push = useCallback((page: PushedPage) => setStack(list => [...list, page]), []);
  const pop = useCallback(() => setStack(list => list.slice(0, -1)), []);
  const top = stack.at(-1);
  const parent = stack.length > 1 ? stack[stack.length - 2].title : rootTitle;
  return <PushContext.Provider value={{ push, pop, depth: stack.length }}>
    {top ? <div className="w2-pushed">
      <header className="w2-pushed-head">
        <button type="button" className="w2-back" onClick={() => { if (top.guard?.() !== false) pop(); }}><ChevronLeft size={16} aria-hidden/>{parent}</button>
        <h2>{top.title}</h2>{top.done}
      </header>
      <div className="w2-pushed-body">{top.body}</div>
    </div> : <>{rootHeader}{root}{onBackAtRoot && null}</>}
  </PushContext.Provider>;
}

/**
 * One overlay, two frames: a popover under its trigger when wide, a bottom sheet when narrow. The trigger is rendered
 * by the caller so its look stays its own.
 */
export function Overlay({ narrow, open, onOpenChange, trigger, label, children, className = '', popupWidth, fullHeight }: {
  narrow: boolean; open: boolean; onOpenChange: (open: boolean) => void; trigger?: ReactElement; label: string; children: ReactNode; className?: string; popupWidth?: number; fullHeight?: boolean;
}) {
  if (narrow) return <Drawer.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Drawer.Trigger render={trigger}/>}
    <Drawer.Portal>
      <Drawer.Backdrop className="w2-backdrop"/>
      <Drawer.Viewport className="w2-sheet-viewport">
        <Drawer.Popup className={`w2-scope w2-sheet ${fullHeight ? 'w2-sheet-full' : ''} ${className}`} aria-label={label}>
          <div className="w2-grabber" aria-hidden/>
          <Drawer.Title className="w2-sr">{label}</Drawer.Title>
          <Drawer.Content className="w2-sheet-content">{children}</Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  </Drawer.Root>;
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Popover.Trigger render={trigger}/>}
    <Popover.Portal>
      <Popover.Positioner sideOffset={8} align="start" className="w2-positioner">
        <Popover.Popup className={`w2-scope w2-popover ${className}`} style={popupWidth ? { width: popupWidth } : undefined} aria-label={label}>
          <Popover.Title className="w2-sr">{label}</Popover.Title>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}

/** A centred dialog, 560 px wide on wide windows (spec 5.5). Title Case title; footer buttons come from the caller. */
export function Modal({ open, onOpenChange, title, children, footer, size = 'm', description, dismissable = true, initialFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children?: ReactNode; footer?: ReactNode; size?: 's' | 'm'; description?: string; dismissable?: boolean;
  /** The control that takes focus when the dialog opens (its default button); the first control otherwise. */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  return <Dialog.Root open={open} onOpenChange={(next, details) => { if (!next && !dismissable && details.reason !== 'close-press') return; onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="w2-backdrop"/>
      <Dialog.Viewport className="w2-dialog-viewport">
        <Dialog.Popup className={`w2-scope w2-dialog w2-dialog-${size}`} data-modal initialFocus={initialFocus}>
          <header className="w2-dialog-head">
            <Dialog.Title>{title}</Dialog.Title>
            {dismissable && <Dialog.Close className="w2-icon-button" aria-label="Close"><X size={18} aria-hidden/></Dialog.Close>}
          </header>
          {description && <Dialog.Description className="w2-dialog-text">{description}</Dialog.Description>}
          {children && <div className="w2-dialog-body">{children}</div>}
          {footer && <footer className="w2-dialog-foot">{footer}</footer>}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
