import { useState } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { predicateSchema, type Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { appStateValues } from '../../shared/composition/app-state';
import { sourceEntity } from '../add/sources';
import { PickerRow } from '../pickers/PickerField';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import JsonBlock from '../editors/JsonBlock';
import type { Draft } from '../editors/draft';
import { SelectMenu } from '../SelectMenu';
import { evaluatePredicate } from '../data/logic/logicEval';
import { ComparisonControls, leftKind, numericState } from './ComparisonControls';
import { DraftReadRow, ReadRow, type ReadLeaf } from './SimpleCondition';
import ValuePicker, { ValuePickerRow, type Picked } from './ValuePicker';
import { closeLeaf, comparisonsFor, entityOfSource, markerOf, openLeaf, operandName, readOf, resultText, sentence, sourceOfOperand, type Leaf, type NameContext } from './condition';
import { Marker, MoreMenu, type MenuCommand } from './ui';
import { useDraftEnvironment } from './useExpr';
import { words } from './words';
import type { Operand } from '../../shared/composition/expression';
import { itemInfoOf, useFlowScope } from '../data/flowScope';
import LogicUseSettings from '../data/logic/LogicUse';
import { isUse, workedOut } from '../data/logic/logicModel';

/** Splits "Garage Door is open" so the value's name is weight 600 ("**Garage Door** is open"). */
function Sentence({ predicate, ctx }: { predicate: Predicate; ctx: NameContext }) {
  const text = sentence(predicate, ctx), leaf = openLeaf(predicate);
  const name = leaf ? operandName(leaf.left, ctx) : undefined;
  return name && text.startsWith(name) ? <span className="w2-expr-sentence"><strong>{name}</strong>{text.slice(name.length)}</span> : <span className="w2-expr-sentence">{text}</span>;
}

/** The closed words of a value that has them (Orientation, Permission), found through its app-state source. */
function closedFor(leaf: Leaf, ctx: NameContext): readonly string[] | undefined {
  const read = readOf(leaf.left), source = read && ctx.document.dataSources.find(item => item.id === read.from.sourceId);
  return source?.model === 'app-state@1' && read ? appStateValues[read.from.path.at(-1) ?? ''] : undefined;
}

type Write = (next: Predicate, document?: CompositionDocument, typing?: string) => void;

/** The three stacked controls of an open comparison: the value picker, the comparison, the other side (spec "Editing"). */
export function LeafEditor({ draft, leaf, ctx, write, compact = false, readLeaf }: { draft: Draft; leaf: Leaf; ctx: NameContext; write: Write; compact?: boolean; readLeaf?: ReadLeaf }) {
  const { entities } = useWorkspaceData();
  const commit = (next: Leaf, typing?: string, document?: CompositionDocument) => write(closeLeaf(next, id => sourceEntity((document ?? draft.get()).dataSources.find(source => source.id === id)) !== undefined), document, typing);
  const leftSource = sourceOfOperand(leaf.left), entityId = leftSource === undefined ? undefined : entityOfSource(ctx, leftSource);
  const row = entities.find(item => item.entityId === entityId);
  const flow = useFlowScope(), itemInfo = flow ? itemInfoOf(flow, leaf.left) : undefined;
  const kind = leftKind(leaf, ctx, row?.state?.split(' ')[0], itemInfo?.kind);
  const pickLeft = (picked: Picked) => {
    if (picked.predicate) { write(picked.predicate, picked.document); return; }
    const allowed = comparisonsFor(picked.kind, picked.operand), comparison = allowed.includes(leaf.comparison) ? leaf.comparison : allowed[0];
    commit({ left: picked.operand, comparison, right: [] }, undefined, picked.document);
  };
  const right = leaf.right[0] as Operand | undefined;
  const compareWith = leaf.comparison !== 'has a value' && leaf.comparison !== 'has no value' && leaf.comparison !== 'is one of' && leaf.comparison !== 'is not one of';
  return <div className={compact ? 'w2-expr-simple' : 'w2-expr-leaf'} data-compact={compact || undefined}>
    <ValuePickerRow draft={draft} title="Value" primary={operandName(leaf.left, ctx)} secondary={!compact && entityId && row?.name !== entityId ? entityId : undefined} onPick={pickLeft} conditions
      footer={compact && (readLeaf ? <DraftReadRow draft={draft} readLeaf={readLeaf} onChange={next => commit(next)}/> : <ReadRow leaf={leaf} entityId={entityId} onChange={next => commit(next)}/>)}/>
    {!compact && <ReadRow leaf={leaf} entityId={entityId} onChange={next => commit(next)}/>}
    <ComparisonControls compact={compact} numeric={itemInfo ? itemInfo.kind === 'number' : numericState(row?.state)} leaf={leaf} onChange={(next, typing) => commit(next, typing)} kind={kind} states={row?.state ? [row.state.split(' ')[0]] : []} closed={itemInfo?.values ?? closedFor(leaf, ctx)}/>
    {compareWith && <PickerRow stacked title={words.compareWithValue} primary={right && right.type !== 'literal' ? operandName(right, ctx) : words.compareWithValue}>
      {close => <ValuePicker draft={draft} conditions={false} onPick={picked => { commit({ ...leaf, right: [picked.operand] }, undefined, picked.document); close(); }}/>}
    </PickerRow>}
  </div>;
}

/** A person test: "The person using the app is an admin", "is one of …", "is (a person)". */
export function ViewerEditor({ predicate, write }: { predicate: Extract<Predicate, { type: 'viewer' | 'viewer-person' }>; write: Write }) {
  const { entities } = useWorkspaceData();
  if (predicate.type === 'viewer-person') {
    const people = entities.filter(row => row.domain === 'person'), chosen = predicate.in;
    return <div className="w2-expr-chips" role="group" aria-label="People">{[...new Set([...people.map(row => row.entityId), ...chosen])].map(id => <button type="button" key={id} className="w2-chip" aria-pressed={chosen.includes(id)}
      onClick={() => { const next = chosen.includes(id) ? chosen.filter(item => item !== id) : [...chosen, id]; if (next.length) write({ type: 'viewer-person', in: next }); }}>{people.find(row => row.entityId === id)?.name ?? id}</button>)}</div>;
  }
  if (predicate.isAdmin !== undefined) return <div className="w2-expr-control"><SelectMenu label="The person" value={String(predicate.isAdmin)} options={[{ value: 'true', label: 'is an admin' }, { value: 'false', label: 'is not an admin' }]} onChange={next => write({ type: 'viewer', isAdmin: next === 'true' })}/></div>;
  return <label className="w2-expr-control"><span className="w2-sr">User IDs</span><input aria-label="User IDs" defaultValue={(predicate.userIds ?? []).join(', ')}
    onBlur={event => { const ids = event.target.value.split(',').map(part => part.trim()).filter(Boolean); if (ids.length) write({ type: 'viewer', userIds: ids }); }}/></label>;
}

/** One condition of a group: its marker, its sentence and More; a click opens it in place (D5). */
export default function ConditionRow({ draft, item, index, ctx, open, onOpen, onChange, onCommands, label }: {
  draft: Draft; item: Predicate; index: number; ctx: NameContext; open: boolean; onOpen: (open: boolean) => void;
  onChange: (next: Predicate, document?: CompositionDocument, typing?: string) => void; onCommands: (own: readonly MenuCommand[]) => readonly MenuCommand[]; label: string;
}) {
  const env = useDraftEnvironment(draft.get());
  const tri = env ? evaluatePredicate(item, env) : undefined;
  const leaf = openLeaf(item), person = item.type === 'viewer' || item.type === 'viewer-person';
  const asUse: unknown = item, use = isUse(asUse) ? asUse : undefined;
  const custom = !leaf && !person && !use;
  const [json, setJson] = useState(false);
  const text = custom ? words.customCondition : sentence(item, ctx);
  const result = resultText('rule', tri) || 'Result unknown';
  const commands = onCommands([{ label: words.edit, run: () => onOpen(true) }]);
  return <li className="w2-expr-row" data-open={open || undefined} data-testid="condition-row">
    <div className="w2-expr-rowhead">
      <button type="button" className="w2-expr-rowbtn" aria-expanded={open} aria-label={`${label} ${index + 1}: ${text}. ${result}.`} onClick={() => onOpen(!open)}>
        <Marker kind={markerOf(tri)} size={18}/>{custom ? <span className="w2-expr-sentence"><strong>{words.customCondition}</strong></span> : <Sentence predicate={item} ctx={ctx}/>}
      </button>
      <MoreMenu label={`More for ${label} ${index + 1}`} commands={custom ? [{ label: words.editJson, run: () => { setJson(true); onOpen(true); } }, ...commands.filter(command => command.label === words.removeCondition)] : commands}/>
    </div>
    {open && <div className="w2-expr-open" role="group" aria-label={`${words.condition} ${index + 1}`}>
      <h4 className="w2-expr-opentitle">{`${words.condition} ${index + 1}`}</h4>
      {leaf && <LeafEditor draft={draft} leaf={leaf} ctx={ctx} write={onChange}/>}
      {person && <ViewerEditor predicate={item as never} write={onChange}/>}
      {use && <LogicUseSettings draft={draft} use={use} kind="condition" removeLabel={words.removeCondition}
        onChange={(next, base) => onChange(next as unknown as Predicate, base)}
        onUnlink={() => { const plain = workedOut(draft.get(), use) as Predicate | undefined; if (plain) onChange(plain); }}
        onRemove={() => commands.find(command => command.label === words.removeCondition)?.run()}/>}
      {custom && <><p className="w2-caption">{words.customNote}</p>{json && <JsonBlock label={words.editJson} value={item as unknown as Json} onChange={next => onChange(next as unknown as Predicate)} validate={value => predicateSchema.safeParse(value).success ? undefined : 'That is not a valid condition.'}/>}</>}
    </div>}
  </li>;
}
