import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RepeatClass } from '../../shared/composition/repeats';
import RowGlyph from '../RowGlyph';
import type { Workspace2 } from '../useWorkspace2';
import { pieceText, placesText } from './repeatWords';

/** The words of the first line while the walk has no answer yet. */
export const WORKING_TEXT = 'Looking for repeated pieces…';
/** The empty level (templates spec: "Nothing found"). */
export const EMPTY_TITLE = 'Nothing found';
export const EMPTY_TEXT = 'Nothing repeats yet. A tile that appears twice, or a piece of 3 or more parts that appears twice, shows here.';

/** The group headers of the level. */
export const GROUPS_TITLE = 'Groups';
export const TILES_TITLE = 'Single Tiles';

/**
 * The rows of Repeated Pieces, shared by the library level and the phone sheet: 48 px (56 on touch), the glyph of the piece's type, what it
 * is and holds ("Tile grid, 3 tiles") and how many places ("14 places"). Two groups: Groups (pieces of 3 or more parts) and Single Tiles (a tile that
 * appears twice or more, "Door tile", "2 places"). The lists take the arrow keys as one tab stop (Up and Down, Home and End).
 * While the walk runs with no answer yet it says so; when it finds nothing it says that.
 */
export default function RepeatsList({ ws, query, onPick }: { ws: Workspace2; query: string; onPick: (cls: RepeatClass, row: HTMLElement) => void }) {
  const { result, status, selected } = ws.repeats;
  const document = ws.document;
  const [stop, setStop] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => document && result ? result.classes.map(cls => ({ cls, name: pieceText(document, cls) })) : [], [document, result]);
  const tiles = useMemo(() => document && result ? result.tiles.map(cls => ({ cls, name: pieceText(document, cls) })) : [], [document, result]);
  const needle = query.trim().toLowerCase();
  const match = (row: { name: string }) => !needle || row.name.toLowerCase().includes(needle);
  const shownGroups = rows.filter(match), shownTiles = tiles.filter(match);
  if (!result) return <p className="w2-empty" role="status" data-testid="repeats-working">{status === 'ready' ? EMPTY_TEXT : WORKING_TEXT}</p>;
  if (rows.length + tiles.length === 0) return <div className="w2-empty-block w2-repeats-empty" data-testid="repeats-empty"><div><h3 className="w2-repeats-empty-title">{EMPTY_TITLE}</h3><p>{EMPTY_TEXT}</p></div></div>;
  if (shownGroups.length + shownTiles.length === 0) return <p className="w2-empty">Nothing matches.</p>;
  const all = [...shownGroups, ...shownTiles];
  const tabbable = all.find(row => row.cls.id === stop)?.cls.id ?? all.find(row => row.cls.id === selected?.id)?.cls.id ?? all[0].cls.id;
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...list.current?.querySelectorAll<HTMLButtonElement>('button[data-repeat]') ?? []];
    const at = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    setStop(target.dataset.repeat);
    target.focus();
  };
  const section = (title: string, id: string, items: typeof rows) => items.length === 0 ? null : <section key={id} aria-label={title} data-group={id}>
    <h3 className="w2-group-title w2-tree-group"><span className="w2-tree-group-button w2-repeats-grouphead"><span>{title}</span><span className="w2-tree-count">{items.length}</span></span></h3>
    <ul className="w2-saved-list w2-repeats-list" aria-label={title} data-testid={id === 'groups' ? 'repeats-list' : 'repeats-tiles'}>
      {items.map(({ cls, name }) => <li key={cls.id} className="w2-saved-row w2-repeat-row">
        <button type="button" className="w2-repeat-main" data-repeat={cls.id} tabIndex={cls.id === tabbable ? 0 : -1} aria-current={selected?.id === cls.id ? 'true' : undefined}
          aria-label={`${name}. ${placesText(cls.places.length)}`} onFocus={() => setStop(cls.id)} onClick={event => onPick(cls, event.currentTarget)}>
          <span className="w2-repeat-glyph"><RowGlyph type={cls.type} size={20}/></span>
          <span className="w2-repeat-text"><span className="w2-repeat-title">{name}</span><span className="w2-repeat-places">{placesText(cls.places.length)}</span></span>
        </button>
      </li>)}
    </ul>
  </section>;
  return <div ref={list} onKeyDown={keys}>{section(GROUPS_TITLE, 'groups', shownGroups)}{section(TILES_TITLE, 'tiles', shownTiles)}</div>;
}
