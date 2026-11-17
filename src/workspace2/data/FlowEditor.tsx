import { useEffect } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import type { SelectionKey } from '../../preview2/model';
import { TextInput } from '../editors/controls';
import type { Workspace2 } from '../useWorkspace2';
import { useRows } from '../rowsContext';
import OutputSection from './OutputSection';
import RefreshRow from './RefreshPage';
import RequestSection, { withSampleShape } from './RequestSection';
import RunBar from './RunBar';
import StepList from './StepList';
import UsedBy from './UsedBy';
import { canAddFlow, freshNames, flowById, flowLimits, hasRefresh, removeFlow, usedCount } from './flow';
import { clearSample, setHideValues, useSample } from './samples';
import { setPickSlot } from './focus';
import { useFlow } from './useFlow';

/** The flow's More menu: Duplicate, Clear the Sample, Hide Values, Delete (a flow something uses cannot be deleted; the menu says what uses it). */
export function FlowMenu({ ws, id, onError }: { ws: Workspace2; id: string; onError: (message: string) => void }) {
  const { document, onChange } = useRows();
  const source = flowById(document, id), { sample, hide } = useSample(id);
  const uses = usedCount(document, id);
  if (!source) return null;
  const copy = () => {
    try {
      if (!canAddFlow(document)) throw new Error(flowLimits.flows.words);
      const names = freshNames(document, source.inputs.title);
      onChange({ ...document, dataSources: [...document.dataSources, { ...source, id: names.id, inputs: { ...source.inputs, title: names.title } }] });
      ws.openFlow(names.id);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label="More"><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <Menu.Item className="w2-menu-item" disabled={!canAddFlow(document)} onClick={copy}>Duplicate</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled={!sample} onClick={() => clearSample(id)}>Clear the Sample</Menu.Item>
      <Menu.CheckboxItem className="w2-menu-item" checked={hide} onCheckedChange={setHideValues}>Hide Values</Menu.CheckboxItem>
      <p className="w2-menu-note">Samples stay in this Studio. They are never published or exported.</p>
      <Menu.Separator className="w2-menu-sep"/>
      <Menu.Item className="w2-menu-item w2-danger-item" disabled={uses > 0} onClick={() => { onChange(removeFlow(document, id)); ws.openFlow(undefined); }}>
        <span className="w2-choice-text">Delete{uses > 0 && <small className="w2-choice-note">{`Used by ${uses}`}</small>}</span></Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The Data Flow inspector (studio-ux2 L-data, D2): the name, the run bar, then Request, Steps, Output, Refresh (a service and an attribute only) and Used By. Edits are
 * document changes (so they autosave and undo); a step, Refresh and each Output slot push a page inside it, as When Tapped does.
 */
export default function FlowEditor({ ws, id }: { ws: Workspace2; id: string }) {
  const { source, inputs, edit } = useFlow(id);
  // Leaving the editor ends pick mode and returns the outline to the output.
  useEffect(() => () => { setPickSlot(undefined); }, [id]);
  if (!source || !inputs) return null;
  return <div className="w2-flow" data-testid="flow-editor">
    <section className="w2-group w2-data-section" aria-label="Name"><div className="w2-picker-row"><span className="w2-row-label">Name</span>
      <TextInput label="Name" value={inputs.title} maxLength={240} onCommit={text => { if (text.trim()) edit(held => ({ ...held, title: text })); }}/></div></section>
    <RunBar flowId={id} inputs={inputs} onSample={json => edit(held => withSampleShape(held, json))}/>
    <RequestSection inputs={inputs} edit={edit}/>
    <StepList flowId={id} inputs={inputs}/>
    <OutputSection inputs={inputs} edit={edit}/>
    {hasRefresh(inputs.request) && inputs.refresh && <RefreshRow flowId={id} inputs={inputs}/>}
    <UsedBy flowId={id} onGo={(key: SelectionKey) => ws.selectAnywhere(key)}/>
  </div>;
}
