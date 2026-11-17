import { useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  axisLevels, axisText, barMarks, ceilingDomain, labelCadence, labelIndices, peakOf, pointMarks, seriesText, twoStepDomain,
} from '../../shared/composition/chart-math';
import { inkColor } from '../../shared/composition/ink-css';
import { sourcePoints, type ChartPoint } from '../../shared/composition/chart-source';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import type { ChartSeries, CompositionDocument } from '../../shared/composition/schema';
import { ListContext, type RecordsAnswer } from '../flow-records';
import { useRender } from '../render-context';
import { useOperand, type NodeOf } from './shared';
import { useNumber, useWidth } from './plot';
import './chart.css';

// MARK: Chart (`sh.chart@1`)

/** One point as drawn: its label under the plot and its value, `null` where unknown. */
type Point = ChartPoint;
/** The points of a literal series: the ones the document writes. A `source` series is read from records instead (`SourceChart`, `ListChart`). */
function literalPoints(series: ChartSeries): Point[] {
  return series.type === 'literal' ? series.points.map(point => ({ label: point.label, value: point.value })) : [];
}

/**
 * `chart` (`sh.chart@1`). A literal series is drawn as written. A `source` series reads the records of a records flow, run by the host as for a `repeat`
 * (`providerId`), or of the repeat the chart sits in (no `providerId`); until there are records the chart draws its empty text.
 */
export function ChartNode({ node }: { node: NodeOf<'chart'> }) {
  const series = node.props.series;
  if (series.type === 'literal') return <ChartDrawing node={node} points={literalPoints(series)}/>;
  return series.providerId === undefined ? <ListChart node={node}/> : <SourceChart node={node} sourceId={series.providerId}/>;
}

/** A chart over the list of the repeat it sits in. */
function ListChart({ node }: { node: NodeOf<'chart'> }) {
  const list = useContext(ListContext);
  const { env } = useRender();
  const series = node.props.series as Extract<ChartSeries, { type: 'source' }>;
  const points = useMemo(() => list ? sourcePoints(series, list, env) : [], [series, list, env]);
  return <ChartDrawing node={node} points={points}/>;
}

/** A chart over the flow `sourceId`: the host's hook runs for the same flow on every render, so this is a component of its own. */
function Fed({ node, sourceId, inputs, use }: { node: NodeOf<'chart'>; sourceId: string; inputs: PipelineInputs; use: (id: string, inputs: PipelineInputs) => RecordsAnswer }) {
  const { env } = useRender();
  const answer = use(sourceId, inputs);
  const series = node.props.series as Extract<ChartSeries, { type: 'source' }>;
  const points = useMemo(() => answer.state === 'ready' ? sourcePoints(series, answer.records, env) : [], [series, answer, env]);
  return <ChartDrawing node={node} points={points}/>;
}

/** A chart over a named flow: with no host or no such flow it draws as it does with no data. */
function SourceChart({ node, sourceId }: { node: NodeOf<'chart'>; sourceId: string }) {
  const { records } = useRender();
  const source = records?.sources.find((entry: CompositionDocument['dataSources'][number]) => entry.id === sourceId);
  const inputs = source && source.kind === 'model' && source.model === 'pipeline@1' ? source.inputs as PipelineInputs : undefined;
  if (records && inputs) return <Fed node={node} sourceId={sourceId} inputs={inputs} use={records.use}/>;
  return <ChartDrawing node={node} points={[]}/>;
}

