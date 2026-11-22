import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import type { SelectionKey } from '../preview2/model';
import RowGlyph from './RowGlyph';
import { Tag } from './kit';
import LinkedTag from './LinkedTag';

/** One drawn row of the library's tree. */
export interface TreeItem {
  key: SelectionKey;
  title: string;
  icon?: string;
  /** The node type, or `tab`, `page`, `sheet`, `modal` for a top-level row; picks the glyph when the row has no icon. */
  type: string;
  tags: readonly string[];
  /** How many children a container holds. */
  count: number;
  container: boolean;
  /** Indent levels opened in place. */
  depth: number;
  open: boolean;
  /** A top-level row (tab, page, sheet or modal) rather than a node. */
  root: boolean;
  /** What the handle moves: a node in its list, a tab in the bar, or nothing. */
  movable: 'node' | 'tab' | 'area' | false;
  hasMenu: boolean;
  /** The icon the person chose for this row in the Studio (L-icons); it comes before the node's own icon and the type's glyph. */
  chosen?: string;
  /** An area none of whose tabs is the one the simulator shows: its title is muted (never dimmed; the row stays usable). */
  muted?: boolean;
  /** A level's row with a note: the title alone on line 1, then the tags and the note, wrapping only when they do not fit (so up to three lines). Without a note it is the standard one-line row. */
  stacked?: boolean;
  /** The note on a stacked row, after its tags: a level's "Needs a newer app" while the app has not shipped levels. */
  note?: string;
  /** The sheet a level's row hangs from: the row's name says it is a level of it ("Demo Room 1, level of Lights"). */
  levelOf?: string;
  /** A place that uses a saved component: the row carries the link tag, and its accessible name says so. */
  linked?: { places: number };
}

/** What a row needs from the tree. */
export interface RowProps {
  item: TreeItem;
  /** The row is the selection. */
  selected: boolean;
  /** The row's surface is the one on show (top-level rows only). */
  shown: boolean;
  /** The one row that is a tab stop; it also shows its More and handle to the keyboard. */
  active: boolean;
  /** Whether the list has a handle column at all (a list nothing can reorder has none). */
  handleColumn: boolean;
  /** Use mode: the handle stays in place, disabled; More stays too, with the one command that leaves the document alone. */
  use: boolean;
  /** The More control: a menu (in Use, one with only Change List Icon…). */
  more: ReactNode;
  /** A slot after the tags for what a row shows about its element (a component badge); nothing by default. */
  badge?: ReactNode;
  onActivate: (event: MouseEvent | KeyboardEvent) => void;
  onToggle: (event: MouseEvent) => void;
  onHandleDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandleKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onContext: (event: MouseEvent | KeyboardEvent) => void;
}

/**
 * A row (studio-ux2 lib3, L-tree), left to right: disclosure, icon, title, tags, badge, count, More, handle. The handle is the outermost
 * control, so the grips form one column at the trailing edge. A top-level row opens in place and a child row goes in (the tree decides);
 * the triangle toggles it. `role="treeitem"` with `aria-level`, and `aria-expanded` on a container.
 */
export default function LibraryRow({ item, selected, shown, active, handleColumn, use, more, badge, onActivate, onToggle, onHandleDown, onHandleKey, onContext }: RowProps) {
  const label = item.open ? `Hide what is in ${item.title}` : `Show what is in ${item.title}`;
  return <div role="treeitem" className="w2-tree-row" data-row={item.key} data-open={item.open || undefined} data-selected={selected || undefined} data-muted={item.muted || undefined} data-stacked={(item.stacked && item.note) || undefined}
    aria-label={item.linked ? `${item.title}, linked template, used in ${item.linked.places} ${item.linked.places === 1 ? 'place' : 'places'}` : item.levelOf ? `${item.title}, level of ${item.levelOf}` : undefined}
    aria-level={item.depth + 1} aria-expanded={item.container ? item.open : undefined} aria-current={shown ? 'page' : selected ? 'true' : undefined}
    tabIndex={active ? 0 : -1} data-active={active || undefined} style={{ paddingInlineStart: 6 + item.depth * 16 }} title={item.title}
    onClick={onActivate} onContextMenu={onContext} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter') { event.preventDefault(); onActivate(event); }
      else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); onContext(event); }
    }}>
    <span className="w2-tree-slot">{item.container && <button type="button" tabIndex={-1} className="w2-tree-disclosure" aria-label={label} aria-expanded={item.open} onClick={onToggle}><span aria-hidden className="w2-tree-triangle"/></button>}</span>
    <span className="w2-tree-icon" data-chosen={item.chosen ? '' : undefined}><RowGlyph icon={item.chosen ?? item.icon} type={item.type}/></span>
    {item.stacked && item.note
      // The title has the first line to itself; the tags, then the note, follow and wrap only when they do not fit. A whole title matters more than a shorter row in a narrow list.
      ? <span className="w2-tree-text"><span className="w2-tree-title">{item.title}</span>
        <span className="w2-tree-sub">{item.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}<span className="w2-tree-path">{item.note}</span></span></span>
      : <><span className="w2-tree-title">{item.title}</span>{item.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}</>}
    {item.linked && <LinkedTag/>}
    {badge}
    {item.container && <span className="w2-tree-count">{item.count}</span>}
    <span className="w2-tree-more" data-quiet={!active || undefined} onClick={event => event.stopPropagation()}>{item.hasMenu ? more : null}</span>
    {handleColumn && <span className="w2-tree-handle-slot">{item.movable && <button type="button" className="w2-tree-handle" tabIndex={active ? 0 : -1} disabled={use} aria-label={`Move ${item.title}`} title={use ? 'Switch to Edit to move this.' : 'Move'}
      onClick={event => event.stopPropagation()} onPointerDown={onHandleDown} onKeyDown={onHandleKey} data-base-ui-swipe-ignore><GripVertical size={16} aria-hidden/></button>}</span>}
  </div>;
}
