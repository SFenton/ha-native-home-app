import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Operand, Predicate } from '../../shared/composition/expression';
import { modelReadFields } from '../../shared/composition/model-reads';
import { ensureSource } from '../add/sources';
import EntityList from '../pickers/EntityList';
import { PickerRow } from '../pickers/PickerField';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import type { Draft } from '../editors/draft';
import { appFieldKind, appItems, closedWords, ensureAppState, groupTitles, type PickerGroup } from './appState';
import { readOperand, type ValueKind } from './condition';
import { itemFieldInfos, useFlowScope } from '../data/flowScope';
import { flowSources } from '../data/flow';
import { useRepeatScope } from '../data/repeatScope';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import { words } from './words';
import { useLogicScope } from '../data/logic/logicScope';
import { defaultArgs, isUse, libraryOf, makeUse, setsLine, settingKindOf } from '../data/logic/logicModel';
import { TemplatePicker } from '../logic-fields/TemplatePicker';
import { expandLogic } from '../../shared/composition/logic-library';
import { operandKind } from '../../shared/composition/expression';
import { useLogicFields } from '../logic-fields/LogicFields';

/** What a pick makes: the draft's document (it may hold a source the pick created) and the value, in one step. */
export interface Picked {
  document: CompositionDocument;
  operand: Operand;
  /** The kind the value gives, for the comparisons that follow. */
  kind: ValueKind;
  /** Words it can take, when the contract closes them (Orientation, Permission). */
  closed?: readonly string[];
  /** A whole condition, when the pick is one (a person test). */
  predicate?: Predicate;
}
const kindFor = (as: 'string' | 'number' | 'boolean'): ValueKind => as === 'number' ? 'number' : as === 'boolean' ? 'yesno' : 'text';
const titleCase = (text: string) => text.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, letter => letter.toUpperCase());
const all: readonly PickerGroup[] = ['templateSettings', 'logic', 'entities', 'counts', 'flows', 'time', 'window', 'phone', 'notifications', 'settings', 'person', 'models'];
/** Inside a flow's step the picker offers only the item's fields, the flow's inputs, and Today and Now (a step cannot read an entity or the person). */
const flowGroups: readonly PickerGroup[] = ['item', 'inputs', 'time'];

/**
 * The grouped value picker (spec "The value picker"): a search field and groups. Entities and their state, counts, the app's own facts
 * (time, window, this phone, notifications, settings), the person using the app, and other model sources. A pick creates the source it
 * needs in the draft. Data Flows (the ones that give one value or one record) are their own group; inside a flow's step the picker is the flow's own (`FlowScope`).
 */
