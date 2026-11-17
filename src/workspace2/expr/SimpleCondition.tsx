import { useState } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Operand, Predicate } from '../../shared/composition/expression';
import { ensureSource, sourceEntity } from '../add/sources';
import { PickerRow } from '../pickers/PickerField';
import EntityList from '../pickers/EntityList';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import type { Draft } from '../editors/draft';
import { ComparisonControls, leftKind, numericState } from './ComparisonControls';
import { closeSimple, openSimple, operandForChoice, readChoiceOf, readOperand, sourceOfOperand, withLeft, type Leaf, type NameContext, type ReadChoice } from './condition';
import { knownAttributes } from './appState';
import { GroupLabel } from './ui';
import { words } from './words';

const SIMPLE_COMPARISONS = ['is', 'is not', 'is one of', 'is not one of', 'is above', 'is below'] as const;
/** The first word a new "is" starts with: the entity's current state, else "on". */
const unitOf = (state?: string) => /^-?[\d.]+\s+(.+)$/.exec(state ?? '')?.[1];

/**
 * The "Read" pop-up: State, Raw State (which tells Unknown from Unavailable), then each attribute Home Assistant reports with its value now (a list
 * attribute also offers its count and "includes"), then "Other Attribute…". It stands on an entity, however the left side reads it.
 */
export function ReadRow({ leaf, entityId, onChange }: { leaf: Leaf; entityId: string | undefined; onChange: (leaf: Leaf) => void }) {
  const { house } = useWorkspaceData();
  const [other, setOther] = useState(false);
  const sourceId = sourceOfOperand(leaf.left), current = readChoiceOf(leaf.left);
  if (!sourceId || !current || !entityId) return null;
  const entity = house?.states?.get(entityId) as unknown as Record<string, unknown> | undefined;
  const attributes = knownAttributes(entity), snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const lists = new Set(Object.entries(entity ?? {}).filter(([, value]) => Array.isArray(value)).map(([key]) => snake(key)));
  const known = new Set<string>(['state', 'raw', 'changed']);
  const options: { value: string; label: string }[] = [{ value: 'state', label: words.state }, { value: 'raw', label: words.rawState }, { value: 'changed', label: words.lastChanged }];
  for (const item of attributes) {
    options.push({ value: `a:${item.name}`, label: `${item.name} · ${item.value}` }); known.add(`a:${item.name}`);
    if (lists.has(item.name)) {
      options.push({ value: `c:${item.name}`, label: `${item.name} · ${words.itemCount}` }, { value: `i:${item.name}`, label: `${item.name} · ${words.includes}` });
      known.add(`c:${item.name}`); known.add(`i:${item.name}`);
    }
  }
  if (!known.has(current)) options.push({ value: current, label: `${current.slice(2)}${current.startsWith('c:') ? ` · ${words.itemCount}` : current.startsWith('i:') ? ` · ${words.includes}` : ''}` });
  options.push({ value: 'other', label: words.otherAttribute });
  const as = leaf.left.type === 'read' && leaf.left.as !== 'entity-id' ? leaf.left.as : 'string';
  const set = (next: string) => {
    if (next === 'other') { setOther(true); return; }
    const choice = next as ReadChoice, numeric = choice.startsWith('a:') && Number.isFinite(Number(attributes.find(item => `a:${item.name}` === choice)?.value));
    // Between a state and an attribute the comparison stays; any other way to read gives another kind of value, so it starts afresh.
    const left = operandForChoice(sourceId, choice, numeric ? 'number' : choice === 'state' || choice.startsWith('a:') ? 'string' : as);
    onChange(left.type === 'read' && leaf.left.type === 'read' ? { ...leaf, left } : withLeft(leaf, left));
  };
  const needle = leaf.left.type === 'list-includes' && leaf.left.value.type === 'literal' ? String(leaf.left.value.value) : undefined;
  return <div className="w2-expr-readrow"><span className="w2-row-label">{words.read}</span>
    <div className="w2-expr-control"><SelectMenu label={words.read} value={current} options={options} onChange={set}/></div>
    {current === 'raw' && <p className="w2-caption">{words.rawStateNote}</p>}
    {current === 'changed' && <p className="w2-caption">{words.lastChangedNote}</p>}
    {needle !== undefined && leaf.left.type === 'list-includes' && <TextInput label={words.item} placeholder={words.item} value={needle}
      onCommit={text => onChange({ ...leaf, left: { ...leaf.left, value: { type: 'literal', value: text } } as Operand })}/>}
    {other && <TextInput label="Attribute name" placeholder="Attribute" value="" onCommit={name => { if (/^[A-Za-z0-9_-]+$/.test(name)) onChange(leaf.left.type === 'read' ? { ...leaf, left: { ...leaf.left, from: { ...leaf.left.from, path: ['attributes', name] } } } : withLeft(leaf, operandForChoice(sourceId, `a:${name}`))); }}/>}
  </div>;
}

/**
 * The Simple editor (spec "The condition editor: Simple"): When, the entity, Read when it has attributes, a comparison and its value.
 * It writes the shipped leaves (D6) and never rewrites a condition it only shows.
 */
export default function SimpleCondition({ draft, rule, ctx, write }: { draft: Draft; rule: Predicate | undefined; ctx: NameContext; write: (next: Predicate | undefined, document?: CompositionDocument, typing?: string) => void }) {
  const { entities } = useWorkspaceData();
  const leaf = openSimple(rule);
  const leftSource = sourceOfOperand(leaf?.left);
  const document = draft.get();
  const entityId = leftSource ? sourceEntity(document.dataSources.find(source => source.id === leftSource)) : undefined;
  const row = entities.find(item => item.entityId === entityId);
  const isEntity = (sourceId: string) => sourceEntity(draft.get().dataSources.find(source => source.id === sourceId)) !== undefined;
  const commit = (next: Leaf, typing?: string) => write(closeSimple(next, isEntity), undefined, typing);
  const pick = (id: string) => {
    const made = ensureSource(draft.get(), id), state = entities.find(item => item.entityId === id)?.state?.split(' ')[0];
    const left = readOperand(made.sourceId, ['state'], 'string');
    const next: Leaf = leaf && leaf.comparison !== 'is above' && leaf.comparison !== 'is below' ? { ...leaf, left } : { left, comparison: 'is', right: [{ type: 'literal', value: state && state !== 'unavailable' ? state : 'on' }] };
    write(closeSimple(next, id2 => sourceEntity(made.document.dataSources.find(source => source.id === id2)) !== undefined), made.document);
  };
  const kind = leaf ? leftKind(leaf, ctx, row?.state?.split(' ')[0]) : 'text';
  return <div className="w2-expr-simple" data-testid="simple-condition">
    <GroupLabel>{words.when}</GroupLabel>
    <PickerRow stacked title="Entity" path="when" primary={row?.name ?? entityId ?? <span className="w2-placeholder">Choose</span>} secondary={entityId && row?.name !== entityId ? entityId : undefined}>
      {close => <EntityList onPick={picked => { pick(picked.entityId); close(); }}/>}
    </PickerRow>
    {leaf && <>
      <ReadRow leaf={leaf} entityId={entityId} onChange={commit}/>
      <ComparisonControls numeric={numericState(row?.state)} leaf={leaf} onChange={commit} kind={kind} states={row?.state ? [row.state.split(' ')[0]] : []} unit={unitOf(row?.state)} allowed={leaf.left.type === 'last-changed' ? ['is before', 'is after'] : SIMPLE_COMPARISONS}/>
    </>}
  </div>;
}
