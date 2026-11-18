import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronRight, Sigma } from 'lucide-react';
import type { LogicEntry } from '../../../shared/composition/logic-library';
import type { SelectionKey } from '../../../preview2/model';
import { MoreMenu } from '../../expr/ui';
import type { Workspace2 } from '../../useWorkspace2';
import { kindWord, usesOf, type LogicUse } from './logicModel';
import { logicWords } from './logicWords';

/** One use in a list: the place over the node and field. A press selects the node, or opens the template whose body holds the use. */
export function UseRow({ ws, use, onDone }: { ws: Workspace2; use: LogicUse; onDone?: () => void }) {
  const title = use.inLogic ? `${use.place} · ${logicWords.editorTitle}` : use.inTemplate ? `${use.place} · Template` : use.place;
  return <li><button type="button" className="w2-link-row" disabled={!use.nodeId && !use.inLogic}
    onClick={() => { if (use.inLogic) { ws.openLogic(use.inLogic); onDone?.(); } else if (use.nodeId) { ws.selectAnywhere(`node:${use.nodeId}` as SelectionKey); onDone?.(); } }}>
    <span className="w2-page-title">{title}</span>
    <span className="w2-page-via">{[use.nodeTitle, use.inLogic ? '' : use.field].filter(Boolean).join(' · ')}</span><ChevronRight size={16} aria-hidden/></button></li>;
}

/** The uses popover: "Used by 6", one row per use with the place over the node and field; a press selects the node. Past two, "Show 4 More". */
function Uses({ ws, uses, anchor, onClose }: { ws: Workspace2; uses: LogicUse[]; anchor: HTMLElement | null; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? uses : uses.slice(0, 2);
  return <Popover.Root open onOpenChange={next => { if (!next) onClose(); }}>
    <Popover.Portal><Popover.Positioner anchor={anchor} sideOffset={6} align="end" className="w2-positioner"><Popover.Popup className="w2-scope w2-popover w2-logic-uses" aria-label={logicWords.usedByLong(uses.length)} data-testid="logic-uses">
      <Popover.Title className="w2-group-title">{logicWords.usedByLong(uses.length)}</Popover.Title>
      {uses.length === 0 ? <p className="w2-caption">Nothing uses this logic template yet.</p>
        : <ul className="w2-data-uses">{shown.map((use, at) => <UseRow key={at} ws={ws} use={use} onDone={onClose}/>)}</ul>}
      {!all && uses.length > 2 && <button type="button" className="w2-link-row" onClick={() => setAll(true)}>{logicWords.showMore(uses.length - 2)}</button>}
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}

/** One Logic Templates row: name over "Value · Used by 6", the open one tinted; More has Rename, Show Uses, Duplicate and Delete. */
export default function LogicRow({ ws, entry, uses, actions }: { ws: Workspace2; entry: LogicEntry; uses: number; actions: { remove: (id: string) => void; duplicate: (id: string) => void; rename: (id: string) => void } }) {
  const open = ws.logicId === entry.id, row = useRef<HTMLLIElement>(null);
  const [showing, setShowing] = useState(false);
  const word = kindWord(entry);
  return <li ref={row} className="w2-data-plain w2-logic-row" data-testid="logic-row">
    <button type="button" className="w2-data-row" aria-current={open || undefined}
      aria-label={`${entry.name}, logic template, ${word.toLowerCase()}, ${logicWords.usedBy(uses).toLowerCase()}`} onClick={() => ws.openLogic(open ? undefined : entry.id)}>
      <Sigma size={16} aria-hidden/><span className="w2-logic-rowtext"><span className="w2-data-name">{entry.name}</span>{" "}<small className="w2-logic-second">{`${word} · ${logicWords.usedBy(uses)}`}</small></span>
    </button>
    <MoreMenu label={`More for ${entry.name}`} commands={[
      { label: logicWords.rename, run: () => actions.rename(entry.id) }, { label: logicWords.showUses, run: () => setShowing(true) },
      { label: logicWords.duplicate, run: () => actions.duplicate(entry.id) }, { label: logicWords.delete, run: () => actions.remove(entry.id), danger: true, separatorBefore: true }]}/>
    {showing && <Uses ws={ws} uses={usesOf(ws.document!, entry.id)} anchor={row.current} onClose={() => setShowing(false)}/>}
  </li>;
}
