import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../../../shared/composition/schema';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import type { LogicEntry } from '../../../shared/composition/logic-library';
import { TextInput } from '../../editors/controls';
import { ResultLine } from '../../expr/ResultLine';
import { conditionResult } from '../../expr/ResultLine';
import { useDataTag, useDraftEnvironment, useNameContext } from '../../expr/useExpr';
import { useWorkspaceData } from '../../pickers/WorkspaceData';
import { RowsProvider, useRows } from '../../rowsContext';
import type { Workspace2 } from '../../useWorkspace2';
import { scalarText, evaluateOperand } from './logicEval';
import LogicSettings from './LogicSettings';
import { bodyWithSamples, entryOf, kindWord, nameFree, renameEntry, setBody, usesOf } from './logicModel';
import { logicWords } from './logicWords';
import { UseRow } from './LogicRow';
import { useLiveDraft } from './useLiveDraft';
import { useLogicActions } from './useLogicActions';
import { AddressedField } from '../../logic-fields/AddressedField';
import { operandBodyDraft, useFieldDraft, useLogicFields } from '../../logic-fields/LogicFields';
import { replaceAt, valueAt, type EditorPath } from '../../../composition-editor';
import { LogicScopeProvider } from './logicScope';
import EditorRow from '../../editors/EditorRow';
import ConditionField from '../../expr/ConditionField';
import ValueEditor from '../../expr/ValueEditor';
import { ThenSummary } from '../../expr/RulesList';
import { operandSlot, slotOperand } from '../../expr/tokens';
import { rulesOf, rulesProblem, type RulesDraft } from '../../expr/value';
import type { Json } from '../../../shared/types';
import { hasMultipleChecks } from '../../logic-fields/checks';
import { liftField } from '../../logic-fields/registry';
import { MiniMap } from '../../logic-fields/MiniMap';
import { graphSentence } from '../../logic-fields/presentation';
type Rec = Record<string, unknown>;

/** The result line: the body worked out with each setting's Try With value, tagged Test (Live when nothing is set). */
function BodyResult({ document, entry }: { document: CompositionDocument; entry: LogicEntry }) {
  const env = useDraftEnvironment(document), ctx = useNameContext(document), live = useDataTag(), { connected } = useWorkspaceData();
  const worked = bodyWithSamples(document, entry);
  const tag = entry.params.length ? 'Test' : live;
  if (!env || worked === undefined) return <ResultLine marker="unknown" head={logicWords.resultNothing} tag={env ? tag : undefined}>{logicWords.resultTry}</ResultLine>;
  if (entry.kind === 'condition') {
    const result = conditionResult('rule', worked as Predicate, env, ctx, undefined, connected);
    return <ResultLine marker={result.marker} head={result.head} tag={tag}>{result.reason}</ResultLine>;
  }
  const said = evaluateOperand(worked as Operand, env);
  const text = said.status === 'value' ? scalarText(said.value) : undefined;
  if (said.status !== 'value' || text === undefined || (text === '' && (entry.body as Rec).type === 'literal')) return <ResultLine marker="unknown" head={said.status === 'value' ? logicWords.resultNothing : "Can't tell yet."} tag={tag}>{logicWords.resultTry}</ResultLine>;
  return <ResultLine marker="check" head={`Shows ${text}`} tag={tag}>{logicWords.resultTry}</ResultLine>;
}