/** A bar or a line chart's whole drawing: the axis labels, the plot and the labels under it, from the same arithmetic the contract's corpus pins. */
function ChartDrawing({ node, points }: { node: NodeOf<'chart'>; points: Point[] }) {
  const { props } = node;
  const { mark, domain: domainProps } = props;
  const values = points.map(point => point.value);
  const label = useOperand(node.a11y.label, '', `${node.id}/label`);
  const minimumStep = useNumber(domainProps.type === 'two-step' ? domainProps.minimumStep : undefined);
  const peak = peakOf(values);
  const known = peak !== undefined;

  // The axis: the top and base of the value scale, and how many places its labels have.
  let top = 0, base = 0, computedDigits = 0;
  if (domainProps.type === 'ceiling') top = ceilingDomain(peak, domainProps.step, domainProps.min, domainProps.max);
  else if (domainProps.type === 'fixed') { top = domainProps.max; base = domainProps.min; }
  else {
    const axis = twoStepDomain(peak, minimumStep ?? 0.01, domainProps.maximumFractionDigits ?? 3, domainProps.factors);
    top = axis.domain; computedDigits = axis.digits;
  }
  const axisProps = props.axis;
  const pattern = axisProps?.label?.pattern ?? '{value}';
  const digits = axisProps?.label?.digits ?? computedDigits;
  const levels = axisProps ? axisLevels(axisProps.levels, top, base) : [];
  const spoken = seriesText(points, pattern, digits, props.emptyText);

  const height = props.height ?? 76;
  const [plot, width] = useWidth<HTMLDivElement>(300);
  const gap = props.bar?.gap ?? 2;
  const minimum = props.bar?.minimum ?? 2;
  const radius = props.bar?.radius ?? 2;
  const bars = mark === 'bar' ? barMarks(values, top, base, width, height, gap, minimum) : [];
  const dots = mark === 'bar' ? [] : pointMarks(values, top, base, width, height);

  // Labels under the plot: every one is laid out so the widest can be measured; the thinned ones are hidden.
  const row = useRef<HTMLDivElement>(null);
  const [widest, setWidest] = useState(0);
  useLayoutEffect(() => {
    const widths = [...(row.current?.querySelectorAll<HTMLElement>('.sh-chart-xlabel') ?? [])].map(item => item.offsetWidth);
    const next = Math.max(0, ...widths);
    setWidest(old => old === next ? old : next);
  });
  const estimate = Math.max(0, ...points.map(point => point.label.length)) * 7.2;
  const mode = props.labels ?? 'fit';
  const cadence = mode === 'all' ? 1 : labelCadence(points.length, width, widest || estimate);
  const shown = new Set(mode === 'none' ? [] : labelIndices(points.length, cadence));
  const slot = width / Math.max(points.length, 1);

  const tint = inkColor(props.tint);
  const style = { '--chart-height': `${height}px`, '--chart-tint': tint, '--chart-grid': inkColor(axisProps?.gridInk), '--chart-label': inkColor(axisProps?.labelInk), '--chart-unknown': inkColor(props.bar?.unknownInk) } as CSSProperties;
  if (!points.length || !known) {
    return <div className="sh-chart sh-chart-empty" data-mark={mark} data-series={props.series.type} role="group" aria-label={label.text} style={style}>
      <p className="sh-chart-empty-text" data-state="unavailable">{props.emptyText}</p>
    </div>;
  }
  const strokeWidth = props.line?.width ?? 2;
  // A line breaks where a value is unknown: one run of points per stretch of known values.
  const runs: { x: number; y: number }[][] = [];
  for (const point of dots) {
    if (point.y === null) runs.push([]);
    else { if (!runs.length) runs.push([]); runs[runs.length - 1].push({ x: point.x, y: point.y }); }
  }
  const drawn = runs.filter(run => run.length > 0);
  const line = (run: { x: number; y: number }[]) => run.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = (run: { x: number; y: number }[]) => `${line(run)} L${run[run.length - 1].x.toFixed(2)} ${height} L${run[0].x.toFixed(2)} ${height} Z`;
  return <div className="sh-chart" data-mark={mark} data-series={props.series.type} data-cadence={cadence} role="group" aria-label={label.text} style={style}>
    <div className="sh-chart-visual" aria-hidden="true">
      <div className="sh-chart-axis" style={{ height }}>{levels.map((value, index) => <span key={index} className="sh-chart-ylabel">{axisProps?.label ? axisText(pattern, value, digits) : ''}</span>)}</div>
      <div className="sh-chart-plot" ref={plot} style={{ height }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} focusable="false">
          {axisProps && Array.from({ length: axisProps.levels }, (_, index) => <rect key={index} className="sh-chart-grid" x={0} y={height * index / axisProps.levels} width={width} height={1}/>)}
          {mark === 'bar' && bars.map(bar => <rect key={bar.index} className={bar.unknown ? 'sh-chart-bar sh-chart-bar-unknown' : 'sh-chart-bar'} data-index={bar.index}
            x={bar.x} y={height - bar.height} width={bar.width} height={bar.height} rx={Math.min(radius, bar.width / 2, bar.height / 2)}/>)}
          {mark === 'area' && drawn.map((run, index) => <path key={`a${index}`} className="sh-chart-area" d={area(run)}/>)}
          {mark !== 'bar' && drawn.map((run, index) => <path key={`l${index}`} className="sh-chart-line" d={line(run)} strokeWidth={strokeWidth}/>)}
          {mark !== 'bar' && props.line?.dots && dots.filter(point => point.y !== null).map(point => <circle key={point.index} className="sh-chart-dot" cx={point.x} cy={point.y!} r={Math.max(2, strokeWidth * 1.25)}/>)}
        </svg>
      </div>
      {mode !== 'none' && <div className="sh-chart-xlabels" ref={row} style={{ width }}>
        {points.map((point, index) => <span key={index} className="sh-chart-xlabel" data-shown={shown.has(index) ? '' : undefined}
          style={{ left: mark === 'bar' ? index * slot : (index + 0.5) * slot, transform: mark === 'bar' ? undefined : 'translateX(-50%)' }}>{point.label}</span>)}
      </div>}
    </div>
    <span className="sh-chart-series sh-visually-hidden">{spoken}</span>
  </div>;
}