export default function ValuePicker({ draft, groups: asked, onPick, conditions, height = 260 }: { draft: Draft; groups?: readonly PickerGroup[]; onPick: (picked: Picked) => void; /** The pick is a condition (a person test), not a value. */ conditions?: boolean; height?: number }) {
  const { entities } = useWorkspaceData();
  const flow = useFlowScope(), scope = useLogicScope(), canvas = useLogicFields();
  // In a cell of a repeat (`sh.repeat@1`) the record's fields and its position are offered beside everything a page reads.
  const repeat = useRepeatScope();
  const groups = asked ?? (flow ? flowGroups : repeat ? ['item', ...all] as readonly PickerGroup[] : all);
  const [query, setQuery] = useState('');
  // How a picked entity is read: its state, when it last changed (`sh.entity-time@1`), the seconds until a time its state holds, or the seconds since it changed (`sh.countdown@1`).
  const [mode, setMode] = useState<'state' | 'changed' | 'until' | 'since'>('state');
  // Seconds Until counts to the time an attribute holds (a timer's `finishes_at`); empty is the entity's state.
  const [untilAttribute, setUntilAttribute] = useState('');
  const text = query.trim().toLowerCase();
  const document = draft.get();
  const match = (label: string) => !text || label.toLowerCase().includes(text);
  const rows = useMemo(() => {
    const out: { group: PickerGroup; label: string; note?: string; make: () => Picked }[] = [];
    // Inside a logic template's editor the first group is its settings; everywhere else it is the templates themselves (a body holds no use of another).
    const own = scope ? libraryOf(document).find(entry => entry.id === scope.entryId) : undefined;
    if (own && !flow) for (const param of own.params) {
      const kind = settingKindOf(param), name = param.name, label = param.label ?? name;
      if (kind === 'condition') { if (conditions) out.push({ group: 'templateSettings', label, make: () => ({ document: draft.get(), operand: { type: 'hole', name } as unknown as Operand, kind: 'yesno', predicate: { type: 'hole', name } as unknown as Predicate }) }); continue; }
      if (kind === 'person') { out.push(conditions
        ? { group: 'templateSettings', label: `Is ${label}`, make: () => ({ document: draft.get(), operand: { type: 'viewer', field: 'personEntityId' }, kind: 'text', predicate: { type: 'compare', op: 'eq', left: { type: 'viewer', field: 'personEntityId' }, right: { type: 'literal', value: { type: 'hole', name } } } as unknown as Predicate }) }
        : { group: 'templateSettings', label, make: () => ({ document: draft.get(), operand: { type: 'literal', value: { type: 'hole', name } } as unknown as Operand, kind: 'text' }) }); continue; }
      if (conditions && kind !== 'value' && kind !== 'entity' && kind !== 'number' && kind !== 'time' && kind !== 'text') continue;
      const operand = (kind === 'entity' ? { type: 'read', from: { type: 'source', sourceId: { type: 'hole', name }, path: ['state'] }, as: 'string', missing: 'unavailable' }
        : kind === 'value' ? { type: 'hole', name } : { type: 'literal', value: { type: 'hole', name } }) as unknown as Operand;
      out.push({ group: 'templateSettings', label, make: () => ({ document: draft.get(), operand, kind: kind === 'number' || kind === 'time' ? 'number' : 'text' }) });
    }
    if (!canvas && !scope && !conditions && !flow && !repeat) for (const entry of libraryOf(document)) if (entry.kind === 'operand')
      out.push({ group: 'logic', label: entry.name, note: setsLine(entry), make: () => ({ document: draft.get(), operand: makeUse(entry, defaultArgs(entry)) as unknown as Operand, kind: 'text' }) });
    if (flow) {
      for (const info of itemFieldInfos(flow)) out.push({ group: 'item', label: info.name, make: () => ({ document: draft.get(), operand: { type: 'item', path: [info.name] }, kind: info.kind, closed: info.values }) });
      // The item's place in the list (`sh.repeat@1`): the first is 0. Offered in a flow's step beside the item's fields.
      if (flow.item) out.push({ group: 'item', label: 'Position', make: () => ({ document: draft.get(), operand: { type: 'index' }, kind: 'number' }) });
      for (const input of flow.params) out.push({ group: 'inputs', label: input.name, make: () => ({ document: draft.get(), operand: { type: 'param', name: input.name }, kind: input.type === 'number' ? 'number' : input.type === 'boolean' ? 'yesno' : 'text' }) });
      out.push({ group: 'time', label: 'Today', make: () => ({ document: draft.get(), operand: { type: 'clock', part: 'today' }, kind: 'date' }) });
      out.push({ group: 'time', label: 'Now', make: () => ({ document: draft.get(), operand: { type: 'clock', part: 'now' }, kind: 'date' }) });
      return out.filter(row => match(row.label));
    }
    if (repeat && !flow) {
      for (const info of itemFieldInfos({ item: repeat.item, params: [] })) out.push({ group: 'item', label: info.name, make: () => ({ document: draft.get(), operand: { type: 'item', path: [info.name] }, kind: info.kind, closed: info.values }) });
      out.push({ group: 'item', label: 'Position', make: () => ({ document: draft.get(), operand: { type: 'index' }, kind: 'number' }) });
    }
    // The clock to the second (`sh.countdown@1`): a flow runs on the minute clock, so only a page offers it.
    if (groups.includes('time')) out.push({ group: 'time', label: words.nowSecond, make: () => ({ document: draft.get(), operand: { type: 'clock', part: 'now-second' }, kind: 'date' }) });
    for (const item of appItems) {
      const group = item.group as PickerGroup;
      if (!groups.includes(group)) continue;
      out.push({ group, label: item.label, make: () => {
        const made = ensureAppState(draft.get(), item.topic), as = appFieldKind(item);
        return { document: made.document, operand: readOperand(made.sourceId, [item.field], as), kind: item.field === 'today' ? 'date' : kindFor(as), closed: closedWords(item) };
      } });
    }
    if (groups.includes('flows')) for (const flowSource of flowSources(document)) {
      const output = flowSource.inputs.output, title = flowSource.inputs.title;
      if (output.kind === 'scalar') {
        const kinds = flowSource.inputs.schema.kind === 'number' ? 'number' : flowSource.inputs.schema.kind === 'boolean' ? 'boolean' : 'string';
        out.push({ group: 'flows', label: title, make: () => ({ document: draft.get(), operand: readOperand(flowSource.id, ['value'], kinds), kind: kindFor(kinds) }) });
      } else if (output.kind === 'record' && flowSource.inputs.schema.kind === 'object') for (const [field, entry] of Object.entries(flowSource.inputs.schema.fields)) {
        const shape = entry.shape, as = shape.kind === 'number' ? 'number' : shape.kind === 'boolean' ? 'boolean' : 'string';
        out.push({ group: 'flows', label: `${title} · ${titleCase(field)}`, make: () => ({ document: draft.get(), operand: readOperand(flowSource.id, [field], as), kind: kindFor(as) }) });
      }
    }
    if (groups.includes('counts')) for (const source of document.dataSources) if (source.kind === 'model' && source.model === 'home-status@1') for (const [field, label] of [['count', 'Count'], ['total', 'Total'], ['unavailableCount', 'Unavailable']] as const)
      out.push({ group: 'counts', label: `${titleCase(source.id)} · ${label}`, make: () => ({ document: draft.get(), operand: readOperand(source.id, [field], 'number'), kind: 'number' }) });
    if (groups.includes('models')) for (const source of document.dataSources) {
      if (source.kind !== 'model' || ['app-state@1', 'home-status@1', 'pipeline@1'].includes(source.model)) continue;
      const fields = modelReadFields(source);
      for (const [field, as] of Object.entries(fields ?? {})) if (field !== 'phase') out.push({ group: 'models', label: `${titleCase(source.id)} · ${titleCase(field)}`, make: () => ({ document: draft.get(), operand: readOperand(source.id, [field], as), kind: kindFor(as) }) });
    }
    if (groups.includes('person')) {
      if (conditions) {
        out.push({ group: 'person', label: 'Is an admin', make: () => ({ document: draft.get(), operand: { type: 'viewer', field: 'isAdmin' }, kind: 'yesno', predicate: { type: 'viewer', isAdmin: true } }) });
        out.push({ group: 'person', label: 'Is one of…', make: () => ({ document: draft.get(), operand: { type: 'viewer', field: 'userId' }, kind: 'text', predicate: { type: 'viewer', userIds: ['user'] } }) });
        for (const person of entities.filter(row => row.domain === 'person').slice(0, 20))
          out.push({ group: 'person', label: `Is ${person.name}`, make: () => ({ document: draft.get(), operand: { type: 'viewer', field: 'personEntityId' }, kind: 'text', predicate: { type: 'viewer-person', in: [person.entityId] } }) });
      } else out.push({ group: 'person', label: 'Person Using the App', make: () => ({ document: draft.get(), operand: { type: 'viewer', field: 'userId' }, kind: 'text' }) });
    }
    return out.filter(row => match(row.label));
  }, [document, groups, text, entities, conditions, flow, repeat, scope, canvas]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = (Object.keys(groupTitles) as PickerGroup[]).filter(group => group !== 'entities' && groups.includes(group));
  const first = order.filter(group => group === 'templateSettings' || group === 'logic'), later = order.filter(group => group !== 'templateSettings' && group !== 'logic');
  const section = (group: PickerGroup) => {
    const here = rows.filter(row => row.group === group);
    if (!here.length) return null;
    return <section key={group} aria-label={groupTitles[group]}><h3 className="w2-group-title">{groupTitles[group]}</h3>
      <ul className="w2-expr-picklist">{here.map(row => <li key={row.label}><button type="button" className="w2-expr-pickrow" data-group={group} onClick={() => onPick(row.make())}>{row.label}{row.note && <small className="w2-choice-note">{row.note}</small>}</button></li>)}</ul></section>;
  };
  return <div className="w2-expr-picker">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Search values" aria-label="Search values" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {first.map(section)}
    {canvas && !flow && groups.includes('logic') && <TemplatePicker document={document} kind={conditions ? 'condition' : 'operand'} onUse={use => {
      if (conditions) onPick({ document: draft.get(), operand: use as unknown as Operand, predicate: use as unknown as Predicate, kind: 'yesno' });
      else {
        const expanded = expandLogic({ logicLibrary: document.logicLibrary, value: use }).document as { value: Operand };
        const kind = operandKind(expanded.value);
        onPick({ document: draft.get(), operand: use as unknown as Operand, kind: kind === 'number' ? 'number' : kind === 'boolean' ? 'yesno' : 'text' });
      }
    }}/>}
    {groups.includes('entities') && <section aria-label={groupTitles.entities}><h3 className="w2-group-title">{groupTitles.entities}</h3>
      {!flow && <div className="w2-expr-control"><SelectMenu label={words.pickRead} value={mode} options={[{ value: 'state', label: words.state }, { value: 'changed', label: words.lastChangedValue }, { value: 'until', label: words.secondsUntil }, { value: 'since', label: words.secondsSince }]} onChange={next => setMode(next as typeof mode)}/></div>}
      {!flow && mode === 'until' && <TextInput label={words.untilAttribute} placeholder={words.untilAttributePlaceholder} value={untilAttribute} onCommit={text => setUntilAttribute(text.trim())}/>}
      <EntityList query={query} hideSearch autoFocus={false} height={height} kind="values" onPick={row => {
        const made = ensureSource(draft.get(), row.entityId);
        const state = readOperand(made.sourceId, ['state'], 'string');
        if (mode === 'changed') onPick({ document: made.document, operand: { type: 'last-changed', sourceId: made.sourceId }, kind: 'date' });
        else if (mode === 'until') onPick({ document: made.document, operand: { type: 'date', op: 'seconds-between', from: { type: 'clock', part: 'now-second' }, to: /^[A-Za-z0-9_-]+$/.test(untilAttribute.trim()) ? readOperand(made.sourceId, ['attributes', untilAttribute.trim()], 'string') : state }, kind: 'number' });
        else if (mode === 'since') onPick({ document: made.document, operand: { type: 'date', op: 'seconds-between', from: { type: 'last-changed', sourceId: made.sourceId }, to: { type: 'clock', part: 'now-second' } }, kind: 'number' });
        else onPick({ document: made.document, operand: state, kind: 'text' });
      }}/></section>}
    {later.map(section)}
  </div>;
}

/** A picker row (48 px: the value's name, a second line under it) that opens {@link ValuePicker} as a popover, or a pushed page when narrow. */
export function ValuePickerRow({ draft, label, title, primary, secondary, path, groups, onPick, conditions, stacked = true, glyph }: {
  draft: Draft; label?: string; title: string; primary: React.ReactNode; secondary?: React.ReactNode; path?: string; groups?: readonly PickerGroup[]; onPick: (picked: Picked) => void; conditions?: boolean; stacked?: boolean; glyph?: React.ReactNode;
}) {
  return <PickerRow label={label} title={title} path={path} stacked={stacked} glyph={glyph} primary={primary} secondary={secondary}>
    {close => <ValuePicker draft={draft} groups={groups} conditions={conditions} onPick={picked => { onPick(picked); close(); }}/>}
  </PickerRow>;
}
