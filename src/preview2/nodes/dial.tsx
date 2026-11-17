import { useRef, type CSSProperties } from 'react';
import { inkColor } from '../../shared/composition/ink-css';
import { isFullTurn, layoutDial, nextTurn, NEEDLE, type DialInput } from '../../shared/composition/dial-math';
import { layoutArc } from '../../shared/composition/arc-track-math';
import { TextNode } from './content';
import { useOperand, type NodeOf } from './shared';
import { useMeasuredBox, useNumberOperand } from './measure';
import './dial.css';

// MARK: Dial (`sh.dial@1`)

/**
 * The turn a needle is drawn at: its target, unwrapped so a full-turn dial goes the short way round (350 to 10 is 20 degrees on), kept between draws. It is
 * forgotten while there is no value, so a needle that comes back appears where it belongs instead of sweeping from where it was.
 */
function useTurn(target: number | null, full: boolean): number | null {
  const last = useRef<number | null>(null);
  if (target === null) { last.current = null; return null; }
  const next = full ? nextTurn(last.current, target) : target;
  last.current = next;
  return next;
}

/** How wide the dial is drawn: its `size` scaled with the text size (never over `maxPoints`), else the room it has. Always up to `maxWidth`. */
function widthStyle(props: NodeOf<'dial'>['props']): CSSProperties {
  const { size, maxWidth } = props;
  const style: CSSProperties = { maxWidth };
  if (!size) return style;
  const scaled = `calc(${size.points}px * var(--sh-text-scale, 1))`;
  style.width = size.relativeTo ? (size.maxPoints ? `min(${size.maxPoints}px, ${scaled})` : scaled) : `${size.points}px`;
  return style;
}

/**
 * `dial`: ticks on a sweep, letters, a flag, a pointer (a lit tick or the closed needle) and up to three lines of text in the middle, placed by `layoutDial`,
 * the arithmetic the contract's corpus pins (the app's barometer and compass, made generic). The needle turns the short way unless Reduce Motion is on. Read as
 * one `meter` when its `a11y` names it, else hidden; the letters and the middle's text are not read on their own.
 */
