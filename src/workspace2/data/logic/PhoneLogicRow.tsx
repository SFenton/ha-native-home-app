import { ChevronRight } from 'lucide-react';
import type { LogicEntry } from '../../../shared/composition/logic-library';
import { MoreMenu } from '../../expr/ui';
import { usePush } from '../../kit';
import type { Workspace2 } from '../../useWorkspace2';
import LogicEditor from './LogicEditor';
import { kindWord } from './logicModel';
import { setHeldLogicScope } from './logicScope';
import { logicWords } from './logicWords';
import { useLogicActions } from './useLogicActions';

/**
 * One Logic Templates row on a phone (Project > Data): the row pushes the template's editor, and its More menu has Rename, Show Uses, Duplicate and Delete,
 * as the panel's row does. Show Uses opens the editor, where Used by lists them.
 */
export default function PhoneLogicRow({ ws, entry, uses, onError }: { ws: Workspace2; entry: LogicEntry; uses: number; onError: (message: string) => void }) {
  const push = usePush(), actions = useLogicActions(ws, onError);
  const open = (focusName = false) => {
    setHeldLogicScope({ entryId: entry.id });
    push?.push({ title: entry.name, body: <LogicEditor ws={ws} id={entry.id}/>, guard: () => { setHeldLogicScope(undefined); return true; } });
    if (focusName) setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid="logic-name"] input')?.focus(), 60);
  };
  return <li className="w2-logic-row">
    <button type="button" className="w2-list-row w2-push-row" data-pushes onClick={() => open()}>
      <span className="w2-page-text"><span className="w2-page-title">{entry.name}</span><span className="w2-page-via">{`${kindWord(entry)} · ${logicWords.usedBy(uses)}`}</span></span><ChevronRight size={16} aria-hidden/>
    </button>
    <MoreMenu label={`More for ${entry.name}`} commands={[
      { label: logicWords.rename, run: () => open(true) }, { label: logicWords.showUses, run: () => open() },
      { label: logicWords.duplicate, run: () => actions.duplicate(entry.id) }, { label: logicWords.delete, run: () => actions.remove(entry.id), danger: true, separatorBefore: true }]}/>
    {actions.dialog}
  </li>;
}
