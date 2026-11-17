import { useId, type CSSProperties } from 'react';
import { Check, ChevronsUpDown, Minus, Plus } from 'lucide-react';
import type { CallService } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { evaluateOperand, evaluatePredicate, finiteNumber, formatNumber, scalarText, textOf } from '../evaluate';
import { optionsFromList } from '../../shared/composition/bound-control';
import { useIsSelected } from '../selection-store';
import { useRender } from '../render-context';
import { PullDownMenu } from './PullDownMenu';
import { Glyph, GlyphByName, rgb, useEnabled, useFill, useOperand, type NodeOf } from './shared';

/** `bound-control`: a toggle, stepper, slider, choice or button bound to a call-service action. */
export function BoundControlNode({ node }: { node: NodeOf<'bound-control'> }) {
  const { env, mode, run, store } = useRender();
  const { props } = node;
  const enabled = useEnabled(node.enabledWhen, `${node.id}/enabled`);
  // The row's own parts (`sh.bound-row-parts@1`): a subtitle, a glyph tint, metrics, a hint and a failure caption.
  const subtitle = useOperand(props.subtitle, '', `${node.id}/subtitle`).text;
  const tint = rgb(useFill(props.glyph, 'glyph', `${node.id}/glyph`));
  const failing = useIsSelected(store, `node:${node.id}`) && mode === 'edit' && Boolean(props.failureText);
  const hintId = useId();
  const send = (call: CallService | undefined, control?: Json) => { if (mode === 'use' && enabled && call) run(call, control); };
  const number = props.value ? finiteNumber(textOrValue(evaluateOperand(props.value, env))) : undefined;
  const unavailable = props.value ? evaluateOperand(props.value, env).status !== 'value' : false;
  // VoiceOver reads the hint while the row can be used, and the unavailable text while it cannot.
  const hint = props.hint === undefined && props.face !== 'check' ? undefined : enabled ? props.hint : props.unavailableText;
  const caption = failing ? <span className="sh-control-failure" role="status" data-testid="failure-caption">{props.failureText}</span> : null;
  const frame = (control: React.JSX.Element) => <div className={`sh-control sh-control-${props.surface ?? 'row'}`} data-kind={props.kind} data-state={unavailable ? 'unavailable' : undefined}
    data-metrics={props.metrics} style={tint ? { '--glyph': tint } as CSSProperties : undefined}
    data-disabled={enabled ? undefined : ''} aria-disabled={enabled ? undefined : true} inert={enabled ? undefined : true}>
    {node.icon && <span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span>}
    {subtitle ? <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{subtitle}</span></span> : <span className="sh-row-primary">{node.title}</span>}
    {unavailable ? <span className="sh-row-value">{props.unavailableText}</span> : control}{caption}
  </div>;
  switch (props.kind) {
    case 'toggle': {
      const on = props.isOn ? evaluatePredicate(props.isOn, env) === 'yes' : false;
      // The check face (`sh.check-face@1`): the row is one checkbox, a circle in the leading slot and the title.
      if (props.face === 'check') return <div className="sh-control sh-control-row sh-control-check" data-kind="toggle" data-face="check" data-disabled={enabled ? undefined : ''} data-checked={on ? '' : undefined}
        style={{ '--check': props.checkTint === 'success' ? 'var(--ok)' : 'var(--action)' } as CSSProperties}>
        <button type="button" role="checkbox" aria-checked={on} aria-disabled={enabled ? undefined : true} aria-describedby={hint ? hintId : undefined} onClick={() => send(on ? node.offAction : node.onAction, !on)}>
          <span className="sh-check-circle" aria-hidden="true">{on && <Check size={16} strokeWidth={3}/>}</span><span className="sh-row-primary">{node.title}</span>
        </button>
        {hint && <span id={hintId} hidden>{hint}</span>}{caption}
      </div>;
      return frame(<>
        <button type="button" role="switch" aria-checked={on} aria-label={node.title} aria-describedby={hint ? hintId : undefined} className="sh-switch" onClick={() => send(on ? node.offAction : node.onAction, !on)}><span/></button>
        {hint && <span id={hintId} hidden>{hint}</span>}
      </>);
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
    case 'choice': {
      // Options read from the entity's list (`sh.bound-options-read@1`); the authored ones stand in while that list gives fewer than two.
      const from = props.optionsFrom;
      const list = from ? env.read(from.from.sourceId, from.from.path) : undefined;
      const read = from && list?.status === 'value' ? optionsFromList(list.value, from.labels) : undefined;
      const current = from && read ? evaluateOperand(from.current, env) : undefined;
      return frame(<span className="sh-segments" role="radiogroup" aria-label={node.title} data-options={read ? 'read' : 'authored'}>
        {from && read ? read.map(option => <button key={option.value} type="button" role="radio" aria-checked={current?.status === 'value' && scalarText(current.value) === option.value}
          onClick={() => send(from.action, option.value)}>{option.label}</button>)
          : (props.options ?? []).map(option => {
            const selected = evaluatePredicate(option.selectedWhen, env) === 'yes';
            return <button key={option.id} type="button" role="radio" aria-checked={selected} onClick={() => send(option.action, option.id)}>{option.label}</button>;
          })}
      </span>);
    }
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
    const current = def.options.find(option => option.id === text);
    control = <PullDownMenu title={node.title} className="sh-select sh-dv-pulldown" selected={current?.id} options={def.options.map(option => ({ value: option.id, label: option.label }))}
      onSelect={next => write({ type: 'string', value: next })}><span>{current?.label ?? text}</span><ChevronsUpDown size={14} aria-hidden="true"/></PullDownMenu>;
  } else if (def.type === 'choice') {
    control = <span className="sh-segments" role="radiogroup" aria-label={node.title}>
      {def.options.map(option => option.symbol
        // A symbol segment (`sh.choice-icons@1`): the symbol is drawn, the label is the accessible name, the hint is what a pointer or VoiceOver says after it.
        ? <button key={option.id} type="button" role="radio" className="sh-segment-icon" aria-checked={text === option.id} aria-label={option.label} title={option.hint}
          onClick={() => write({ type: 'string', value: option.id })}><GlyphByName name={option.symbol.name} size={18}/></button>
        : <button key={option.id} type="button" role="radio" aria-checked={text === option.id} title={option.hint} onClick={() => write({ type: 'string', value: option.id })}>{option.label}</button>)}
    </span>;
  } else control = <input className="sh-field" aria-label={node.title} placeholder={node.props.placeholder} maxLength={def.type === 'string' ? def.maxLength : undefined} value={text}
    onChange={event => write({ type: 'string', value: event.currentTarget.value })}/>;
  return <div className="sh-control sh-control-row" data-kind={node.props.kind}><span className="sh-row-primary">{node.title}</span>{control}</div>;
}
