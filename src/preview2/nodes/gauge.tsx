import { type CSSProperties } from 'react';
import { inkColor } from '../../shared/composition/ink-css';
import { layoutGauge } from '../../shared/composition/gauge-math';
import { useOperand, type NodeOf } from './shared';
import { useNumber, useWidth } from './plot';
import './chart.css';

// MARK: Linear gauge (`sh.linear-gauge@1`)

/**
 * `linear-gauge`: a rail with a track, an optional span and an optional marker, placed by `layoutGauge`, the arithmetic the contract's corpus pins (the
 * app's `UKWeatherRailView`, made generic). A change glides unless Reduce Motion is on or the gauge says it does not animate. Read as one `meter` when its
 * `a11y` names it, else hidden.
 */
export function GaugeNode({ node }: { node: NodeOf<'linear-gauge'> }) {
  const { props, a11y } = node;
  const height = props.height ?? 12;
  const [track, width] = useWidth<HTMLDivElement>(200);
  const value = useNumber(props.value);
  const start = useNumber(props.span?.start), size = useNumber(props.span?.size);
  const markerSize = props.marker?.size ?? 12;
  const rtl = typeof getComputedStyle === 'function' && track.current ? getComputedStyle(track.current).direction === 'rtl' : false;
  const layout = layoutGauge({ fill: props.fill, scale: props.scale, value: props.marker ? value : null, span: { start, size }, width, markerSize, rtl });
  const stops = props.stops.map(stop => `${inkColor(stop.ink)} ${stop.at * 100}%`).join(', ');
  const border = props.marker?.border;
  const label = useOperand(a11y.element === 'value' ? a11y.label : undefined, '', `${node.id}/label`);
  const text = useOperand(a11y.element === 'value' ? a11y.value : undefined, '', `${node.id}/value`);
  const percent = layout.marker ? Math.round(layout.marker.percent) : undefined;
  const style = { '--gauge-height': `${height}px`, background: inkColor(props.track), borderRadius: height / 2 } as CSSProperties;
  const meter = a11y.element === 'value'
    ? { role: 'meter', 'aria-label': label.text, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': text.text || (percent === undefined ? undefined : `${percent}%`) }
    : { 'aria-hidden': true as const };
  return <div className="sh-gauge" ref={track} data-fill={props.fill} data-animates={props.animates === false ? 'false' : 'true'} style={style} {...meter}>
    {layout.span && <span className="sh-gauge-span" style={{ left: layout.span.left, width: layout.span.width, background: `linear-gradient(${rtl ? 'to left' : 'to right'}, ${stops})`, borderRadius: height / 2 }}/>}
    {layout.marker && props.marker && <span className="sh-gauge-marker" style={{
      left: layout.marker.left, top: (height - markerSize) / 2, width: markerSize, height: markerSize, background: inkColor(props.marker.ink),
      boxShadow: border ? `inset 0 0 0 ${border.width}px ${inkColor(border.ink)}` : undefined,
    }}/>}
  </div>;
}
