import { useEffect } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Json } from '../../shared/types';
import { SelectMenu } from '../SelectMenu';
import { TextInput, Switch } from '../editors/controls';
import { PickerRow } from '../pickers/PickerField';
import ValueField from '../expr/ValueField';
import { useRows } from '../rowsContext';
import { useStatePreview } from '../styles/words';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useDataActions } from './dataActions';
import { flowById, flowSources, newFlow, requestKind, updateFlow } from './flow';

/** The seven states a list draws (studio-pipes D7), and what the simulator is asked to show. `rows` is the list as it is when it has data. */
export const listStates = [
  { value: 'rows', label: 'Rows' }, { value: 'loading', label: 'Loading' }, { value: 'empty', label: 'Empty' }, { value: 'stale', label: 'Out of Date' },
  { value: 'failed', label: 'Couldn’t Update' }, { value: 'error', label: 'Error' }, { value: 'unavailable', label: 'Unavailable' },
] as const;
export type ListState = typeof listStates[number]['value'];
/** The state each text slot belongs to: focusing the text shows the state in the simulator. */
export const stateOfText: Record<string, ListState> = { loadingText: 'loading', emptyText: 'empty', emptyMessage: 'empty', staleText: 'stale', errorText: 'error', unavailableText: 'unavailable' };

/** The node types that are a list: `row-collection` (the List) and `collection`, which keeps working and draws with the same inspector. */
export const isList = (type: string | undefined): boolean => type === 'row-collection' || type === 'collection';

interface ListNode { id: string; title: string; type: string; props: { providerId?: string; refreshable?: boolean; emptyMessage?: Record<string, Json>; pullToRefresh?: boolean } }
const nodeAt = (document: Parameters<typeof valueAt>[0], path: EditorPath) => valueAt(document, path) as ListNode | undefined;

/** The lists the app builds in: sources of a list model, named by the app. */
const builtInModels = ['todo-collection', 'inventory-list', 'inventory-summary'] as const;
const modelWords: Record<string, string> = { 'todo-collection': 'To-do Lists', 'inventory-list': 'Inventory', 'inventory-summary': 'Inventory Summary' };

/**
 * "Rows from": a Data Flow that gives rows, or a list the app builds in ("Built Into the App"). "New Data Flow…" makes one and points the list at it; "Edit Data Flow"
 * opens it in the inspector. The stored value is the source id (`providerId`), so choosing is one change.
 */
export function RowsFromRow({ path, label }: { path: EditorPath; label: string }) {
  const { document, onChange } = useRows();
  const { openFlow } = useDataActions();
  const { entities } = useWorkspaceData();
  const node = nodeAt(document, path);
  if (!node) return null;
  const id = node.props.providerId ?? '';
  const flows = flowSources(document).filter(source => source.inputs.output.kind === 'rows');
  const builtIn = document.dataSources.filter(source => source.kind === 'model' && (builtInModels as readonly string[]).includes(source.model.replace(/@\d+$/, '')));
  const flow = flowById(document, id);
  const set = (value: string) => onChange(replaceAt(document, [...path, 'props', 'providerId'], value));
  const current = flow ? flow.inputs.title : builtIn.find(source => source.id === id) && builtIn.find(source => source.id === id)!.kind === 'model' ? modelWords[(builtIn.find(source => source.id === id) as { model: string }).model.replace(/@\d+$/, '')] ?? id : id || undefined;
  const second = flow ? `Data Flow · ${flow.inputs.output.kind === 'rows' ? `${flow.inputs.output.max} rows at most` : ''}`.replace(/ · $/, '') : builtIn.find(source => source.id === id) ? 'Built Into the App' : undefined;
  return <>
    <PickerRow label={label} title={label} path="props/providerId" stacked primary={current ?? <span className="w2-placeholder">Choose</span>} secondary={second}>
      {close => <div className="w2-picker-page">
        {flows.length > 0 && <section aria-label="Data Flows"><h3 className="w2-group-title">Data Flows</h3><ul className="w2-list">{flows.map(source => <li key={source.id}><button type="button" className="w2-list-row" aria-pressed={source.id === id} onClick={() => { set(source.id); close(); }}>{source.inputs.title}</button></li>)}</ul></section>}
        {builtIn.length > 0 && <section aria-label="Built Into the App"><h3 className="w2-group-title">Built Into the App</h3><ul className="w2-list">{builtIn.map(source => <li key={source.id}><button type="button" className="w2-list-row" aria-pressed={source.id === id} onClick={() => { set(source.id); close(); }}>{source.kind === 'model' ? modelWords[source.model.replace(/@\d+$/, '')] ?? source.id : source.id}</button></li>)}</ul></section>}
        <button type="button" className="w2-list-row" onClick={() => { const made = newFlow(document, 'live-list', { entityId: entities.find(row => row.domain === 'todo')?.entityId }); onChange(replaceAt(made.document, [...path, 'props', 'providerId'], made.id)); close(); }}>New Data Flow…</button>
      </div>}
    </PickerRow>
    {flow && <div className="w2-list-edit"><button type="button" onClick={() => openFlow(flow.id)}>Edit Data Flow</button></div>}
  </>;
}

