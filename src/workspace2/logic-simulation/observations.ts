import type { Json } from '../../shared/types';
import type { GraphNode, SimulationCase, SimulationPin, SimulationResult, TraceEvent } from '../../shared/composition/graph/types';
import type { SimulationRun } from './engine';
import { anchorKey } from './contracts';
import { blockMode, blockSources, sourceCaptureForNode, type SimulationProgram } from './program';
import { sourceKey } from './contracts';
import { formatValue } from '../canvas/value-format';
import { itemContextText, noItemsText, type ItemContext } from './per-item';
import { generatedName } from '../canvas/blocks';

export interface ObservedValue {
  readonly observed: boolean;
  readonly value?: Json;
  readonly result?: SimulationResult;
  readonly source: 'live' | 'pinned' | 'scenario' | 'mixed';
  readonly mode: 'Live' | 'Simulated' | 'Mixed';
  readonly state: 'known' | 'unavailable' | 'cant-tell' | 'loading' | 'not-observed';
  readonly freshness: 'live' | 'captured' | 'held' | 'sample';
  readonly pinned: boolean;
  /** Undefined means the keep decision wasn't observed, not false. */
  readonly kept?: boolean;
  readonly item?: ItemContext;
}
export interface PortObservation extends ObservedValue {
  readonly portId: string;
  readonly direction: 'input' | 'output';
}
export interface BlockObservation extends ObservedValue {
  readonly blockId: string;
  readonly ports: readonly PortObservation[];
}
export interface CanvasObservations {
  readonly blocks: Readonly<Record<string, BlockObservation>>;
  /** Completed root answers, including flow roots without an expression callback. */
  readonly results?: Readonly<Record<string, ObservedValue>>;
  /** Actual callback completion order, followed by each root's native text-policy result. */
  readonly order: readonly string[];
  readonly truncated: boolean;
}
function answer(result: SimulationResult | undefined, sourceRead = false) {
  if (!result) return { observed: false, state: 'not-observed' as const };
  if (result.kind === 'condition') return {
    observed: true, result, value: result.answer, state: result.answer === 'unknown' ? 'cant-tell' as const : 'known' as const,
  };
  if (result.answer.status !== 'value') return { observed: true, result,
    state: !sourceRead && result.answer.status === 'unavailable' ? 'cant-tell' as const : result.answer.status };
  return { observed: true, result, value: result.answer.value as Json,
    state: sourceRead && result.answer.value === 'unavailable' ? 'unavailable' as const : sourceRead && result.answer.value === 'unknown' ? 'cant-tell' as const : 'known' as const };
}

