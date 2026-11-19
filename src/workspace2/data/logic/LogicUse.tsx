import type { CompositionDocument } from '../../../shared/composition/schema';
import { toastManager } from '../../toasts';
import { SelectMenu } from '../../SelectMenu';
import { useWorkspaceData } from '../../pickers/WorkspaceData';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import type { Json } from '../../../shared/types';
import { TextInput } from '../../editors/controls';
import type { Draft } from '../../editors/draft';
import { releaseDraft, useDraftDocument } from '../../editors/draft';
import { ensureSource } from '../../add/sources';
import { EntityField } from '../../pickers/PickerField';
import { ValuePickerRow } from '../../expr/ValuePicker';
import { operandName, sentence } from '../../expr/condition';
import { defaultFor } from '../../expr/LogicBuilder';
import { TextResult } from '../../expr/FromEntity';
import { ConditionResult } from '../../expr/ResultLine';
import { useNameContext } from '../../expr/useExpr';
import { useDataActions } from '../dataActions';
import { entityOfSource } from '../../expr/condition';
import { entryOf, isUse, settingKindOf, useProblems, workedOut, type LogicParam } from './logicModel';
import { minutesInput, parseMinutes } from './logicNames';
import { logicWords } from './logicWords';
import type { EditorPath } from '../../../composition-editor';
import { DraftField } from '../../logic-fields/AddressedField';
import { useLogicFields } from '../../logic-fields/LogicFields';
import { UseBindingControls } from '../../logic-fields/UseBindingControls';
import { valueAt } from '../../../composition-editor';
import { resolveLogicUseBindings } from '../../../shared/composition/studio-logic/bindings';
import { resolveLogicAnchor } from '../../../shared/composition/studio-logic/anchors';
import { fieldPointer } from '../../logic-fields/registry';

/** A use of a logic template: `{type: 'logic-ref', logicId, args}`. */
export type UseValue = { type: 'logic-ref'; logicId: string; args: Record<string, Json> };

/** A Person setting: the people Home Assistant has, as a choice, and the person the use holds when none of them is it. */
function PersonSetting({ label, value, onPick }: { label: string; value: string; onPick: (id: Json) => void }) {
  const { entities } = useWorkspaceData();
  const people = entities.filter(row => row.domain === 'person');
  const options = [...people.map(row => ({ value: row.entityId, label: row.name })), ...(people.some(row => row.entityId === value) || !value ? [] : [{ value, label: value }])];
  return <div className="w2-picker-row" data-stacked><span className="w2-row-label">{label}</span>
    <div className="w2-expr-control"><SelectMenu label={label} value={value} options={options} onChange={onPick}/></div></div>;
}

/** One setting of a use, drawn by its kind's own field. */
export function SettingRow({ draft, param, arg, onArg, path }: { draft: Draft; param: LogicParam; arg: unknown; onArg: (next: Json, document?: CompositionDocument) => void; path?: EditorPath }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document);
  const canvas = useLogicFields();
  const label = param.label ?? param.name, kind = settingKindOf(param);
  if (canvas && path && arg !== undefined && (param.kind === 'condition' || param.kind === 'operand')) return <DraftField draft={draft} path={path} kind={param.kind} label={label}/>;
  if (kind === 'entity') {
    const entityId = typeof arg === 'string' ? entityOfSource(ctx, arg) : undefined;
    return <EntityField label={label} entityId={entityId} onPick={row => { const made = ensureSource(draft.get(), row.entityId); onArg(made.sourceId, made.document); }}/>;
  }
  if (kind === 'person') return <PersonSetting label={label} value={typeof arg === 'string' ? arg : ''} onPick={onArg}/>;
  if (kind === 'text') return <div className="w2-picker-row" data-stacked><span className="w2-row-label">{label}</span><TextInput label={label} value={typeof arg === 'string' ? arg : ''} maxLength={2000} onCommit={text => onArg(text)}/></div>;
  if (kind === 'number') return <div className="w2-picker-row" data-stacked><span className="w2-row-label">{label}</span><TextInput label={label} number value={typeof arg === 'number' ? String(arg) : ''} onCommit={text => { if (text !== '' && Number.isFinite(Number(text))) onArg(Number(text)); }}/></div>;
  if (kind === 'time') return <div className="w2-picker-row" data-stacked><span className="w2-row-label">{label}</span>
    <input type="time" aria-label={label} value={typeof arg === 'number' ? minutesInput(arg) : '00:00'} onChange={event => { const minutes = parseMinutes(event.target.value); if (minutes !== undefined) onArg(minutes); }}/></div>;
  if (kind === 'condition') {
    const predicate = arg as Predicate | undefined;
    return <ValuePickerRow draft={draft} label={label} title={label} conditions primary={predicate ? sentence(predicate, ctx) : logicWords.conditionUse}
      onPick={picked => onArg(defaultFor(picked) as unknown as Json, picked.document)}/>;
  }
  const operand = arg as Operand | undefined, literal = operand?.type === 'literal' && (typeof operand.value === 'string' || typeof operand.value === 'number');
  return <div className="w2-logic-valuesetting">
    {literal && <div className="w2-picker-row" data-stacked><span className="w2-row-label">{label}</span><TextInput label={label} value={String((operand as { value: unknown }).value)}
      onCommit={text => onArg({ type: 'literal', value: text !== '' && Number.isFinite(Number(text)) && typeof (operand as { value: unknown }).value === 'number' ? Number(text) : text })}/></div>}
    <ValuePickerRow draft={draft} label={literal ? undefined : label} title={label} primary={literal ? logicWords.valueUse : operand ? operandName(operand, ctx) : logicWords.valueUse}
      onPick={picked => onArg(picked.operand as unknown as Json, picked.document)}/>
  </div>;
}

