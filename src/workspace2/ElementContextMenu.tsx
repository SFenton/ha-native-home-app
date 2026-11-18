import { useEffect, useMemo, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { selectionKeyAt } from '../preview2/SelectionLayer';
import type { SelectionKey } from '../preview2/model';
import { NodeMenuItems } from './PropertiesPanel';
import { visibleCopy } from '../preview2/twin-scroll';
import type { Workspace2 } from './useWorkspace2';

/** Where the menu opened and for which element. */
interface Opened { key: SelectionKey; x: number; y: number }

/**
 * The right-click menu on the simulator. In Edit, a right-click (or Control-click on a Mac) on an element selects it and opens
 * the element's More menu, the same items as its ••• button, at the pointer; Shift+F10 or the Menu key does the same for the
 * selected element, at its top leading corner. Use leaves the browser's own menu alone, and so does a click that is not on a
 * node (a page, a tab, a handle or a passthrough control).
 */
export default function ElementContextMenu({ ws, stage, onError }: { ws: Workspace2; stage: HTMLElement | null; onError: (message: string) => void }) {
  const [opened, setOpened] = useState<Opened>();
  const editing = ws.mode === 'edit';
  const { select, index } = ws;
  useEffect(() => {
    if (!stage || !editing) { setOpened(undefined); return; }
    const isNode = (key: SelectionKey | undefined): key is SelectionKey => Boolean(key?.startsWith('node:') && index?.get(key)?.node);
    const contextmenu = (event: MouseEvent) => {
      // A touch long press also raises contextmenu; it belongs to the touch drag, so only a mouse or pen opens the menu.
      if ((event as PointerEvent).pointerType === 'touch') return;
      if (event.target instanceof Element && event.target.closest('.sh-handle-slot, [data-passthrough]')) return;
      const key = selectionKeyAt(event.target);
      if (!isNode(key)) return;
      event.preventDefault();
      select(key);
      setOpened({ key, x: event.clientX, y: event.clientY });
    };
    const keydown = (event: KeyboardEvent) => {
      if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return;
      const key = ws.target?.kind === 'node' ? ws.target.key : undefined;
      if (!isNode(key)) return;
      const element = visibleCopy([...stage.querySelectorAll<HTMLElement>('[data-sel]')].filter(item => item.getAttribute('data-sel') === key));
      if (!element) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      setOpened({ key, x: box.left + 8, y: box.top + 8 });
    };
    stage.addEventListener('contextmenu', contextmenu, true);
    stage.addEventListener('keydown', keydown);
    return () => { stage.removeEventListener('contextmenu', contextmenu, true); stage.removeEventListener('keydown', keydown); };
  }, [stage, editing, select, index, ws.target]);
  const anchor = useMemo(() => opened ? { getBoundingClientRect: () => new DOMRect(opened.x, opened.y, 0, 0) } : undefined, [opened]);
  const entry = opened ? index?.get(opened.key) : undefined;
  if (!opened || !entry?.node || !ws.document || !anchor) return null;
  return <Menu.Root open onOpenChange={open => { if (!open) setOpened(undefined); }}>
    <Menu.Portal><Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" data-testid="element-menu" aria-label={`${entry.node.title} menu`}>
      <NodeMenuItems ws={ws} path={entry.path} selectionKey={opened.key} onError={onError}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