/**
 * "Pull to refresh" for a list on a Data Flow that can run again (a service or an entity's attribute). Turning it on adds the flow's "When Pulled" trigger, which the
 * contract requires (`refreshable` needs `manual`); turning it off leaves the flow's own refresh alone.
 */
export function RefreshableRow({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = nodeAt(document, path);
  const flow = node?.props.providerId ? flowById(document, node.props.providerId) : undefined;
  if (!node || !flow || !flow.inputs.refresh || requestKind(flow.inputs.request) === 'group') return null;
  const on = node.props.refreshable === true;
  const toggle = (next: boolean) => {
    let doc = document;
    if (next && !flow.inputs.refresh!.on.includes('manual')) doc = updateFlow(doc, flow.id, inputs => ({ ...inputs, refresh: inputs.refresh ? { ...inputs.refresh, on: [...inputs.refresh.on, 'manual'] } : inputs.refresh }));
    const props = valueAt(doc, [...path, 'props']) as Record<string, Json>;
    const { refreshable: _gone, ...rest } = props;
    void _gone;
    onChange(replaceAt(doc, [...path, 'props'], next ? { ...rest, refreshable: true } : rest));
  };
  return <Switch label="Pull to refresh" checked={on} onChange={toggle}/>;
}

/** The empty message: a line or two under the empty title, fixed or built. Absent until something is typed; clearing it removes it (and with it the capability it asks for). */
export function EmptyMessageRow({ path, itemName }: { path: EditorPath; itemName: string }) {
  const { document, onChange } = useRows();
  const node = nodeAt(document, path);
  const slotPath = [...path, 'props', 'emptyMessage'];
  const api = useStatePreview();
  if (!node) return null;
  const show = () => api?.set({ nodeId: node.id, state: 'empty' });
  const slot = node.props.emptyMessage;
  if (slot) return <div onFocusCapture={show}><ValueField label="Empty message" path={slotPath} kind="text" itemName={itemName} maxLength={2000}/></div>;
  return <div className="w2-picker-row" onFocusCapture={show}><span className="w2-row-label">Empty message</span>
    <TextInput label="Empty message" value="" placeholder="No chores are overdue." onCommit={text => { if (text.trim()) onChange(replaceAt(document, slotPath, { type: 'literal', value: text } as unknown as Json), 'emptyMessage'); }}/></div>;
}

/** "Show state": the preview menu of studio-pipes D7. It changes what the simulator draws for this list while it is selected, and writes nothing. */
export function ShowStateRow({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const node = nodeAt(document, path);
  const api = useStatePreview();
  const mine = node && api?.preview?.nodeId === node.id ? api.preview.state : 'rows';
  const set = api?.set;
  // The simulator draws the list as it is until a state is asked for.
  useEffect(() => { if (set && node && !api?.preview) set({ nodeId: node.id, state: 'rows' }); }, [set, node?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!node || !set) return null;
  return <div className="w2-picker-row"><span className="w2-row-label">Show state</span>
    <SelectMenu label="Show state" value={mine} options={listStates} onChange={next => set({ nodeId: node.id, state: next })}/></div>;
}

/** The note under the States of the app's own `collection`: its other texts are fixed. */
export function FixedTextsNote({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const node = nodeAt(document, path);
  if (node?.type !== 'collection') return null;
  return <p className="w2-caption w2-list-fixed" data-testid="list-fixed">This list is the app's own. Its other texts are fixed.</p>;
}

/** One of a list's state texts (Loading text, Empty text, Out-of-date text, Error text, Unavailable text). Focus on it shows that state in the simulator and says so ("Showing the Empty state"). */
export function StateText({ path, label, value, node, field }: { path: EditorPath; label: string; value: string; node: string; field: string }) {
  const { document, onChange } = useRows();
  const api = useStatePreview();
  const state = stateOfText[field];
  return <div onFocusCapture={() => state && api?.set({ nodeId: node, state })}>
    <div className="w2-picker-row" data-field-path={path.join('/')}><span className="w2-row-label">{label}</span>
      <TextInput label={label} value={value} maxLength={240} onCommit={text => onChange(replaceAt(document, path, text), `text:${path.join('/')}`)}/></div>
    {state && api?.preview?.nodeId === node && api.preview.state === state && <span className="w2-sr" role="status" aria-live="polite">{`Showing the ${listStates.find(item => item.value === state)?.label} state`}</span>}</div>;
}
