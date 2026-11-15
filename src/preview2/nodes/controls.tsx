import { Minus, Plus } from 'lucide-react';
import type { CallService } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { evaluateOperand, evaluatePredicate, finiteNumber, formatNumber, textOf } from '../evaluate';
import { useRender } from '../render-context';
import { Glyph, type NodeOf } from './shared';

/** `bound-control`: a toggle, stepper, slider, choice or button bound to a call-service action. */
export function BoundControlNode({ node }: { node: NodeOf<'bound-control'> }) {
  const { env, mode, run } = useRender();
  const { props } = node;
  const send = (call: CallService | undefined, control?: Json) => { if (mode === 'use' && call) run(call, control); };
  const number = props.value ? finiteNumber(textOrValue(evaluateOperand(props.value, env))) : undefined;
  const unavailable = props.value ? evaluateOperand(props.value, env).status !== 'value' : false;
  const frame = (control: React.JSX.Element) => <div className={`sh-control sh-control-${props.surface ?? 'row'}`} data-kind={props.kind} data-state={unavailable ? 'unavailable' : undefined}>
    {node.icon && <span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span>}<span className="sh-row-primary">{node.title}</span>{unavailable ? <span className="sh-row-value">{props.unavailableText}</span> : control}
  </div>;
  switch (props.kind) {
    case 'toggle': {
      const on = props.isOn ? evaluatePredicate(props.isOn, env) === 'yes' : false;
      return frame(<button type="button" role="switch" aria-checked={on} aria-label={node.title} className="sh-switch" onClick={() => send(on ? node.offAction : node.onAction, !on)}><span/></button>);
    }
    case 'button': return frame(<button type="button" className="sh-mini-button" onClick={() => send(node.action)}>{node.title}</button>);
    case 'stepper': {
      const step = props.range?.step ?? 1, min = props.range?.min ?? -Infinity, max = props.range?.max ?? Infinity, now = number ?? 0;
      const label = formatValue(props.format, number);
      return frame(<span className="sh-stepper">
        <button type="button" aria-label={`Decrease ${node.title}`} disabled={now <= min} onClick={() => send(node.action, Math.max(min, now - step))}><Minus size={16}/></button>
        <output>{label}</output>
        <button type="button" aria-label={`Increase ${node.title}`} disabled={now >= max} onClick={() => send(node.action, Math.min(max, now + step))}><Plus size={16}/></button>
      </span>);
    }
    case 'slider': return frame(<input type="range" aria-label={node.title} className="sh-slider" min={props.range?.min ?? 0} max={props.range?.max ?? 100} step={props.range?.step ?? 1}
      value={number ?? props.range?.min ?? 0} onChange={event => send(node.action, Number(event.currentTarget.value))}/>);
    case 'choice': return frame(<span className="sh-segments" role="radiogroup" aria-label={node.title}>
      {(props.options ?? []).map(option => {
        const selected = evaluatePredicate(option.selectedWhen, env) === 'yes';
        return <button key={option.id} type="button" role="radio" aria-checked={selected} onClick={() => send(option.action, option.id)}>{option.label}</button>;
      })}
    </span>);
  }
}
const textOrValue = (result: ReturnType<typeof evaluateOperand>): Json | undefined => result.status === 'value' ? result.value : undefined;
function formatValue(format: string | undefined, value: number | undefined): string {
  if (value === undefined) return '';
  const text = formatNumber(value, 6);
  return format ? format.replace('{value}', text) : text;
}

/** `local-control`: a control bound to a scene value (`set-local`), never to the house. */
export function LocalControlNode({ node }: { node: NodeOf<'local-control'> }) {
  const { field, local, run, mode } = useRender();
  const def = field(node.props.stateId), current = local(node.props.stateId);
  if (!def || !current) return <div className="sh-control" data-state="unavailable"><span className="sh-row-primary">{node.title}</span><span className="sh-row-value">Unavailable</span></div>;
  const write = (value: { type: 'string'; value: string } | { type: 'boolean'; value: boolean } | { type: 'number'; value: number }) => {
    if (mode === 'use') run({ type: 'set-local', stateId: def.id, value });
  };
  const text = textOf({ status: 'value', value: current.value }, '');
  let control: React.JSX.Element;
  if (def.type === 'boolean') control = <button type="button" role="switch" aria-checked={current.value === true} aria-label={node.title} className="sh-switch" onClick={() => write({ type: 'boolean', value: current.value !== true })}><span/></button>;
  else if (def.type === 'number') {
    const now = typeof current.value === 'number' ? current.value : def.initial;
    control = <span className="sh-stepper">
      <button type="button" aria-label={`Decrease ${node.title}`} disabled={now - def.step < def.minimum} onClick={() => write({ type: 'number', value: now - def.step })}><Minus size={16}/></button>
      <output>{formatNumber(now, 6)}</output>
      <button type="button" aria-label={`Increase ${node.title}`} disabled={now + def.step > def.maximum} onClick={() => write({ type: 'number', value: now + def.step })}><Plus size={16}/></button>
    </span>;
  } else if (def.type === 'choice' && node.props.kind !== 'segmented-choice') {
    control = <select aria-label={node.title} className="sh-select" value={text} onChange={event => write({ type: 'string', value: event.currentTarget.value })}>
      {def.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>;
  } else if (def.type === 'choice') {
    control = <span className="sh-segments" role="radiogroup" aria-label={node.title}>
      {def.options.map(option => <button key={option.id} type="button" role="radio" aria-checked={text === option.id} onClick={() => write({ type: 'string', value: option.id })}>{option.label}</button>)}
    </span>;
  } else control = <input className="sh-field" aria-label={node.title} placeholder={node.props.placeholder} maxLength={def.type === 'string' ? def.maxLength : undefined} value={text}
    onChange={event => write({ type: 'string', value: event.currentTarget.value })}/>;
  return <div className="sh-control sh-control-row" data-kind={node.props.kind}><span className="sh-row-primary">{node.title}</span>{control}</div>;
}
