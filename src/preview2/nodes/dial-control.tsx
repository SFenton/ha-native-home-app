import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { inkColor } from '../../shared/composition/ink-css';
import { evaluateOperand, evaluatePredicate, resolveLook, type Environment } from '../../shared/composition/evaluator';
import type { Operand } from '../../shared/composition/expression';
import {
  adjustStopper, dialControlState, DIAL_CONTROL_SWEEP, moveStopper, nearestStopper, ringShare, snapToStep, stopBounds, tickValues,
  type DialControlInput, type DialControlStopper,
} from '../../shared/composition/dial-control-math';
import { useIsSelected } from '../selection-store';
import { useRender } from '../render-context';
import { useEnabled, useOperand, type NodeOf } from './shared';
import './dial-control.css';

// MARK: Dial control (`sh.dial-control@1`)

type Props = NodeOf<'dial-control'>['props'];
type Stopper = Props['stoppers'][number];

/** The ring's drawn sizes in points: the app's page, sheet and grid-cell dials (`UKThermostatDial`). */
const SIZES = { page: 316, modal: 300, compact: 250 } as const;
/** The app's geometry in a 320 point square: ring radius 145, ring width 24, knob 24 with a 4 point rim, reading marker 18 with a 3 point rim. */
const UNIT = { radius: 145, ring: 24, knob: 12, rim: 4, marker: 9, markerRim: 3, tick: 2, stopLine: 3, stopPast: 8 } as const;
/** An identical release inside this time is dropped, as the shipped dial drops it. */
const REPEAT_MS = 400;

/** A number an operand gives, or `null` when it is unavailable, loading or not a number. */
function numberOf(operand: Operand | undefined, env: Environment): number | null {
  if (!operand) return null;
  const result = evaluateOperand(operand, env);
  if (result.status !== 'value') return null;
  const value = result.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}
/** A value as the middle writes it: the given decimals, never `-0`. */
const shownNumber = (value: number, digits: number) => (Math.round(value * 10 ** digits) / 10 ** digits + 0).toFixed(digits);

/**
 * `dial-control`: one or two stoppers on the thermostat's ring (270 degrees from 135 degrees), a reading marker, bands, tick dots and the readout in the
 * middle, as the app draws it. In Use a stopper drags and an arrow key on a focused stopper moves it one step; a tap on the ring moves the nearest one. The
 * arithmetic is `dial-control-math.ts` (the shared corpus pins it); this draws and sends. A stopper stays where it was put until its own read reports a
 * value that differs from the one it was read at, as the shipped dial keeps an edit until Home Assistant answers. In Edit the dial is drawn and inert.
 */
