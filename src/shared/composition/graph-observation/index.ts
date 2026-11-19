import type { Json } from '../../types';
import type { EvaluationEvent, EvaluationObserver, ObservedRead, Tri } from '../evaluator';
import type { LogicAnchor, SimulationClock, SimulationResult, TraceEvent } from '../graph/types';
import type { PipelineObservation } from '../pipeline/operands';
import { pointer } from '../json';

export interface IterationRow {
  readonly blockId: string;
  readonly index: number;
  readonly identity?: string;
  readonly item?: Json;
  readonly result?: Tri;
  readonly included: boolean;
  readonly reason: string;
  readonly position?: number;
  readonly reads?: readonly ObservedRead[];
  readonly tested?: readonly { readonly pointer: string; readonly result: SimulationResult }[];
}
export interface StepObservation {
  readonly blockId: string;
  readonly id: string;
  readonly op: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly input: Json;
  readonly output: Json;
  readonly truncated: boolean;
}
export interface ObservationReport {
  events: TraceEvent[];
  iterations: IterationRow[];
  steps: StepObservation[];
  truncated: boolean;
}
const identityOf = (item: Json | undefined): string | undefined => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const found = item.entityId ?? item.uid ?? item.id;
  return typeof found === 'string' ? found : undefined;
};
/** A bounded evidence copy; counts are always taken before this display-only cut. */
export function evidenceValue(value: Json, depth = 0): Json {
  if (depth > 8) return '[Trace depth limit]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)} [truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => evidenceValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, evidenceValue(item, depth + 1)]));
  return value;
}
const boundedResult = (result: SimulationResult): SimulationResult => result.kind === 'condition' || result.answer.status !== 'value'
  ? result : { kind: 'operand', answer: { status: 'value', value: evidenceValue(result.answer.value as Json) } };

