import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { PickerRow } from '../pickers/PickerField';
import { useRows } from '../rowsContext';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { starterRecordsFlow } from '../add/repeat';
import { useDataActions } from './dataActions';
import { flowById, flowSources } from './flow';

/**
 * "Repeat over": the Data Flow whose records a `repeat` draws (`sh.repeat@1`). Only a flow whose Output is Records is offered; "New Data Flow…" starts one over an entity and
 * points the repeat at it, and "Edit Data Flow" opens it. The stored value is the source id (`providerId`).
 */
export function RecordsFromRow({ path, label }: { path: EditorPath; label: string }) {
  const { document, onChange } = useRows();
  const { openFlow } = useDataActions();
  const { entities } = useWorkspaceData();
  const node = valueAt(document, path) as { props?: { providerId?: string } } | undefined;
  if (!node) return null;
  const id = node.props?.providerId ?? '';
  const flows = flowSources(document).filter(source => source.inputs.output.kind === 'records');
  const flow = flowById(document, id);
  const set = (value: string) => onChange(replaceAt(document, [...path, 'props', 'providerId'], value));
  const second = flow ? `Data Flow · ${flow.inputs.output.kind === 'records' ? `${flow.inputs.output.max} records at most` : 'Output is not Records'}` : undefined;
  return <>
    <PickerRow label={label} title={label} path="props/providerId" stacked primary={flow ? flow.inputs.title : <span className="w2-placeholder">Choose</span>} secondary={second}>
      {close => <div className="w2-picker-page">
        {flows.length > 0 && <section aria-label="Data Flows"><h3 className="w2-group-title">Data Flows</h3><ul className="w2-list">{flows.map(source =>
          <li key={source.id}><button type="button" className="w2-list-row" aria-pressed={source.id === id} onClick={() => { set(source.id); close(); }}>{source.inputs.title}</button></li>)}</ul></section>}
        <button type="button" className="w2-list-row" onClick={() => {
          const made = starterRecordsFlow(entities[0]?.entityId);
          onChange(replaceAt({ ...document, dataSources: [...document.dataSources, made] }, [...path, 'props', 'providerId'], made.id)); close();
        }}>New Data Flow…</button>
      </div>}
    </PickerRow>
    {flow && <div className="w2-list-edit"><button type="button" onClick={() => openFlow(flow.id)}>Edit Data Flow</button></div>}
  </>;
}
