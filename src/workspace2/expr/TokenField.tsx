import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Plus } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import { useNarrow, usePush } from '../kit';
import { useDraftDocument, type Draft } from '../editors/draft';
import { PickerRow } from '../pickers/PickerField';
import TokenLine from './TokenLine';
import TokenSettings from './TokenSettings';
import ValuePicker from './ValuePicker';
import { operandName } from './condition';
import { describeToken } from '../data/logic/logicTokens';
import { MAX_TOKENS, newToken, operandSlot, parseLine, slotOperand, tokenCount, writeLine, type Part, type Token } from './tokens';
import { useNameContext } from './useExpr';
import { words } from './words';
import { editBoundField } from '../logic-fields/templates';
import type { CompositionDocument } from '../../shared/composition/schema';

/** Where a line lives: a text slot (`literal`, `read` or `expr`) or a bare operand (a rule's Then). */
export interface LineAddress { path: EditorPath; wrap: 'slot' | 'operand' }
/** The operand of a line in a draft. */
export function lineOperand(value: unknown, wrap: LineAddress['wrap']): Operand | undefined {
  if (wrap === 'operand') return value as Operand | undefined;
  return value && typeof value === 'object' ? slotOperand(value as { type: string }) : undefined;
}
/** Writes parts to a line: one step, coalescing typing. */
export function writeParts(draft: Draft, address: LineAddress, parts: readonly Part[], typing: boolean, base = draft.get()): void {
  const operand = writeLine(parts);
  draft.set(editBoundField(base, address.path, document => replaceAt(document, address.path,
    address.wrap === 'slot' ? operandSlot(operand, valueAt(document, address.path)) : operand)), typing ? `line:${address.path.join('/')}` : undefined);
}

/**
 * The token line with its Insert a Value button and the popover a token opens (a pushed page when narrow). It reads and writes the
 * draft at `address`, so a pushed page holds no closure over the page below.
 */
export default function TokenField({ draft, address, label, onWording }: { draft: Draft; address: LineAddress; label: string; onWording?: (parts: Part[], index: number) => void }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document);
  const operand = lineOperand(valueAt(document, address.path), address.wrap);
  const parts = operand ? parseLine(operand) : undefined;
  const narrow = useNarrow(), push = usePush();
  const insert = useRef<(token: Token) => void>(() => {});
  const insertionBase = useRef<CompositionDocument | undefined>(undefined);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<{ index: number; anchor: HTMLElement } | undefined>();
  const [asking, setAsking] = useState(false);
  const noteId = `${address.path.join('-')}-note`;
  if (!parts) return <p className="w2-caption">{words.customValue}</p>;
  const add = (token: Token) => {
    if (tokenCount(parts) >= MAX_TOKENS) { setNote(words.sixteenValues); return; }
    insert.current(token);
  };
  const openToken = (index: number, anchor: HTMLElement) => {
    if (narrow && push) { push.push({ title: words.value, body: <TokenSettings draft={draft} address={address} index={index} onWording={onWording}/> }); return; }
    setOpen({ index, anchor });
  };
  const picker = (close: () => void, inline = false) => <ValuePicker draft={draft} groups={['templateSettings', 'logic', 'entities', 'counts', 'time', 'person', 'models']} onPick={picked => {
    close();
    // A pushed page has unmounted the line, so the value goes at the end of what the draft holds.
    if (narrow && push && !inline) writeParts(draft, address, tokenCount(parts) >= MAX_TOKENS ? parts : [...parts, { token: newToken(picked.operand) }], false, picked.document);
    else {
      insertionBase.current = picked.document;
      try { add(newToken(picked.operand)); } finally { insertionBase.current = undefined; }
    }
  }}/>;
  return <div className="w2-token-field" data-testid="token-field">
    <div className="w2-token-row">
      <TokenLine label={label} parts={parts} nameOf={token => operandName(token.operand, ctx)} describe={token => describeToken(token.operand, ctx)} onChange={(next, typing) => writeParts(draft, address, next, typing, insertionBase.current)}
        onOpenToken={openToken} onAsk={() => setAsking(true)} onNote={setNote} register={fn => { insert.current = fn; }} describedBy={note ? noteId : undefined}/>
      <PickerRow stacked title={words.insertValue} primary={<Plus size={16} aria-hidden/>} popupClassName="w2-expr-addpop">
        {close => picker(close)}
      </PickerRow>
    </div>
    {note && <p id={noteId} className="w2-caption" role="status">{note}</p>}
    {asking && <Popover.Root open onOpenChange={next => { if (!next) setAsking(false); }}>
      <Popover.Portal><Popover.Positioner sideOffset={6} align="start" className="w2-positioner"><Popover.Popup className="w2-scope w2-popover w2-picker-pop" aria-label={words.insertValue}>
        <Popover.Title className="w2-sr">{words.insertValue}</Popover.Title>{picker(() => setAsking(false), true)}
      </Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>}
    {open && !narrow && <Popover.Root open onOpenChange={next => { if (!next) setOpen(undefined); }}>
      <Popover.Portal><Popover.Positioner anchor={open.anchor} sideOffset={6} align="start" className="w2-positioner"><Popover.Popup className="w2-scope w2-popover w2-token-pop" aria-label={words.value} style={{ width: 312 }}>
        <Popover.Title className="w2-sr">{words.value}</Popover.Title>
        <TokenSettings draft={draft} address={address} index={open.index} onWording={onWording} onClose={() => setOpen(undefined)}/>
      </Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root>}
  </div>;
}
