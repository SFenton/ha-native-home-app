import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RepeatClass } from '../../shared/composition/repeats';
import RowGlyph from '../RowGlyph';
import type { Workspace2 } from '../useWorkspace2';
import { pieceText, placesText } from './repeatWords';

/** The words of the first line while the walk has no answer yet. */
export const WORKING_TEXT = 'Looking for repeated pieces…';
/** The empty level (templates spec: "Nothing found"). */
export const EMPTY_TITLE = 'Nothing found';
export const EMPTY_TEXT = 'Nothing repeats yet. A piece of 3 or more parts that appears twice shows here.';

/**
 * The rows of Repeated Pieces, shared by the library level and the phone sheet: 48 px (56 on touch), the glyph of the piece's type, what it
 * is and holds ("Tile grid, 3 tiles") and how many places ("14 places"). The list takes the arrow keys (one stop, Up and Down, Home and End).
 * While the walk runs with no answer yet it says so; when it finds nothing it says that.
 */
export default function RepeatsList({ ws, query, onPick }: { ws: Workspace2; query: string; onPick: (cls: RepeatClass, row: HTMLElement) => void }) {
  const { result, status, selected } = ws.repeats;
  const document = ws.document;
  const [stop, setStop] = useState<string>();
  const list = useRef<HTMLUListElement>(null);
  const rows = useMemo(() => document && result ? result.classes.map(cls => ({ cls, name: pieceText(document, cls) })) : [], [document, result]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => !needle || row.name.toLowerCase().includes(needle));
  if (!result) return <p className="w2-empty" role="status" data-testid="repeats-working">{status === 'ready' ? EMPTY_TEXT : WORKING_TEXT}</p>;
  if (rows.length === 0) return <div className="w2-empty-block w2-repeats-empty" data-testid="repeats-empty"><div><h3 className="w2-repeats-empty-title">{EMPTY_TITLE}</h3><p>{EMPTY_TEXT}</p></div></div>;
  if (shown.length === 0) return <p className="w2-empty">Nothing matches.</p>;
  const tabbable = shown.find(row => row.cls.id === stop)?.cls.id ?? shown.find(row => row.cls.id === selected?.id)?.cls.id ?? shown[0].cls.id;
  const keys = (event: KeyboardEvent<HTMLUListElement>) => {
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
  return <ul ref={list} className="w2-saved-list w2-repeats-list" aria-label="Repeated pieces" data-testid="repeats-list" onKeyDown={keys}>
    {shown.map(({ cls, name }) => <li key={cls.id} className="w2-saved-row w2-repeat-row">
      <button type="button" className="w2-saved-main" data-repeat={cls.id} tabIndex={cls.id === tabbable ? 0 : -1} aria-current={selected?.id === cls.id ? 'true' : undefined}
        aria-label={`${name}. ${placesText(cls.places.length)}`} onFocus={() => setStop(cls.id)} onClick={event => onPick(cls, event.currentTarget)}>
        <span className="w2-saved-glyph"><RowGlyph type={cls.type} size={20}/></span>
        <span className="w2-saved-text"><span className="w2-saved-name">{name}</span><span className="w2-saved-uses">{placesText(cls.places.length)}</span></span>
      </button>
    </li>)}
  </ul>;
}
