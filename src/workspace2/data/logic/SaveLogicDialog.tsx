import { useMemo, useRef, useState } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../../composition-editor';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import type { Draft } from '../../editors/draft';
import { useDraftDocument } from '../../editors/draft';
import { Modal } from '../../kit';
import { toastManager } from '../../toasts';
import { MoreMenu } from '../../expr/ui';
import { entityOfSource } from '../../expr/condition';
import { slotOperand, operandSlot } from '../../expr/tokens';
import { useNameContext } from '../../expr/useExpr';
import { addMadeEntry, canAddEntry, entryFromLogic, extractRows, freshName, makeUse } from './logicModel';
import { useLogicScope } from './logicScope';
import { logicWords } from './logicWords';

/**
 * The More command "Save as Logic Template…" of a value page or a condition page, and its dialog: a name, and what the logic reads or states, one row each with a
 * checkbox (ticked: each use sets it). Saving is one step in the page's draft: the field then holds a use of the new template with its own values filled in, so
 * the page draws what it drew. Not offered inside a logic template's own editor.
 */
export default function SaveAsLogic({ draft, path, kind, onSaved }: { draft: Draft; path: EditorPath; kind: 'value' | 'condition'; onSaved?: () => void }) {
  const scope = useLogicScope();
  const [open, setOpen] = useState(false);
  if (scope) return null;
  return <div className="w2-logic-more">
    <MoreMenu label="More" commands={[{ label: logicWords.saveAs, run: () => setOpen(true), disabled: !canAddEntry(draft.get()) }]}/>
    {open && <SaveDialog draft={draft} path={path} kind={kind} onClose={() => setOpen(false)} onSaved={onSaved}/>}
  </div>;
}

function SaveDialog({ draft, path, kind, onClose, onSaved }: { draft: Draft; path: EditorPath; kind: 'value' | 'condition'; onClose: () => void; onSaved?: () => void }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document);
  const slot = valueAt(document, path) as { type: string } & Record<string, unknown> | undefined;
  const body = kind === 'value' ? (slot ? slotOperand(slot) : undefined) : slot as Predicate | undefined;
  const rows = useMemo(() => extractRows(body, id => { const entity = entityOfSource(ctx, id); return entity ? ctx.entityName?.(entity) ?? entity : id; }, id => ctx.entityName?.(id) ?? id), [body, ctx]);
  const [name, setName] = useState(() => freshName(document, kind === 'value' ? 'New Value' : 'New Condition'));
  const [ticked, setTicked] = useState(() => new Set(rows.filter(row => row.kind === 'entity' || row.kind === 'person').map(row => row.key)));
  const first = useRef<HTMLInputElement>(null);
  const save = () => {
    if (!body || !name.trim()) return;
    const made = entryFromLogic(document, kind, name.trim(), body, rows.filter(row => ticked.has(row.key)));
    const use = makeUse(made.entry, made.args);
    const next = addMadeEntry(document, made.entry);
    draft.set(replaceAt(next, path, kind === 'value' ? operandSlot(use as unknown as Operand) : use));
    toastManager.add({ title: logicWords.saved(made.entry.name) });
    onSaved?.();
    onClose();
  };
  return <Modal open onOpenChange={next => { if (!next) onClose(); }} title={logicWords.saveTitle} size="s" initialFocus={first}
    footer={<><button type="button" onClick={onClose}>{logicWords.cancel}</button><button type="button" className="w2-primary" disabled={!name.trim() || !body} onClick={save}>{logicWords.save}</button></>}>
    <p className="w2-caption">{logicWords.saveText}</p>
    <label className="w2-logic-name"><span className="w2-row-label">{logicWords.saveName}</span>
      <input ref={first} aria-label={logicWords.saveName} value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') save(); }}/></label>
    <fieldset className="w2-logic-rows"><legend className="w2-group-title">{logicWords.saveEach}</legend>
      {rows.length === 0 && <p className="w2-caption">{logicWords.nothingToSet}</p>}
      {rows.map(row => <label key={row.key} className="w2-logic-checkrow">
        <input type="checkbox" checked={ticked.has(row.key)} onChange={event => setTicked(held => { const next = new Set(held); if (event.target.checked) next.add(row.key); else next.delete(row.key); return next; })}/>
        <span className="w2-logic-checktext"><span>{row.label}</span><small className="w2-choice-note">{logicWords.kinds[row.kind]}{` · ${row.kind === 'entity' || row.kind === 'person' ? 'read from Home' : 'stated here'}`}</small></span></label>)}
    </fieldset>
  </Modal>;
}
