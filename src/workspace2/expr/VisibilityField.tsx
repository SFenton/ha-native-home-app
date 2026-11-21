import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { request } from '../../api';
import { replaceAt, selectedVariant, valueAt, type EditorPath } from '../../composition-editor';
import { ownedSources } from '../../shared/composition/components';
import { groupStates } from '../../shared/composition/grid-groups';
import { compositionNodeSchema, type CompositionDocument, type CompositionNode, type Predicate } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { sourceEntity } from '../add/sources';
import { sourceName, type Source } from '../dialogs/sources';
import EditorRow from '../editors/EditorRow';
import { useDraftDocument, type Draft } from '../editors/draft';
import { PickerRow } from '../pickers/PickerField';
import { matchesSource } from '../pickers/SourceField';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useEntityNames, useRows } from '../rows';
import { schemaAt } from '../schemaAt';
import type { EntityStates } from '../styles/NewFromEntity';
import { stateLabel } from './ComparisonControls';
import ConditionEditor from './ConditionEditor';
import { summary } from './condition';
import { removeRuleAt } from './removal';
import { useNameContext } from './useExpr';
import { words } from './words';

type StateRule = NonNullable<Extract<CompositionNode, { type: 'room-section' }>['props']['visibility']>;
const ruleAt = (document: CompositionDocument, path: EditorPath) => valueAt(document, [...path, 'props', 'visibility']) as StateRule | undefined;
// A phone's pushed source picker unmounts the editor while the new rule still has no states.
const pendingSources = new WeakMap<Draft, Map<string, string>>();

/** Private sources shadow document sources only inside their component's body, as in the compiler. */
function sourcesAt(document: CompositionDocument, path: EditorPath): Source[] {
  const entry = path[0] === 'componentLibrary' && typeof path[1] === 'number' && path[2] === 'node' ? document.componentLibrary?.[path[1]] : undefined;
  return [...new Map([...document.dataSources, ...(entry ? ownedSources(entry) : [])].map(source => [source.id, source])).values()];
}

const acceptsStateSource = (source: Source) => source.kind === 'ha-entity' || source.kind === 'model' && source.model === 'home-status@1';

export function allowsStateVisibility(document: CompositionDocument, path: EditorPath): boolean {
  const props = [...path, 'props'];
  return selectedVariant(schemaAt(document, props), valueAt(document, props) as Json).properties?.visibility !== undefined;
}

function stateRuleSummary(document: CompositionDocument, path: EditorPath, rule: StateRule, names: ReadonlyMap<string, string>): string {
  const source = sourcesAt(document, path).find(item => item.id === rule.sourceId);
  return `${source ? sourceName(source, names) : 'Missing source'} is ${rule.states.map(stateLabel).join(' or ')}`;
}

function ruleProblem(document: CompositionDocument, path: EditorPath, rule: StateRule | undefined): string | undefined {
  if (!allowsStateVisibility(document, path)) return 'This item cannot have a state rule.';
  if (!rule) return undefined;
  const source = sourcesAt(document, path).find(item => item.id === rule.sourceId);
  if (!source) return 'Choose a source already in this document.';
  if (!acceptsStateSource(source)) return 'Choose an entity or Home status source.';
  const candidate = replaceAt(document, [...path, 'props', 'visibility'], rule);
  if (!compositionNodeSchema.safeParse(valueAt(candidate, path)).success) return 'Choose 1 to 32 states, each with 1 to 160 characters.';
  return undefined;
}

/** A state rule is written whole, so a source without states never enters the draft. */
export function writeStateVisibility(document: CompositionDocument, path: EditorPath, rule: StateRule | undefined): CompositionDocument {
  const problem = ruleProblem(document, path, rule);
  if (problem) throw new Error(problem);
  const at = [...path, 'props', 'visibility'];
  return rule ? replaceAt(document, at, rule) : removeRuleAt(document, at);
}

