import { PIPELINE_LIMITS, refreshTriggers, type PipelineInputs } from '../../shared/composition/pipeline';
import { SelectMenu } from '../SelectMenu';
import EditorRow from '../editors/EditorRow';
import { useDraftDocument, type Draft } from '../editors/draft';
import { useRows } from '../rowsContext';
import EntitiesChooser from './EntitiesChooser';
import { flowById, updateFlow } from './flow';

const triggerWords: Record<typeof refreshTriggers[number], { title: string; note: string }> = {
  open: { title: 'When Opened', note: 'Each time the app opens' },
  manual: { title: 'When Pulled', note: 'Pull to refresh on a list' },
  'entity-change': { title: 'On a Change', note: 'When an entity changes' },
};
/** How out of date the data may be before the app says so: up to 5 minutes of lag is fine for EverShelf for now (owner, studio-ux2). */
export const staleChoices = [{ value: '60', label: '1 minute' }, { value: '300', label: '5 minutes' }, { value: '900', label: '15 minutes' }, { value: '3600', label: '1 hour' }, { value: '86400', label: '1 day' }] as const;

/** One summary line for the refresh row: "When opened, when pulled". */
export const refreshSummary = (inputs: PipelineInputs): string => inputs.refresh ? inputs.refresh.on.map(item => triggerWords[item].title.toLowerCase().replace(/^w/, 'w')).join(', ').replace(/^./, letter => letter.toUpperCase()) : 'Never';

function RefreshBody({ draft, flowId }: { draft: Draft; flowId: string }) {
  const document = useDraftDocument(draft);
  const source = flowById(document, flowId);
  if (!source || !source.inputs.refresh) return null;
  const inputs = source.inputs, refresh = inputs.refresh!, service = inputs.request.type === 'service-response';
  const set = (next: PipelineInputs['refresh']) => draft.set(updateFlow(draft.get(), flowId, held => ({ ...held, refresh: next })));
  const toggle = (trigger: typeof refreshTriggers[number]) => {
    const on = refresh.on.includes(trigger) ? refresh.on.filter(item => item !== trigger) : refreshTriggers.filter(item => item === trigger || refresh.on.includes(item));
    if (!on.length) return;
    const watches = on.includes('entity-change');
    const { entityIds, ...rest } = refresh;
    void entityIds;
    set({ ...rest, on, ...(service && watches ? { entityIds: refresh.entityIds ?? [{ type: 'literal' as const, value: 'todo.example_list' }] } : {}) });
  };
  return <div className="w2-editor-section w2-data-step" data-testid="refresh-page">
    <h3 className="w2-group-title">Run again</h3>
    <ul className="w2-data-triggers">{refreshTriggers.map(trigger => <li key={trigger}><label className="w2-switch-row"><span className="w2-data-trigger"><span className="w2-row-label">{triggerWords[trigger].title}</span><small className="w2-caption">{triggerWords[trigger].note}</small></span>
      <input type="checkbox" role="switch" checked={refresh.on.includes(trigger)} disabled={refresh.on.length === 1 && refresh.on.includes(trigger)} onChange={() => toggle(trigger)}/></label></li>)}</ul>
    {service && refresh.on.includes('entity-change') && <EntitiesChooser label="Watch" ids={(refresh.entityIds ?? []).map(item => item.value)} max={PIPELINE_LIMITS.entityIds}
      onChange={ids => set({ ...refresh, entityIds: ids.map(value => ({ type: 'literal', value })) })}/>}
    <div className="w2-picker-row"><span className="w2-row-label">Out of date after</span>
      <SelectMenu label="Out of date after" value={staleChoices.some(item => item.value === String(refresh.staleAfterSeconds)) ? String(refresh.staleAfterSeconds) : '300'} options={staleChoices}
        onChange={next => set({ ...refresh, staleAfterSeconds: Number(next) })}/></div>
    <p className="w2-caption">There is no timer. Home Assistant reports changes, and a person can pull to refresh.</p>
  </div>;
}

/** The Refresh row of a service or an attribute: when the flow runs again. A live list, a group of entities and Nothing have none, and the run bar says why. */
export default function RefreshRow({ flowId, inputs }: { flowId: string; inputs: PipelineInputs }) {
  const { document, onChange } = useRows();
  return <section className="w2-group w2-data-section" aria-label="Refresh" data-testid="refresh-section">
    <h3 className="w2-group-title">Refresh</h3>
    <EditorRow label="Run again" title="Refresh" summary={refreshSummary(inputs)} itemName={inputs.title} document={document} onApply={onChange} path="refresh">{draft => <RefreshBody draft={draft} flowId={flowId}/>}</EditorRow>
  </section>;
}
