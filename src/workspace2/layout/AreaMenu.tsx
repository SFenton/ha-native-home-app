import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import type { SelectionKey } from '../../preview2/model';
import type { Workspace2 } from '../useWorkspace2';
import { areaAt, duplicateArea, moveArea, removeAreaAt } from './areaOps';

/** The commands of an area: Move Up, Move Down, Duplicate and Remove Area. One list for the ••• button and the context menu. */
export function AreaMenuItems({ ws, areaKey, onError }: { ws: Workspace2; areaKey: SelectionKey; onError: (message: string) => void }) {
  const document = ws.document!, at = areaAt(document, ws.index!, areaKey);
  if (!at) return null;
  const run = (change: () => void) => { try { change(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const shipped = !at.node.blocks;
  return <>
    <Menu.Item className="w2-menu-item" disabled={at.position === 0} onClick={() => run(() => ws.studio.apply(moveArea(document, at, -1)))}>Move Up</Menu.Item>
    <Menu.Item className="w2-menu-item" disabled={at.position >= at.areas.length - 1} onClick={() => run(() => ws.studio.apply(moveArea(document, at, 1)))}>Move Down</Menu.Item>
    <Menu.Item className="w2-menu-item" onClick={() => run(() => ws.studio.apply(duplicateArea(document, at).document))}>Duplicate</Menu.Item>
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item" disabled={shipped} onClick={() => run(() => ws.studio.apply(removeAreaAt(document, at)))}>Remove Area</Menu.Item>
  </>;
}

/** The ••• button of an area row. */
export function AreaMenu({ ws, areaKey, title, onError }: { ws: Workspace2; areaKey: SelectionKey; title: string; onError: (message: string) => void }) {
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label={`More for ${title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu"><AreaMenuItems ws={ws} areaKey={areaKey} onError={onError}/></Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