/**
 * What a use opened shows (proposal, "Using one"): one row per setting under the template's name, drawn by that kind's own field, the result line, then
 * Open Template, Unlink From Template and the remove command. Reads and writes through `onChange`, so a pushed page holds no closure.
 */
export default function LogicUseSettings({ draft, use, kind, onChange, onUnlink, onRemove, removeLabel, onLeave, path }: {
  draft: Draft; use: UseValue; kind: 'value' | 'condition';
  onChange: (next: UseValue, document?: CompositionDocument) => void; onUnlink: () => void; onRemove?: () => void; removeLabel: string; onLeave?: () => void;
  path?: EditorPath;
}) {
  const document = useDraftDocument(draft), actions = useDataActions();
  const entry = entryOf(document, use.logicId);
  if (!entry) return <div className="w2-logic-use" data-testid="logic-use"><p className="w2-error-text" role="alert">{logicWords.missing}</p>
    {onRemove && <button type="button" className="w2-expr-remove" onClick={onRemove}>{removeLabel}</button>}</div>;
  const problems = useProblems(document, use);
  const resolved = path ? valueAt(resolveLogicUseBindings(document).document, path) : use;
  const effectiveUse = isUse(resolved) ? resolved : use;
  const plain = workedOut(document, effectiveUse);
  return <div className="w2-logic-use" data-testid="logic-use">
    <p className="w2-expr-tokenname"><strong>{logicWords.useTitle(entry.name)}</strong></p>
    <div role="group" aria-label={entry.name} className="w2-logic-settings-group">
      {entry.params.map(param => <div key={param.name}>
        {path && param.kind === 'source-id' && <UseBindingControls draft={draft} path={path} argument={param.name}/>}
        {path && document.logicUseBindings?.some(binding => binding.argument === param.name && resolveLogicAnchor(document, binding.use)?.pointer === fieldPointer(path))
          ? <p className="w2-caption">{param.label ?? param.name}: supplied by this tile. Choose “This use sets it” to change the value.</p>
          : <SettingRow draft={draft} param={param} arg={effectiveUse.args[param.name]} path={path ? [...path, 'args', param.name] : undefined}
          onArg={(next, base) => onChange({ ...use, args: { ...use.args, [param.name]: next } }, base)}/>
        }
      </div>)}
    </div>
    {problems.map(label => <p key={label} className="w2-error-text" role="alert">{logicWords.noValue(label)}</p>)}
    {kind === 'value' ? <TextResult operand={plain as Operand | undefined} document={document}/> : <ConditionResult document={document} predicate={plain as Predicate | undefined} place="rule"/>}
    <button type="button" className="w2-expr-wording" onClick={() => { if (draft.tryLeave()) { onLeave?.(); releaseDraft(draft); actions.openLogic(entry.id); } }}>{logicWords.openTemplate}</button>
    <button type="button" className="w2-expr-wording" onClick={() => { onUnlink(); toastManager.add({ title: logicWords.unlinked(entry.name) }); }}>{logicWords.unlink}</button>
    {onRemove && <button type="button" className="w2-expr-remove" onClick={onRemove}>{removeLabel}</button>}
  </div>;
}
export { isUse };