export function DialNode({ node }: { node: NodeOf<'dial'> }) {
  const { props, a11y } = node;
  const [box, width, rtl] = useMeasuredBox<HTMLDivElement>(140);
  const value = useNumberOperand(props.pointer?.value);
  const input: DialInput = {
    width, aspect: props.aspect, centerY: props.centerY, sweep: props.sweep, scale: props.scale, ticks: props.ticks,
    pointer: props.pointer ? { ...props.pointer, value } : undefined,
    labels: props.labels?.items, flag: props.flag, mirrors: props.mirrors, rtl, textAt: props.textAt,
  };
  const layout = layoutDial(input);
  const turn = useTurn(layout.needle ? layout.needle.rotation : null, isFullTurn(props.sweep));
  const label = useOperand(a11y.element === 'value' ? a11y.label : undefined, '', `${node.id}/label`);
  const spoken = useOperand(a11y.element === 'value' ? a11y.value : undefined, '', `${node.id}/value`);
  const percent = layout.share === null ? undefined : Math.round(layout.share * 100);
  const meter = a11y.element === 'value'
    ? { role: 'meter', 'aria-label': label.text, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': spoken.text || (percent === undefined ? undefined : `${percent}%`) }
    : { 'aria-hidden': true as const };
  const seg = (s: { x1: number; y1: number; x2: number; y2: number }) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`;
  const unit = (px: number, py: number) => ({ x: (px - 0.5) * width, y: (py - 0.5) * width });
  const pointer = props.pointer;
  const letterInk = props.labels ? inkColor(props.labels.ink) : undefined;
  const style = { ...widthStyle(props), aspectRatio: String(props.aspect ?? 1) } as CSSProperties;
  const dot = unit(NEEDLE.dot.at[0], NEEDLE.dot.at[1]);
  return <div className="sh-dial" ref={box} style={style} data-animates={pointer?.kind === 'needle' && pointer.animates === false ? 'false' : 'true'}
    data-share={layout.share ?? undefined} data-angle={layout.needle?.angle} {...meter}>
    <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
      {props.ticks && <path className="sh-dial-ticks" d={layout.ticks.map(seg).join('')} style={{ stroke: inkColor(props.ticks.ink), strokeWidth: props.ticks.width }}/>}
      {layout.flag && props.flag && <polygon className="sh-dial-flag" points={layout.flag.map(point => `${point.x},${point.y}`).join(' ')} style={{ fill: inkColor(props.flag.ink) }}/>}
      {layout.lit && pointer?.kind === 'tick' && <path className="sh-dial-lit" d={seg(layout.lit)} style={{ stroke: inkColor(pointer.ink), strokeWidth: pointer.width }}/>}
      {layout.needle && pointer?.kind === 'needle' && turn !== null && <g className="sh-dial-needle" data-rotation={layout.needle.rotation}
        style={{ transform: `translate(${layout.cx}px, ${layout.cy}px) rotate(${turn}deg)` }}>
        <polygon points={NEEDLE.head.map(([px, py]) => { const p = unit(px, py); return `${p.x},${p.y}`; }).join(' ')} style={{ fill: inkColor(pointer.ink) }}/>
        <polygon points={NEEDLE.tail.map(([px, py]) => { const p = unit(px, py); return `${p.x},${p.y}`; }).join(' ')} style={{ fill: inkColor(pointer.tailInk) }}/>
        <circle cx={dot.x} cy={dot.y} r={width * NEEDLE.dot.size / 2} style={{ fill: inkColor(pointer.dotInk) }}/>
      </g>}
      {layout.labels.map(item => <text key={`${item.text}-${item.x}-${item.y}`} className="sh-dial-letter" x={item.x} y={item.y} fontSize={item.fontSize} style={{ fill: letterInk }}>{item.text}</text>)}
    </svg>
    {props.center && <div className="sh-dial-center" style={{ left: layout.cx, top: layout.textCenterY }} aria-hidden="true">
      {props.center.map((line, index) => <TextNode key={index} node={{ id: `${node.id}-center-${index}`, title: 'Center', type: 'text', layout: { span: 1 }, props: line }}/>)}
    </div>}
  </div>;
}

// MARK: Arc track (`sh.arc-track@1`)

/**
 * `arc-track`: a curve, an optional horizon and a marker at progress, placed by `layoutArc`, the arithmetic the contract's corpus pins (the app's daylight
 * arc, made generic). Line widths, dashes and the marker's size are points, so only the positions follow the width. Read as one `meter` when its `a11y` names
 * it, else hidden.
 */
export function ArcTrackNode({ node }: { node: NodeOf<'arc-track'> }) {
  const { props, a11y } = node;
  const [box, width, rtl] = useMeasuredBox<HTMLDivElement>(200);
  const progress = useNumberOperand(props.progress);
  const layout = layoutArc({ curve: props.curve, box: props.box, maxWidth: props.maxWidth, horizon: props.horizon, width, progress: props.marker ? progress : null, scale: props.scale, mirrors: props.mirrors, rtl });
  const label = useOperand(a11y.element === 'value' ? a11y.label : undefined, '', `${node.id}/label`);
  const spoken = useOperand(a11y.element === 'value' ? a11y.value : undefined, '', `${node.id}/value`);
  const percent = layout.marker ? Math.round(layout.marker.t * 100) : undefined;
  const meter = a11y.element === 'value'
    ? { role: 'meter', 'aria-label': label.text, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': spoken.text || (percent === undefined ? undefined : `${percent}%`) }
    : { 'aria-hidden': true as const };
  const { from, control, to } = layout.curve;
  const style = { maxWidth: props.maxWidth, '--arc-aspect': `${props.box[0]} / ${props.box[1]}` } as CSSProperties;
  return <div className="sh-arc" ref={box} style={style} {...meter}>
    <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
      {layout.horizon && props.horizon && <path className="sh-arc-horizon" d={`M${layout.horizon.from[0]} ${layout.horizon.from[1]}L${layout.horizon.to[0]} ${layout.horizon.to[1]}`}
        style={{ stroke: inkColor(props.horizon.ink), strokeWidth: props.horizon.width }}/>}
      <path className="sh-arc-curve" d={`M${from[0]} ${from[1]}Q${control[0]} ${control[1]} ${to[0]} ${to[1]}`}
        style={{ stroke: inkColor(props.ink), strokeWidth: props.width, strokeDasharray: props.dash?.join(' ') }}/>
      {layout.marker && props.marker && <circle className="sh-arc-marker" cx={layout.marker.x} cy={layout.marker.y} r={props.marker.size / 2} data-t={layout.marker.t} style={{ fill: inkColor(props.marker.ink) }}/>}
    </svg>
  </div>;
}
