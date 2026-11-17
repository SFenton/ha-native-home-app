import { ChevronLeft, X } from 'lucide-react';
import type { SelectionKey } from '../preview2/model';
import Crumbs from './Crumbs';
import type { Crumb } from './levels';

/** The key the path's first crumb carries: the rail item's own list. */
export const RAIL_CRUMB = 'rail:list' as SelectionKey;

/**
 * The library's 56 px header (studio-ux2 lib3, L-tree), the same height at the root and in a level so the list never jumps.
 * At the root the title is the rail item and the subtitle its summary ("5 of 5 in the tab bar"); in a level Back, the level's name and the
 * path down to its parent ("Tabs › Home") whose crumbs jump to that level. Docked, Close is at the trailing edge; the flyout keeps it in its
 * pop-up row (`onClose` absent).
 */
export default function LibraryLevelHead({ title, summary, path, onBack, onJump, onClose }: {
  title: string; summary: string;
  /** The path above the level, the rail item first. Empty at the root. */
  path: Crumb[];
  onBack: () => void; onJump: (key: SelectionKey) => void; onClose?: () => void;
}) {
  const atRoot = path.length === 0;
  return <header className="w2-lib-head w2-lib-level-head" data-root={atRoot || undefined}>
    {!atRoot && <button type="button" className="w2-icon-button w2-lib-back" aria-label={`Back to ${path.at(-1)?.title ?? ''}`} data-drop-level={path.at(-1)!.key} onClick={onBack}><ChevronLeft size={20} aria-hidden/></button>}
    <div className="w2-lib-titles">
      <h2 className="w2-lib-title">{title}</h2>
      {atRoot ? <p className="w2-lib-sub">{summary}</p> : <Crumbs path={path} atRoot={false} onJump={onJump} align="start"/>}
    </div>
    {onClose && <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>}
  </header>;
}