function SourceChoices({ sources, current, names, onPick }: {
  sources: readonly Source[]; current?: string; names: ReadonlyMap<string, string>; onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = sources.filter(source => matchesSource(sourceName(source, names), `${source.id} ${sourceEntity(source) ?? ''}`, query));
  return <div className="w2-entity-list">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" aria-label="Search sources" placeholder="Search" autoFocus value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div role="listbox" aria-label="Sources" className="w2-choice-list">
      {shown.map(source => <button type="button" role="option" key={source.id} aria-selected={source.id === current} className="w2-choice" onClick={() => onPick(source.id)}>
        <span className="w2-entity-text"><span className="w2-entity-name">{sourceName(source, names)}</span></span>
      </button>)}
    </div>
    {!shown.length && <p className="w2-empty">{sources.length ? 'No sources match.' : 'No sources are in this document yet.'}</p>}
  </div>;
}

function StateRuleEditor({ draft, path }: { draft: Draft; path: EditorPath }) {
  const document = useDraftDocument(draft), rule = ruleAt(document, path);
  const { connected } = useWorkspaceData(), { onError } = useRows();
  const names = useEntityNames();
  const key = path.join('/');
  const [pendingSource, setPendingSource] = useState(() => pendingSources.get(draft)?.get(key));
  const rememberSource = (id: string | undefined) => {
    const held = pendingSources.get(draft) ?? new Map<string, string>();
    if (id === undefined) held.delete(key); else held.set(key, id);
    pendingSources.set(draft, held); setPendingSource(id);
  };
  const [other, setOther] = useState('');
  const [problem, setProblem] = useState<string>();
  const [found, setFound] = useState<EntityStates>();
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const sourceId = rule?.sourceId ?? pendingSource;
  const sources = sourcesAt(document, path);
  const source = sources.find(item => item.id === sourceId);
  const entityId = sourceEntity(source);
  useEffect(() => {
    let active = true;
    setFound(undefined); setReadError(false); setBusy(false);
    if (connected && entityId) {
      setBusy(true);
      request<EntityStates>(`/native/api/ha/entity-states?entityId=${encodeURIComponent(entityId)}`)
        .then(result => { if (active) setFound(result); })
        .catch(() => { if (active) setReadError(true); })
        .finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, [connected, entityId]);
  const reportProblem = (message: string) => { setProblem(message); onError(message); };
  const write = (next: StateRule | undefined) => {
    try {
      draft.set(writeStateVisibility(draft.get(), path, next));
      setProblem(undefined);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportProblem(message);
      return false;
    }
  };
  const states = rule?.states ?? [];
  const known = found?.entityId === entityId ? found : undefined;
  const suggested = source?.kind === 'model' && source.model === 'home-status@1' ? groupStates : [];
  const options = [...new Set([...(known?.states.map(item => item.state) ?? []), ...(known?.history ?? []), ...suggested, ...states])];
  const choose = (state: string) => {
    if (!sourceId) { setProblem('Choose a source first.'); return false; }
    const next = states.includes(state) ? states.filter(item => item !== state) : [...states, state];
    return write({ sourceId, states: next });
  };
  const add = () => {
    if (!source) { setProblem('Choose a source first.'); return; }
    const inputProblem = ruleProblem(draft.get(), path, { sourceId: source.id, states: [...states, other] });
    if (inputProblem) { reportProblem(inputProblem); return; }
    const state = other.trim();
    if (states.includes(state)) { setProblem('That state is already selected.'); return; }
    if (write({ sourceId: source.id, states: [...states, state] })) setOther('');
  };
  return <section className="w2-editor-section" aria-label="State Rule">
    <h3 className="w2-group-title">State Rule</h3>
    <p className="w2-caption">{rule ? stateRuleSummary(document, path, rule, names) : 'No state rule.'}</p>
    <p className="w2-caption">Show only while the source has one of these states.</p>
    <PickerRow label="Source" title="Source" path={[...path, 'props', 'visibility', 'sourceId'].join('/')} primary={source ? sourceName(source, names) : 'Choose'}>
      {close => <SourceChoices sources={sources.filter(acceptsStateSource)} current={sourceId} names={names}
        onPick={id => { const current = ruleAt(draft.get(), path); if (current) write({ ...current, sourceId: id }); else { rememberSource(id); setProblem(undefined); } close(); }}/>}
    </PickerRow>
    {source && <>
      {busy && <p className="w2-caption" role="status">Reading the states.</p>}
      {readError && <p className="w2-error-text" role="alert">Home Assistant's states could not be read. Enter a state below.</p>}
      {!connected && entityId && <p className="w2-caption">Not connected to Home Assistant. Enter a state below.</p>}
      <div className="w2-expr-chips" role="group" aria-label="States">
        {options.map(state => <button type="button" className="w2-chip" key={state} aria-pressed={states.includes(state)} onClick={() => choose(state)}>
          {known?.states.find(item => item.state === state)?.name ?? stateLabel(state)}
        </button>)}
      </div>
      <div className="w2-row"><label className="field"><span>Other state</span><input aria-label="Other state" value={other} onChange={event => setOther(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}/></label>
        <button type="button" onClick={add}>Add State</button>
      </div>
      {!rule && <p className="w2-caption">Choose at least one state to add the rule.</p>}
    </>}
    {problem && <p className="w2-error-text" role="alert">{problem}</p>}
    {rule && <button type="button" className="w2-expr-remove" onClick={() => { if (write(undefined)) rememberSource(undefined); }}>Remove State Rule</button>}
  </section>;
}

function VisibilityEditor({ draft, path }: { draft: Draft; path: EditorPath }) {
  const document = useDraftDocument(draft), at = [...path, 'visibleWhen'];
  const condition = valueAt(document, at);
  return <div className="w2-expr-editor">
    <StateRuleEditor draft={draft} path={path}/>
    <section className="w2-editor-section" aria-label="Additional Condition">
      <h3 className="w2-group-title">Additional Condition</h3>
      <p className="w2-caption">If you add both rules, both must match.</p>
      <ConditionEditor draft={draft} path={at} label="Condition" place="show" policy="show"/>
      {Boolean(condition) && <button type="button" className="w2-expr-remove" onClick={() => draft.set(removeRuleAt(draft.get(), at, 'whenUnknown'))}>{words.removeCondition}</button>}
    </section>
  </div>;
}

export default function VisibilityField({ path, label, itemName }: { path: EditorPath; label: string; itemName: string }) {
  const { document, onChange } = useRows();
  const names = useEntityNames(), ctx = useNameContext(document);
  const visibility = ruleAt(document, path), condition = valueAt(document, [...path, 'visibleWhen']) as Predicate | undefined;
  const line = [visibility && stateRuleSummary(document, path, visibility, names), condition && summary(condition, ctx)].filter(Boolean).join(' and ') || words.always;
  const at = [...path, 'visibleWhen'].join('/');
  return <EditorRow label={label} title="Only Show When" summary={line} itemName={itemName} document={document} onApply={onChange} path={at}
    blocked={next => ruleProblem(next, path, ruleAt(next, path))}
    head={start => <div className="w2-expr-fieldrow" data-field-path={at}>
      <span className="w2-row-label">{label}</span>
      <button type="button" className="w2-expr-fieldbtn" aria-label={`${label}: ${line}.`} onClick={start}>
        <span className={`w2-expr-line1 ${visibility || condition ? '' : 'w2-expr-none'}`}>{line}</span><ChevronRight size={16} aria-hidden/>
      </button>
    </div>}>
    {draft => <VisibilityEditor draft={draft} path={path}/>}
  </EditorRow>;
}
