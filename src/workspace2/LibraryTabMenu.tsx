import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import type { SelectionKey } from '../preview2/model';
import { ChangeListIconItem } from './ListIconPicker';
import type { Workspace2 } from './useWorkspace2';

/** The items of a tab row's menu: Tab Settings (the Tabs panel on this tab), Page Settings (its page's), Move Up and Move Down in the tab bar. */
export function TabMenuItems({ ws, tabKey, at, count, onMove }: { ws: Workspace2; tabKey: SelectionKey; at: number; count: number; onMove: (key: SelectionKey, to: number) => void }) {
  const pageId = ws.document?.navigation.tabs[at]?.pageId, pageKey = pageId ? `page:${pageId}` as SelectionKey : undefined;
  return <>
    <Menu.Item className="w2-menu-item" onClick={() => ws.select(tabKey)}>Tab Settings</Menu.Item>
    {pageKey && <Menu.Item className="w2-menu-item" onClick={() => ws.selectAnywhere(pageKey)}>Page Settings</Menu.Item>}
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item" disabled={at <= 0} onClick={() => onMove(tabKey, at - 1)}>Move Up</Menu.Item>
    <Menu.Item className="w2-menu-item" disabled={at >= count - 1} onClick={() => onMove(tabKey, at + 1)}>Move Down</Menu.Item>
    <ChangeListIconItem rowKey={tabKey}/>
  </>;
}

/** A tab row's More button and its menu. */
export function TabMenu({ ws, tabKey, title, at, count, onMove }: { ws: Workspace2; tabKey: SelectionKey; title: string; at: number; count: number; onMove: (key: SelectionKey, to: number) => void }) {
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label={`More for ${title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <TabMenuItems ws={ws} tabKey={tabKey} at={at} count={count} onMove={onMove}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