/** Consumes observations from one evaluation. It never evaluates, reads an environment, or spends a budget. */
export function createObservation(options: {
  readonly runId: string;
  readonly root: LogicAnchor;
  readonly ast: Json;
  readonly clock: SimulationClock;
  readonly locate: (pointer: string) => { blockId: string; portId?: string; pointer?: string };
  readonly provenance: (pointer: string) => TraceEvent['provenance'];
  readonly overridden?: ReadonlySet<string>;
  readonly maxEvents?: number;
}) {
  const locations = new WeakMap<object, string>();
  const childrenOf = new Map<string, string[]>(), evaluated = new Map<string, TraceEvent>();
  const index = (value: Json, at: string, parent?: string) => {
    if (!value || typeof value !== 'object') return;
    locations.set(value, at);
    const expression = !Array.isArray(value) && typeof value.type === 'string';
    if (expression && parent !== undefined) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), at]);
    for (const [key, child] of Object.entries(value)) index(child, pointer(at, key), expression ? at : parent);
  };
  index(options.ast, '');
  const report: ObservationReport = { events: [], iterations: [], steps: [], truncated: false };
  const evidence = (value: Json): Json => {
    const copy = evidenceValue(value);
    if (JSON.stringify(copy) !== JSON.stringify(value)) report.truncated = true;
    return copy;
  };
  const limit = options.maxEvents ?? 2000;
  const room = (count = 1) => {
    if (report.events.length + report.iterations.length + report.steps.length + count <= limit) return true;
    report.truncated = true; return false;
  };
  const evaluation: EvaluationObserver = (event: EvaluationEvent) => {
    if (!room()) return;
    const at = locations.get(event.node);
    if (at === undefined) return;
    const location = options.locate(at);
    if (event.kind === 'count-entry') {
      report.iterations.push({
        blockId: location.blockId, index: event.index, included: event.result === 'yes', result: event.result,
        ...(event.reads?.length ? {
          identity: [...new Set(event.reads.map(read => read.sourceId))].join(', '),
          reads: event.reads.map(read => ({ ...read, ...(read.path ? { path: [...read.path] } : {}), answer: read.answer.status === 'value'
            ? { status: 'value', value: evidence(read.answer.value) } : { status: read.answer.status } })),
        } : {}),
        tested: [...evaluated].filter(([key, trace]) => key.startsWith(`${at}/of/${event.index}/test|`) && trace.output)
          .map(([, trace]) => ({ pointer: trace.pointer, result: trace.output! })),
        reason: event.reason === 'viewer-excluded' ? 'Viewer excluded'
          : event.reason === 'viewer-loading' ? 'Viewer loading'
            : event.result === 'yes' ? 'Yes - counted' : event.result === 'no' ? 'No - not counted' : "Can't Tell - missing or loading input",
      });
      return;
    }
    const output: SimulationResult = event.kind === 'operand'
      ? { kind: 'operand', answer: event.result } : { kind: 'condition', answer: event.result };
    const children = (childrenOf.get(at) ?? []).flatMap(path => {
      const child = evaluated.get(`${path}|${event.index ?? ''}`);
      return child ? [child] : [];
    });
    const bounded = boundedResult(output);
    if (JSON.stringify(bounded) !== JSON.stringify(output)) report.truncated = true;
    const trace: TraceEvent = {
      runId: options.runId, root: options.root, blockId: location.blockId, pointer: location.pointer ?? at, portId: location.portId,
      ...(event.index === undefined ? {} : { item: { index: event.index, identity: identityOf(event.item) } }),
      inputs: children.filter(child => child.output).map(child => ({ portId: child.pointer.slice(at.length + 1), result: child.output! })),
      output: bounded, provenance: options.provenance(at),
      state: options.overridden?.has(at) ? 'overridden' : 'evaluated',
      ...(options.overridden?.has(at) ? { reason: 'Explicit computed-output override; upstream was not evaluated' } : {}),
      clock: options.clock, cost: event.cost ?? { used: 0, limit: 0 },
    };
    report.events.push(trace);
    evaluated.set(`${at}|${event.index ?? ''}`, trace);
  };
  const pipeline = (event: PipelineObservation) => {
    if (!room(event.kind === 'step' ? 2 : 1)) return;
    const at = locations.get(event.step);
    if (at === undefined) return;
    const location = options.locate(at), { blockId } = location;
    if (event.kind === 'step') {
      const input = evidenceValue(event.input), output = evidenceValue(event.output);
      const truncated = JSON.stringify(input) !== JSON.stringify(event.input) || JSON.stringify(output) !== JSON.stringify(event.output);
      report.truncated ||= truncated;
      report.steps.push({
        blockId, id: event.step.id, op: event.step.op,
        before: Array.isArray(event.input) ? event.input.length : null, after: Array.isArray(event.output) ? event.output.length : null,
        input, output, truncated,
      });
      report.events.push({
        runId: options.runId, root: options.root, blockId, pointer: location.pointer ?? at, inputs: [{ portId: 'stream', result: { kind: 'operand', answer: { status: 'value', value: input } } }],
        output: { kind: 'operand', answer: { status: 'value', value: output } }, provenance: options.provenance(at),
        state: 'evaluated', clock: options.clock, cost: { used: event.used, limit: event.limit },
      });
    } else if (event.kind === 'item') {
      report.iterations.push({
        blockId, index: event.index, identity: identityOf(event.item), item: evidence(event.item),
        included: event.included, reason: event.field ? `${event.field}: ${event.reason}` : event.reason,
        tested: [{ pointer: event.field ? `${location.pointer ?? at}/fields/${event.field}` : location.pointer ?? at,
          result: { kind: 'operand', answer: { status: 'value', value: evidence(event.value) } } }],
      });
    } else {
      report.iterations.push({
        blockId, index: event.index, identity: identityOf(event.item), item: evidence(event.item),
        included: event.kind === 'sort' || event.kept,
        ...(event.kind === 'filter' ? { result: event.kept ? 'yes' : 'no', reason: event.kept ? 'Condition Yes - kept' : 'Condition No - dropped (flow gaps are null)' }
          : { position: event.position, reason: `Sorted from ${event.index + 1} to ${event.position + 1}` }),
      });
    }
  };
  return { report, evaluation, pipeline };
}