export function DialControlNode({ node }: { node: NodeOf<'dial-control'> }) {
  const { props } = node;
  const { env, mode, run, store } = useRender();
  const enabled = useEnabled(node.enabledWhen, `${node.id}/enabled`);
  const selected = useIsSelected(store, `node:${node.id}`);
  const top = useOperand(props.center.top, '', `${node.id}/top`).text;
  const caption = useOperand(props.center.caption === 'stoppers' ? undefined : props.center.caption, '', `${node.id}/caption`).text;
  const name = useOperand(node.a11y.label, '', `${node.id}/a11y-label`).text;
  const spoken = useOperand(node.a11y.value, '', `${node.id}/a11y-value`).text;
  const wrapper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  /** Edits the person made: the value, and the value the stopper's read had then. */
  const [edits, setEdits] = useState<Record<string, { value: number; base: number | null }>>({});
  /** The stopper being dragged and where its stop mark stands. */
  const [drag, setDrag] = useState<{ id: string; value: number } | undefined>();
  const last = useRef<{ id: string; value: number; at: number } | undefined>(undefined);

  const { range } = props;
  const read = props.stoppers.map(stopper => numberOf(stopper.value, env));
  const valueOf = (stopper: Stopper, at: number): number | null => {
    if (drag?.id === stopper.id) return drag.value;
    const edit = edits[stopper.id];
    return edit && edit.base === read[at] ? edit.value : read[at];
  };
  const side = (operand: Operand | undefined) => (operand === undefined ? undefined : numberOf(operand, env));
  const input: DialControlInput = {
    range,
    stoppers: props.stoppers.map((stopper, at): DialControlStopper => ({
      id: stopper.id, value: valueOf(stopper, at),
      ...(stopper.limit ? { limit: { min: side(stopper.limit.min), max: side(stopper.limit.max) } } : {}),
    })),
    ...(props.between ? { between: { rule: props.between.rule, ...(props.between.gap === undefined ? {} : { gap: numberOf(props.between.gap, env) }) } } : {}),
  };
  const state = dialControlState(input);
  const dimmed = props.dimmedWhen ? evaluatePredicate(props.dimmedWhen, env) === 'yes' : false;
  const usable = mode === 'use' && enabled && state === 'editable';

  // The ring, in the app's 320 point square scaled to the dial's size.
  const px = SIZES[props.size], scale = px / 320, c = px / 2, r = UNIT.radius * scale, ringWidth = UNIT.ring * scale;
  const sign = props.mirrors ? -1 : 1;
  const point = (share: number, radius = r) => {
    const angle = (DIAL_CONTROL_SWEEP.start + DIAL_CONTROL_SWEEP.length * share) * Math.PI / 180;
    return [c + sign * radius * Math.cos(angle), c + radius * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from), [x2, y2] = point(to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${(to - from) * DIAL_CONTROL_SWEEP.length > 180 ? 1 : 0} ${sign === 1 ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const share = (value: number) => ringShare(range, value);
  const ink = (slot: Parameters<typeof resolveLook>[0]) => inkColor(resolveLook(slot as { type: string }, env));

  const drawn = props.stoppers.map((stopper, at) => ({ stopper, at, value: valueOf(stopper, at) })).filter((entry): entry is { stopper: Stopper; at: number; value: number } => entry.value !== null);
  const reading = props.reading ? numberOf(props.reading.value, env) : null;
  const shows = props.center.value.shows;
  const centre = shows === 'reading' ? reading : drawn.find(entry => entry.stopper.id === shows)?.value ?? null;
  const digits = props.center.value.fractionDigits;
  const stopperText = drawn.map(entry => shownNumber(entry.value, digits)).join(' · ');
  const captionText = props.center.caption === undefined ? '' : props.center.caption === 'stoppers' ? stopperText : caption;
  const unavailable = state === 'unavailable';
  // Read-only and not enabled are the readout only: no stoppers, no trails, no slider elements (proposal, sections 1 and 3).
  const showStoppers = state === 'editable' && enabled;

  // MARK: Sending

  const send = (id: string, value: number) => {
    const now = Date.now();
    if (last.current && last.current.id === id && last.current.value === value && now - last.current.at < REPEAT_MS) return;
    last.current = { id, value, at: now };
    const at = props.stoppers.findIndex(stopper => stopper.id === id);
    setEdits(old => ({ ...old, [id]: { value, base: read[at] } }));
    const values: Record<string, number> = Object.fromEntries(props.stoppers.map((stopper, index) => [stopper.id, stopper.id === id ? value : valueOf(stopper, index)]).filter(([, v]) => v !== null) as [string, number][]);
    const own = props.stoppers[at]?.action;
    if (node.action) run(node.action, undefined, undefined, values);
    else if (own) run(own, value);
  };
  /** The value under a pointer, on the grid, for a stopper (or the nearest one when `id` is absent). */
  const rawAt = (event: { clientX: number; clientY: number }): number | undefined => {
    const box = (svg.current ?? wrapper.current)?.getBoundingClientRect();
    if (!box || box.width === 0) return undefined;
    const x = event.clientX - (box.left + box.width / 2), y = event.clientY - (box.top + box.height / 2);
    // Degrees clockwise from 3 o'clock; a mirrored dial reads the angle about the vertical axis.
    const degrees = (Math.atan2(y, sign * x) * 180 / Math.PI + 360) % 360;
    const along = (degrees - DIAL_CONTROL_SWEEP.start + 360) % 360;
    const held = along > DIAL_CONTROL_SWEEP.length ? (along - DIAL_CONTROL_SWEEP.length < (360 - DIAL_CONTROL_SWEEP.length) / 2 ? DIAL_CONTROL_SWEEP.length : 0) : along;
    return range.min + (held / DIAL_CONTROL_SWEEP.length) * (range.max - range.min);
  };
  const start = (id: string) => (event: PointerEvent<HTMLElement>) => {
    if (!usable) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const found = input.stoppers.find(item => item.id === id);
    if (found?.value != null) setDrag({ id, value: found.value });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const raw = rawAt(event);
    if (raw === undefined) return;
    const moved = moveStopper({ ...input, stoppers: input.stoppers.map(item => (item.id === drag.id ? { ...item, value: edits[item.id]?.value ?? read[props.stoppers.findIndex(s => s.id === item.id)] } : item)) }, drag.id, raw);
    if (moved && moved.value !== drag.value) setDrag({ id: drag.id, value: moved.value });
  };
  const finish = () => {
    if (!drag) return;
    const { id, value } = drag;
    setDrag(undefined);
    send(id, value);
  };
  const tap = (event: { clientX: number; clientY: number }) => {
    if (!usable || drag) return;
    const raw = rawAt(event);
    if (raw === undefined) return;
    const id = nearestStopper(input, raw);
    const moved = id ? moveStopper(input, id, raw) : null;
    if (id && moved) send(id, moved.value);
  };
  const key = (id: string) => (event: KeyboardEvent<HTMLElement>) => {
    if (!usable) return;
    const bounds = stopBounds(input, id);
    const found = input.stoppers.find(item => item.id === id);
    if (!bounds || found?.value == null) return;
    let next: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = adjustStopper(input, id, 1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = adjustStopper(input, id, -1);
    else if (event.key === 'PageUp') next = moveStopper(input, id, found.value + 10 * range.step)?.value ?? null;
    else if (event.key === 'PageDown') next = moveStopper(input, id, found.value - 10 * range.step)?.value ?? null;
    else if (event.key === 'Home') next = moveStopper(input, id, range.min)?.value ?? null;
    else if (event.key === 'End') next = moveStopper(input, id, range.max)?.value ?? null;
    else return;
    event.preventDefault();
    if (next !== null && next !== found.value) send(id, snapToStep(range, next));
  };

  // MARK: Drawing

  const bounds = drag ? stopBounds({ ...input, stoppers: input.stoppers.map(item => (item.id === drag.id ? { ...item, value: drag.value } : item)) }, drag.id) : null;
  const marks = [bounds?.lowerMark, bounds?.upperMark].filter((mark): mark is number => typeof mark === 'number');
  const failure = selected && mode === 'edit' && props.failureText ? props.failureText.replace('{value}', shownNumber(drawn[0]?.value ?? range.min, digits)) : '';
  return <div ref={wrapper} className={`sh-dc sh-dc-${props.size}`} role="group" aria-label={name || node.title} data-testid="dial-control" data-state={unavailable ? 'unavailable' : state === 'read-only' ? 'read-only' : undefined}
    data-dimmed={dimmed || undefined} data-use={usable || undefined} style={{ '--dc-px': `${px}px` } as CSSProperties}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setDrag(undefined)}>
    <svg ref={svg} viewBox={`0 0 ${px} ${px}`} width={px} height={px} aria-hidden="true" focusable="false" onClick={tap}>
      <path className="sh-dc-track" d={arc(0, 1)} strokeWidth={ringWidth} strokeLinecap="round" fill="none"/>
      {props.bands?.map((band, index) => <path key={index} className="sh-dc-band" d={arc(share(band.from), share(band.to))} strokeWidth={ringWidth} fill="none" style={{ stroke: ink(band.ink) }}/>)}
      {showStoppers && drawn.map(({ stopper, value }) => stopper.trail && stopper.trail !== 'none'
        ? <path key={stopper.id} className="sh-dc-trail" data-trail={stopper.trail} d={stopper.trail === 'from-start' ? arc(0, share(value)) : arc(share(value), 1)} strokeWidth={ringWidth} strokeLinecap="round" fill="none"
          style={{ stroke: ink(stopper.trailInk ?? stopper.ink) }}/> : null)}
      {props.ticks && tickValues(range, props.ticks.every).map(tick => {
        const [x, y] = point(share(tick));
        // White on a trail or a band, the label colour on bare track.
        const onInk = props.bands?.some(band => tick >= band.from && tick <= band.to) || (showStoppers && drawn.some(({ stopper, value }) => (stopper.trail === 'from-start' && tick <= value) || (stopper.trail === 'to-end' && tick >= value)));
        return <circle key={tick} className="sh-dc-tick" data-on-ink={onInk || undefined} cx={x} cy={y} r={UNIT.tick * scale}/>;
      })}
      {marks.map(mark => { const [x1, y1] = point(share(mark), r - ringWidth / 2 - UNIT.stopPast * scale), [x2, y2] = point(share(mark), r + ringWidth / 2 + UNIT.stopPast * scale);
        return <line key={mark} className="sh-dc-stop" data-testid="stop-mark" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={UNIT.stopLine * scale}/>; })}
      {props.reading && reading !== null && !unavailable && (() => { const [x, y] = point(share(reading)); return <circle className="sh-dc-reading" cx={x} cy={y} r={UNIT.marker * scale} strokeWidth={UNIT.markerRim * scale} style={{ fill: ink(props.reading.ink) }}/>; })()}
      {showStoppers && drawn.map(({ stopper, value }) => { const [x, y] = point(share(value));
        return <circle key={stopper.id} className="sh-dc-knob" data-stopper={stopper.id} data-held={drag?.id === stopper.id || undefined} cx={x} cy={y} r={UNIT.knob * scale} strokeWidth={UNIT.rim * scale} style={{ stroke: ink(stopper.ink) }}/>; })}
    </svg>
    <div className="sh-dc-readout" role="img" aria-label={`${name || node.title}${spoken ? `, ${spoken}` : centre !== null ? `, ${shownNumber(centre, digits)} ${props.center.value.unit}`.trimEnd() : ''}`}>
      {unavailable ? <span className="sh-dc-note">{props.unavailableText}</span> : <>
        {top && <small>{top}</small>}
        <strong>{centre === null ? '–' : shownNumber(centre, digits)}{props.center.value.unit && <sup>{props.center.value.unit}</sup>}</strong>
        {captionText && <span>{captionText}</span>}
      </>}
    </div>
    {showStoppers && drawn.map(({ stopper, value }) => {
      const [x, y] = point(share(value));
      const unit = props.center.value.unit;
      const text = stopper.spokenValue ? stopper.spokenValue.replace('{value}', shownNumber(value, digits)) : `${shownNumber(value, digits)}${unit ? ` ${unit}` : ''}`;
      const stopperLabel = stopperName(stopper, env);
      return <div key={stopper.id} className="sh-dc-handle" role="slider" tabIndex={usable ? 0 : -1} aria-label={stopperLabel} aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={value} aria-valuetext={text}
        aria-disabled={!usable || undefined} aria-orientation="horizontal" data-stopper={stopper.id} data-testid={`stopper-${stopper.id}`}
        style={{ left: `${(x / px) * 100}%`, top: `${(y / px) * 100}%` }} onPointerDown={start(stopper.id)} onKeyDown={key(stopper.id)} onClick={event => event.stopPropagation()}/>;
    })}
    {failure && <p className="sh-dc-failure" role="status" data-testid="failure-caption">{failure}</p>}
  </div>;
}

/** A stopper's VoiceOver name: its text slot, read now. */
function stopperName(stopper: Stopper, env: Environment): string {
  const label = stopper.label as { type: string; value?: string } | undefined;
  if (label?.type === 'literal') return String(label.value ?? '');
  const result = evaluateOperand(stopper.label as Operand, env);
  return result.status === 'value' && typeof result.value === 'string' ? result.value : stopper.id;
}
