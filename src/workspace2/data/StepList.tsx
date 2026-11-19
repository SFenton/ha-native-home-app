import { GripVertical, ChevronRight, Plus } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import type { PipelineInputs, PipelineStep } from '../../shared/composition/pipeline';
import EditorRow from '../editors/EditorRow';
import { MoreMenu } from '../expr/ui';
import { useRows } from '../rowsContext';
import { addStepAt, countWords, defaultFieldFor, flowLimits, flowShapes, moveStep, newStep, stepId, stepNames, stepSummary, stepsThatFit, updateFlow, withoutStep } from './flow';
import { setFlowFocus } from './focus';
import StepPage from './StepPage';
import { useFlowData } from './useFlowData';

/**
 * The Steps section (studio-pipes D1, "a step list"): a row for each step with its number, name, a line in words and what it did to the data ("42 → 18"),
 * a More menu with Move Up, Move Down and Remove Step, and Add Step, which lists only the steps that fit what arrives. A step that no longer fits has a red number and the
 * reason; the steps after it show nothing. Pressing a row pushes its page; Done is one undo step.
 */
export default function StepList({ flowId, inputs }: { flowId: string; inputs: PipelineInputs }) {
  const { document, onChange } = useRows();
  const shapes = flowShapes(inputs), data = useFlowData(flowId, inputs);
  const trace = data.result?.status === 'ok' ? data.result.trace : [];
  const before = (index: number): number | null | undefined => index === 0 ? (Array.isArray(data.response) ? data.response.length : undefined) : trace[index - 1]?.size;
  const apply = (change: (value: PipelineInputs) => PipelineInputs) => onChange(updateFlow(document, flowId, change));
  const fit = stepsThatFit(shapes.final), full = inputs.steps.length >= flowLimits.steps.max;
  const add = (op: PipelineStep['op']) => {
    const field = defaultFieldFor(op, shapes.final), id = stepId(inputs.steps, op);
    apply(value => addStepAt(value, field ? newStep(op, id, op === 'select-key' ? field[0] : field) : newStep(op, id)));
    setFlowFocus({ flowId, step: inputs.steps.length });
  };
  return <section className="w2-group w2-data-section" aria-label="Steps" data-testid="step-list">
    <h3 className="w2-group-title">Steps</h3>
    <ol className="w2-data-steps">{inputs.steps.map((step, index) => {
      const name = stepNames[step.op], bad = shapes.badStep !== undefined && index >= shapes.badStep, broken = shapes.badStep === index;
      const count = bad ? '' : countWords(before(index), trace[index]?.size);
      const arriving = index === 0 ? shapes.request : shapes.after[index - 1];
      return <li key={step.id} className="w2-data-step-row" data-bad={broken || undefined}>
        <EditorRow label={name} title={name} summary="" itemName={inputs.title} document={document} onApply={onChange}
          remove={{ label: 'Remove Step', run: draft => draft.set(updateFlow(draft.get(), flowId, value => ({ ...value, steps: value.steps.filter(item => item.id !== step.id) }))) }}
          head={start => <button type="button" className="w2-data-step-button" aria-label={`Step ${index + 1}, ${name}, ${broken ? 'does not fit the data before it' : stepSummary(step)}${count ? `, ${count}` : ''}`}
            onClick={() => { setFlowFocus({ flowId, step: index }); start(); }}>
            <GripVertical size={14} aria-hidden className="w2-data-grip"/><span className="w2-data-num" data-bad={broken || undefined} aria-hidden>{index + 1}</span>
            <span className="w2-data-step-text"><span className="w2-data-step-name">{name}</span><span className="w2-data-step-sum">{broken ? 'Does not fit the data before it' : stepSummary(step)}</span></span>
            {count && <span className="w2-data-step-count" aria-hidden>{count}</span>}<ChevronRight size={16} aria-hidden/>
          </button>}>
          {draft => <StepPage ctx={{ draft, flowId, stepId: step.id, arriving, params: inputs.parameters.map(item => ({ name: item.name, type: item.type })) }}/>}
        </EditorRow>
        <MoreMenu label={`More for step ${index + 1}, ${name}`} commands={[
          { label: 'Move Up', disabled: index === 0, run: () => apply(value => ({ ...value, steps: moveStep(value.steps, index, -1) })) },
          { label: 'Move Down', disabled: index >= inputs.steps.length - 1, run: () => apply(value => ({ ...value, steps: moveStep(value.steps, index, 1) })) },
          { label: 'Remove Step', danger: true, separatorBefore: true, run: () => apply(value => ({ ...value, steps: withoutStep(value.steps, index) })) },
        ]}/>
      </li>;
    })}</ol>
    {inputs.steps.length === 0 && <p className="w2-caption">No steps yet. The data goes straight to the Output.</p>}
    <Menu.Root>
      <Menu.Trigger className="w2-expr-add w2-data-addstep" disabled={full || fit.length === 0} aria-describedby={full ? 'w2-step-limit' : undefined}><Plus size={14} aria-hidden/>Add Step</Menu.Trigger>
      <Menu.Portal><Menu.Positioner sideOffset={4} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label="Add a step">
        {fit.map(op => <Menu.Item key={op} className="w2-menu-item" onClick={() => add(op)}>{stepNames[op]}{op === 'average' ? ' · Needs a newer app' : ''}</Menu.Item>)}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
    {full && <p id="w2-step-limit" className="w2-caption">{flowLimits.steps.words}</p>}
    {shapes.badStep === undefined && fit.length === 0 && inputs.steps.length > 0 && <p className="w2-caption">Nothing more fits a single value.</p>}
  </section>;
}