export function formatObservedValue(observation?: ObservedValue, rows = false): string {
  if (!observation?.observed) return observation?.item?.count === 0 ? noItemsText(observation.item) : 'Not observed';
  const value = observation.result?.kind === 'condition' ? observation.value === 'yes' : observation.value;
  if (observation.state === 'known' && value !== undefined) return formatValue(value, { rows });
  const state = observation.state === 'unavailable' ? 'Unavailable' : observation.state === 'loading' ? 'Loading' : "Can't tell";
  return observation.kept && value !== undefined ? `${state}; Kept: ${formatValue(value, { rows })}` : state;
}
/** Pure projection of a completed run. No evaluator, environment, request or cost meter is invoked. */
export function canvasObservations(program: SimulationProgram, run: SimulationRun, options: {
  readonly pins?: readonly SimulationPin[];
  readonly localPins?: readonly SimulationPin[];
  readonly scenario?: SimulationCase;
  readonly clockPinned?: boolean;
  readonly localClockPinned?: boolean;
  readonly liveClock?: boolean;
  readonly freshness?: 'live' | 'held' | 'sample';
  readonly liveBlocks?: ReadonlySet<string>;
  readonly previousText?: SimulationCase['base']['previousText'];
  readonly blockNames?: Readonly<Record<string, string>>;
} = {}): CanvasObservations {
  const pins = options.pins ?? [], blocks: Record<string, BlockObservation> = {}, results: Record<string, ObservedValue> = {}, order: string[] = [];
  const liveSources = new Set(program.roots.flatMap(root => root.graph.nodes.filter(node => options.liveBlocks?.has(node.id))).flatMap(node => {
    const source = sourceCaptureForNode(node, program);
    return source ? [sourceKey(source)] : [];
  }));
  const readsSource = (node: GraphNode) => {
    const source = sourceCaptureForNode(node, program);
    return Boolean(source && !program.flows.has(source.sourceId));
  };
  const provenance = (node: GraphNode) => {
    const sources = blockSources(program, node, pins, false, Boolean(options.clockPinned), options.liveBlocks);
    const localSources = blockSources(program, node, options.localPins ?? (options.scenario ? [] : pins), false, Boolean(options.localClockPinned ?? (!options.scenario && options.clockPinned)), options.liveBlocks);
    const source = sources.size > 1 ? 'mixed' : sources.has('pin') ? localSources.has('pin') ? 'pinned' : options.scenario ? 'scenario' : 'pinned'
      : sources.has('scenario') ? 'scenario' : 'live';
    const mode = blockMode(program, node, pins, Boolean(options.scenario), Boolean(options.clockPinned), options.liveBlocks);
    const sourceRead = sourceCaptureForNode(node, program);
    const pinned = pins.some(pin => pin.kind === 'source' ? sourceRead && sourceKey(pin) === sourceKey(sourceRead) : pin.blockId === node.id)
      || Boolean(options.clockPinned && node.payload.kind === 'operand' && node.payload.value.type === 'clock');
    const liveOverride = options.liveBlocks?.has(node.id) || sourceRead && liveSources.has(sourceKey(sourceRead))
      || options.liveClock && node.payload.kind === 'operand' && node.payload.value.type === 'clock';
    return { source, mode, pinned, freshness: options.scenario && !liveOverride ? 'captured' : options.freshness ?? 'live' } as const;
  };
  for (const root of program.roots) {
    const output = run.outputs.find(output => anchorKey(output.output) === anchorKey(root.anchor));
    const itemReading = (blockId: string, event?: TraceEvent): { item?: ItemContext } => {
      const context = output?.perItem?.contexts[blockId];
      if (!context) return {};
      const step = root.graph.nodes.find(node => node.id === context.stepId), name = options.blockNames?.[context.stepId];
      const suffix = step && `, ${generatedName(step, root.graph)}`;
      // Preview lenses retain block identities but may omit annotations. The host supplies the current canvas display names.
      const title = name && suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name ?? context.step;
      return { item: { step: title, count: context.count, ...(event?.item ? { index: event.item.index } : {}) } };
    };
    for (const node of root.graph.nodes) {
      const events = output?.trace.events.filter(event => event.blockId === node.id) ?? [];
      const executed = events.filter(event => event.output);
      const event = executed.find(event => event.item) ?? executed.at(-1)
        ?? output?.perItem?.trace.events.filter(event => event.blockId === node.id && event.output).at(-1);
      const context = output?.perItem?.contexts[node.id];
      const item = itemReading(node.id, event);
      const sourceRead = readsSource(node);
      const isRoot = root.graph.roots.some(candidate => candidate.nodeId === node.id);
      const resolved = isRoot && root.body.kind === 'slot' ? output?.result : event?.output;
      const seed = options.previousText?.find(seed => anchorKey(seed.output) === anchorKey(root.anchor));
      const expressionPointer = root.body.kind === 'slot' && root.body.value.type === 'expr' ? '/value' : '';
      const unresolved = output?.trace.events.filter(event => event.pointer === expressionPointer && event.output?.kind === 'operand').at(-1)?.output;
      const kept = isRoot && root.body.kind === 'slot' && unresolved?.kind === 'operand' && resolved?.kind === 'operand'
        ? unresolved.answer.status === 'value' ? false
          : resolved.answer.status === 'value' && seed !== undefined && resolved.answer.value === seed.text
            && (unresolved.answer.status === 'loading' || root.body.value.type !== 'literal' && root.body.value.whenUnavailable === 'keep')
        : undefined;
      const common = provenance(node);
      const ports: PortObservation[] = [
        ...node.outputs.map(port => {
          // A single output is unambiguous. Multi-output nodes require a real matching port callback.
          const result = node.outputs.length === 1 ? resolved : events.filter(event => event.portId === port.id).at(-1)?.output;
          return { portId: port.id, direction: 'output' as const, ...common, ...answer(result, sourceRead), ...item, ...(kept === undefined ? {} : { kept }) };
        }),
        ...node.inputs.map(port => {
          const edge = root.graph.edges.find(edge => edge.to.nodeId === node.id && edge.to.portId === port.id);
          const upstream = edge && root.graph.nodes.find(candidate => candidate.id === edge.from.nodeId);
          const contextualInput = node.payload.kind === 'step' || node.catalogKey === 'output.rows';
          const upstreamEvents = upstream && output?.trace.events.filter(event => event.blockId === upstream.id && event.output);
          const reading = upstream && (context?.count === 0 || contextualInput)
            ? upstreamEvents?.find(event => event.item) ?? output?.perItem?.trace.events.find(event => event.blockId === upstream.id && event.output) : undefined;
          const recorded = event?.inputs.find(input => input.portId === port.id || `/${input.portId}` === port.id)?.result;
          const result = recorded ?? reading?.output;
          const inputItem = !recorded && upstream && contextualInput ? itemReading(upstream.id, reading) : item;
          return { portId: port.id, direction: 'input' as const, ...(upstream ? provenance(upstream) : common),
            ...answer(result, upstream ? readsSource(upstream) : sourceRead), ...inputItem };
        }),
      ];
      blocks[node.id] = { blockId: node.id, ...common, ...answer(resolved, sourceRead), ...item, ...(kept === undefined ? {} : { kept }), ports };
      if (isRoot) results[node.id] = { ...common, ...answer(output?.result, sourceRead), ...(kept === undefined ? {} : { kept }) };
    }
    for (const event of output?.trace.events ?? []) if (event.output && !order.includes(event.blockId)) order.push(event.blockId);
    if (root.body.kind === 'slot' && output?.result) for (const rootNode of root.graph.roots) if (!order.includes(rootNode.nodeId)) order.push(rootNode.nodeId);
  }
  return { blocks, results, order, truncated: run.outputs.some(output => output.trace.truncated || output.perItem?.trace.truncated) };
}
export { itemContextText };