/** The body's own field: a value opens the value editor (in Rules the first time), a condition the condition editor. Both are the built editors. */
function Body({ document, entry, apply }: { document: CompositionDocument; entry: LogicEntry; apply: (next: CompositionDocument) => void }) {
  const rows = useRows(), canvas = useLogicFields();
  const draft = useFieldDraft(document, apply);
  const path = ['logicLibrary', document.logicLibrary!.findIndex(item => item.id === entry.id), 'body'];
  return <LogicScopeProvider value={{ entryId: entry.id }}><RowsProvider value={{ ...rows, document, onChange: apply }}>
    {!canvas || entry.kind !== 'condition' || !hasMultipleChecks(entry.body) ? entry.kind === 'condition'
      ? <ConditionField label={logicWords.bodyCondition} title={logicWords.body} path={path} place="rule" itemName={entry.name}/>
      : <ValueBody document={document} entry={entry} path={path} onApply={apply}/>
      :
    <AddressedField label={entry.kind === 'condition' ? logicWords.bodyCondition : logicWords.bodyValue}
      path={path} kind={entry.kind}/>}
    {canvas && (entry.kind !== 'condition' || !hasMultipleChecks(entry.body)) && <div className="w2-logic-commands">
      <button type="button" onClick={() => canvas.open({ draft, path, kind: entry.kind, label: logicWords.body })}>Edit in Canvas</button>
    </div>}
  </RowsProvider></LogicScopeProvider>;
}
function ValueBody({ document, entry, path, onApply }: { document: CompositionDocument; entry: LogicEntry; path: EditorPath; onApply: (next: CompositionDocument) => void }) {
  const body = entry.body as unknown as Operand, ctx = useNameContext(document);
  const canvas = useLogicFields();
  const preview = useMemo(() => {
    if (!canvas) return undefined;
    try { return { graph: liftField(document, path, 'operand').graph }; }
    catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [canvas, document, path.join('/')]);
  const view = replaceAt(document, path, operandSlot(body));
  const untouched = body.type === 'literal' && body.value === '';
  const rules = rulesOf(operandSlot(body), 'text') as RulesDraft<Operand | Json> | undefined;
  return <><EditorRow label={logicWords.bodyValue} title={logicWords.body} summary="" itemName={entry.name} document={view}
    onApply={next => {
      const slot = valueAt(next, path) as { type: string };
      const edited = slotOperand(slot);
      if (!edited) throw new Error('The template body must have a value.');
      onApply(setBody(next, entry.id, edited as unknown as Rec));
    }}
    blocked={doc => { const held = rulesOf(valueAt(doc, path) as never, 'text'); return held ? rulesProblem(held as RulesDraft<Operand | Json>, 'text') : undefined; }}
    head={start => <div className="w2-expr-valuerow w2-logic-body" data-field-path={path.join('/')}>
      <span className="w2-row-label">{logicWords.bodyValue}</span>
      <button type="button" className="w2-expr-fieldbtn" data-testid="logic-body" data-two-line aria-label={`${logicWords.bodyValue}: ${rules ? `${rules.cases.length} rule${rules.cases.length === 1 ? '' : 's'}` : untouched ? logicWords.resultNothing : ''}`} onClick={start}>
        <span className="w2-expr-fieldtext"><span className="w2-expr-line1">{untouched ? logicWords.resultNothing : rules ? `${rules.cases.length} rule${rules.cases.length === 1 ? '' : 's'}` : <ThenSummary kind="text" then={body} ctx={ctx}/>}</span></span><ChevronRight size={16} aria-hidden/>
      </button></div>}>
    {draft => <ValueEditor draft={draft} path={path} kind="text" modes={['fixed', 'entity', 'rules']} label={logicWords.bodyValue} initialMode={untouched ? 'rules' : undefined}
      canvasField={{ draft: operandBodyDraft(draft, path), path, kind: 'operand', label: logicWords.body }}/>}
  </EditorRow>
    {preview?.graph ? <MiniMap graph={preview.graph} ctx={ctx} description={graphSentence(preview.graph, ctx)}/>
      : preview?.error ? <p role="alert" className="w2-error-text">{preview.error}</p> : null}
  </>;
}

/** The uses of the template, two at first, each a button that shows its node. */
function UsedBy({ ws, document, entry }: { ws: Workspace2; document: CompositionDocument; entry: LogicEntry }) {
  const [all, setAll] = useState(false);
  const uses = usesOf(document, entry.id), shown = all ? uses : uses.slice(0, 2);
  return <section className="w2-group w2-data-section" aria-label="Used by" data-testid="used-by">
    <h3 className="w2-group-title">Used by</h3>
    {uses.length === 0 ? <p className="w2-caption">Nothing uses this logic template yet. Pick it in a value’s Insert a Value, or in a condition’s + Template.</p>
      : <ul className="w2-data-uses">{shown.map((use, at) => <UseRow key={at} ws={ws} use={use}/>)}</ul>}
    {!all && uses.length > 2 && <button type="button" className="w2-link-row" onClick={() => setAll(true)}>{logicWords.showMore(uses.length - 2)}</button>}
  </section>;
}

/**
 * The logic template inspector (studio-logic proposal, section 1, "Making one"): a way back, the name, "Each use sets", the body, the result line, Used by and
 * Delete Template. The settings are always valid and apply at once; the body is edited on a page, as every value and condition is, so a half-made rule never
 * reaches the draft. An edit does not ask: the header says how many uses it reaches.
 */
export default function LogicEditor({ ws, id }: { ws: Workspace2; id: string }) {
  const { document, onError } = useRows();
  const entry = entryOf(document, id);
  const apply = (next: CompositionDocument) => { try { ws.studio.apply(next); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const draft = useLiveDraft(document, apply);
  const actions = useLogicActions(ws, onError);
  const [note, setNote] = useState('');
  if (!entry) return null;
  const from = ws.logicFrom;
  return <div className="w2-logic-editor" data-testid="logic-editor" data-kind={kindWord(entry).toLowerCase()}>
    {from && <button type="button" className="w2-back" onClick={() => ws.select(from.key)}><ChevronLeft size={16} aria-hidden/>{logicWords.backTo(from.title)}</button>}
    <section className="w2-group w2-data-section" aria-label={logicWords.name} data-testid="logic-name"><div className="w2-picker-row"><span className="w2-row-label">{logicWords.name}</span>
      <TextInput label={logicWords.name} value={entry.name} maxLength={80} onCommit={text => {
        if (!text.trim()) return;
        if (!nameFree(document, text, id)) { setNote('Choose a name no other logic template has.'); return; }
        setNote(''); if (text.trim() !== entry.name) apply(renameEntry(document, id, text));
      }}/></div>{note && <p className="w2-error-text" role="alert">{note}</p>}</section>
    <LogicSettings draft={draft} document={document} id={id} onError={onError} apply={apply}/>
    <section className="w2-group w2-data-section" aria-label={logicWords.body}><Body document={document} entry={entry} apply={apply}/></section>
    <BodyResult document={document} entry={entry}/>
    <UsedBy ws={ws} document={document} entry={entry}/>
    <button type="button" className="w2-editor-remove" data-testid="logic-delete" onClick={() => actions.remove(id)}>{logicWords.deleteConfirm}</button>
    {actions.dialog}
  </div>;
}
