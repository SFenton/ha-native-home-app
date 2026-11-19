import type { Json } from '../../shared/types';
import {
  evaluateOperand, evaluatePredicate, resolveText, unavailable, value, valueAt,
  type Environment, type ReadResult,
} from '../../shared/composition/evaluator';
import type { Operand, Predicate } from '../../shared/composition/expression';
import type { LogicAnchor, SimulationCase, SimulationClock, SimulationPin, SimulationResult } from '../../shared/composition/graph/types';
import { atPointer, copy, replaceAt } from '../../shared/composition/graph/json';
import { canonicalCompositionJSON } from '../../shared/composition/json';
import { evaluatePipeline, pipelineInputsSchema, type RunResult } from '../../shared/composition/pipeline';
import { createObservation, type ObservationReport } from '../../shared/composition/graph-observation';
import { trimSample } from '../data/samples';
import { anchorKey, caseSchema, clockSchema, pinKey, readKey, sourceKey } from './contracts';
import { blockSources, flowFingerprint, nodeFor, pinProblems, sourceCaptureForNode, walkJSON, type SimulationProgram, type SimulationRoot } from './program';

export interface HeldSnapshot {
  readonly base: SimulationCase['base'];
  readonly at: string;
  readonly stale?: boolean;
  readonly error?: string;
  readonly origin?: 'live' | 'sample';
}
export interface OutputAnswer {
  readonly output: LogicAnchor;
  readonly result?: SimulationResult;
  readonly source: 'Live' | 'Held/stale' | 'Sample' | 'Scenario' | 'Pinned' | 'Mixed';
  readonly at: string;
  readonly issues: readonly string[];
  readonly trace: ObservationReport;
  readonly flow?: RunResult;
}
export interface SimulationRun {
  readonly mode: 'Live' | 'Simulated';
  readonly modified: boolean;
  readonly outputs: readonly OutputAnswer[];
  readonly issues: readonly string[];
}
const clone = <T>(input: T): T => structuredClone(input);
const emptyReport = (): ObservationReport => ({ events: [], iterations: [], steps: [], truncated: false });
export const mergePins = (base: readonly SimulationPin[], local: readonly SimulationPin[]): SimulationPin[] => {
  const pins = new Map(base.map(pin => [pinKey(pin), pin]));
  local.forEach(pin => pins.set(pinKey(pin), pin));
  return [...pins.values()];
};
/** A captured environment has no network capability and no reference to LiveHouse. */
export function capturedEnvironment(base: SimulationCase['base'], pins: readonly SimulationPin[], clock: SimulationClock, gaps: Set<string>): Environment {
  const reads = new Map(base.reads.map(read => [readKey(read), clone(read.answer) as ReadResult]));
  for (const pin of pins) {
    if (pin.kind !== 'source') continue;
    reads.set(readKey(pin), clone(pin.answer) as ReadResult);
    if ((pin.access ?? 'read') === 'read' && pin.path?.length === 1 && pin.path[0] === 'state') {
      reads.set(readKey({ sourceId: pin.sourceId, access: 'raw-state' }), clone(pin.answer) as ReadResult);
    } else if (pin.access === 'raw-state') reads.set(readKey({ sourceId: pin.sourceId, path: ['state'] }), clone(pin.answer) as ReadResult);
  }
  const read = (key: string) => {
    const answer = reads.get(key);
    if (!answer) gaps.add(`Missing captured input: ${key}`);
    return answer ?? unavailable;
  };
  return {
    read: (sourceId, path) => read(readKey({ sourceId, path })),
    readRaw: sourceId => read(readKey({ sourceId, access: 'raw-state' })),
    readChanged: sourceId => read(readKey({ sourceId, access: 'last-changed' })),
    viewer: base.viewer ? clone(base.viewer) : undefined,
    viewerPersonState: () => {
      if (!base.viewerPerson) gaps.add('Missing captured viewer person state.');
      return base.viewerPerson ? clone(base.viewerPerson) as ReadResult : unavailable;
    },
    clock,
  };
}
function prepared(root: SimulationRoot, pins: readonly SimulationPin[]) {
  let ast = copy(root.body.value as Json);
  const overridden = new Set<string>(), synthetic = new Map<string, ReadResult>();
  const sourceIds = new Set<string>();
  walkJSON(root.body.value, record => { if (typeof record.sourceId === 'string') sourceIds.add(record.sourceId); });
  for (const pin of pins) {
    if (pin.kind !== 'output') continue;
    const locations = root.sourceMap.filter(location => location.nodeId === pin.blockId && location.portId === pin.portId);
    const paths = [...new Set(locations.map(location => location.pointer))].filter(at => {
      const node = nodeFor(root, at);
      const fragment = atPointer(root.body.value as Json, at);
      return node && ['operand', 'condition', 'logic-ref'].includes(node.payload.kind)
        && fragment && typeof fragment === 'object' && !Array.isArray(fragment) && 'type' in fragment && typeof fragment.type === 'string';
    }).sort((a, b) => a.length - b.length);
    for (const at of paths) {
      if ([...overridden].some(parent => at.startsWith(`${parent}/`))) continue;
      let suffix = synthetic.size;
      while (sourceIds.has(`studio-pin-${suffix}`)) suffix++;
      const sourceId = `studio-pin-${suffix}`;
      sourceIds.add(sourceId);
      const answer: ReadResult = pin.result.kind === 'condition'
        ? pin.result.answer === 'unknown' ? unavailable : value(pin.result.answer === 'yes')
        : clone(pin.result.answer) as ReadResult;
      synthetic.set(sourceId, answer);
      const operand: Operand = answer.status === 'value' ? { type: 'literal', value: answer.value }
        : { type: 'read', from: { type: 'source', sourceId, path: [] }, as: 'boolean', missing: 'unavailable' };
      const replacement: Operand | Predicate = pin.result.kind === 'condition'
        ? { type: 'compare', op: 'eq', left: operand, right: { type: 'literal', value: true } } : operand;
      ast = replaceAt(ast, at, replacement as Json);
      overridden.add(at);
    }
  }
  return { ast, overridden, synthetic };
}
function pinEntityRows(program: SimulationProgram, response: Json, pins: readonly SimulationPin[]): Json {
  if (!Array.isArray(response)) return response;
  return response.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    let out = row;
    for (const pin of pins) {
      if (pin.kind !== 'source' || program.sourceEntities[pin.sourceId] !== row.entityId || pin.access === 'last-changed') continue;
      const path = pin.access === 'raw-state' ? ['state'] : pin.path ?? [];
      const key = path.length === 1 && path[0] === 'state' ? 'state' : path.length === 2 && path[0] === 'attributes' ? path[1] : undefined;
      if (key && Object.hasOwn(row, key)) out = { ...out, [key]: pin.answer.status === 'value' ? copy(pin.answer.value) : null };
    }
    return out;
  });
}
/** One synchronous run; every flow and root sees this one frozen capture and clock. */
export function runSimulation(program: SimulationProgram, held: HeldSnapshot, options: {
  readonly scenario?: SimulationCase;
  readonly pins?: readonly SimulationPin[];
  readonly clock?: SimulationClock;
  readonly liveClock?: boolean;
  readonly observe?: boolean;
  readonly runId?: string;
  /** Explicit per-source Live selection reads the held capture, never the network. Run All never supplies this. */
  readonly liveBlocks?: ReadonlySet<string>;
} = {}): SimulationRun {
  const scenario = options.scenario ? caseSchema.parse(options.scenario) : undefined;
  const liveSources = program.roots.flatMap(root => root.graph.nodes.filter(node => options.liveBlocks?.has(node.id)))
    .flatMap(node => { const read = sourceCaptureForNode(node, program); return read ? [read] : []; });
  const pins = mergePins((scenario?.pins ?? []).filter(pin => !options.liveBlocks?.has(pin.blockId)
    && !(pin.kind === 'source' && liveSources.some(read => sourceKey(read) === sourceKey(pin)))), options.pins ?? []);
  const issues = pinProblems(program, pins);
  if (scenario && scenario.fingerprint !== program.fingerprint) issues.push('Needs review: canonical logic changed since capture.');
  const captured = clone(scenario?.base ?? held.base), base = { ...captured, reads: [...captured.reads] };
  for (const read of liveSources) {
    base.reads = base.reads.filter(capture => sourceKey(capture) !== sourceKey(read));
    base.reads.push(...held.base.reads.filter(capture => sourceKey(capture) === sourceKey(read)).map(clone));
  }
  const clock = clockSchema.parse(options.liveClock ? held.base.clock : options.clock ?? scenario?.clock ?? base.clock);
  const simulated = Boolean(scenario || pins.length || options.clock);
  const outputs: OutputAnswer[] = [];
  const flowAnswers = new Map<string, { result?: RunResult; trace: ObservationReport; issues: string[] }>(), pending = new Set<string>();
  const gaps = new Set<string>();
  const environment = capturedEnvironment(base, pins, clock, gaps);
  if (scenario) for (const required of program.reads) {
    if (program.flows.has(required.sourceId)) continue;
    if (!base.reads.some(read => readKey(read) === readKey(required)) && !pins.some(pin => pin.kind === 'source' && readKey(pin) === readKey(required))) {
      issues.push(`Missing required captured input: ${readKey(required)}`);
    }
  }
  const readBase = environment.read;
  const runFlow = (sourceId: string): { result?: RunResult; trace: ObservationReport; issues: string[] } => {
    const existing = flowAnswers.get(sourceId);
    if (existing) return existing;
    const inputs = program.flows.get(sourceId);
    const ownIssues: string[] = [];
    if (!inputs || pending.has(sourceId)) return { trace: emptyReport(), issues: [`Missing or cyclic captured flow: ${sourceId}`] };
    pending.add(sourceId);
    const response = base.flowResponses.find(capture => capture.sourceId === sourceId && capture.requestFingerprint === flowFingerprint(inputs));
    if (inputs.request.type !== 'none' && !response) ownIssues.push(`Missing captured flow response: ${sourceId}`);
    if (response?.trimmed) ownIssues.push(`Truncated capture: ${sourceId}; exact full-list/count expectations are incomplete.`);
    const root = program.roots.find(root => root.body.kind === 'flow' && root.body.sourceId === sourceId);
    const overlay = root ? prepared(root, pins) : undefined;
    let actualInputs = overlay ? pipelineInputsSchema.parse(overlay.ast) : inputs;
    let offset = 0, overriddenStream: { pointer: string; pin: Extract<SimulationPin, { kind: 'output' }> } | undefined;
    if (root) for (const pin of pins) {
      if (pin.kind !== 'output' || pin.result.kind !== 'operand' || pin.result.answer.status !== 'value') continue;
      const location = root.sourceMap.find(location => location.nodeId === pin.blockId && (location.pointer === '/request' || /^\/steps\/\d+$/.test(location.pointer)));
      if (!location) continue;
      const next = location.pointer === '/request' ? 0 : Number(location.pointer.split('/')[2]) + 1;
      if (next >= offset) { offset = next; overriddenStream = { pointer: location.pointer, pin }; }
    }
    if (overriddenStream?.pin.result.kind === 'operand' && overriddenStream.pin.result.answer.status === 'value') {
      actualInputs = { ...actualInputs, request: { type: 'none', value: { type: 'literal', value: copy(overriddenStream.pin.result.answer.value) } }, steps: actualInputs.steps.slice(offset) };
      for (let index = ownIssues.length - 1; index >= 0; index--) if (ownIssues[index].startsWith('Missing captured flow response')) ownIssues.splice(index, 1);
    }
    const mapPointer = (at: string) => overriddenStream && at.startsWith('/request') ? overriddenStream.pointer
      : offset ? at.replace(/^\/steps\/(\d+)/, (_match, index: string) => `/steps/${Number(index) + offset}`) : at;
    const overridden = new Set(overlay?.overridden);
    if (overriddenStream) overridden.add('/request/value');
    const observation = root && options.observe !== false ? observationFor(root, actualInputs as Json, overridden, mapPointer) : undefined;
    const result = ownIssues.some(issue => issue.startsWith('Missing')) ? undefined : evaluatePipeline(actualInputs,
      actualInputs.request.type === 'entities' ? pinEntityRows(program, response?.response as Json ?? null, pins) : copy(response?.response ?? null), {
        clock, viewer: base.viewer,
        read: (id, path) => { const result = overlay?.synthetic.get(id) ?? environment.read(id, path); return result.status === 'value' ? result.value : undefined; },
        ...(observation ? { observe: { evaluation: observation.evaluation, pipeline: observation.pipeline } } : {}),
      });
    pending.delete(sourceId);
    if (result?.status === 'over-budget') ownIssues.push(`Flow ${sourceId} exceeded its runtime budget at ${result.stepId ?? 'output'}.`);
    const answer = { result, trace: observation?.report ?? emptyReport(), issues: ownIssues };
    flowAnswers.set(sourceId, answer);
    return answer;
  };
  environment.read = (sourceId, path) => {
    if (!program.flows.has(sourceId)) return readBase(sourceId, path);
    const flow = runFlow(sourceId);
    flow.issues.forEach(issue => gaps.add(issue));
    if (flow.result?.status !== 'ok') { gaps.add(`Unanswered flow: ${sourceId}`); return unavailable; }
    const field = program.flows.get(sourceId)?.output.kind === 'scalar' ? { value: flow.result.output } : flow.result.output;
    return value(valueAt(field, path));
  };
  function observationFor(root: SimulationRoot, ast: Json, overridden: ReadonlySet<string>, originalPointer: (at: string) => string = at => at) {
    return createObservation({
      runId: options.runId ?? 'studio-run', root: root.anchor, ast, clock, overridden,
      locate: at => ({ blockId: nodeFor(root, originalPointer(at))?.id ?? `unmapped:${at}`, portId: 'value', pointer: originalPointer(at) }),
      provenance: at => {
        if (overridden.has(at)) return 'pin';
        const node = nodeFor(root, originalPointer(at));
        const source = node ? sourceCaptureForNode(node, program) : undefined;
        if (source && pins.some(pin => pin.kind === 'source' && sourceKey(pin) === sourceKey(source))) return 'pin';
        if (node?.payload.kind === 'operand' && node.payload.value.type === 'clock' && !options.liveClock && (options.clock || scenario?.clock)) return 'pin';
        if (source && liveSources.some(read => sourceKey(read) === sourceKey(source))) return 'live';
        return scenario ? 'scenario' : 'live';
      },
    });
  }
  for (const root of program.roots) {
    const rootIssues = [...issues], overlay = prepared(root, pins);
    let result: SimulationResult | undefined, trace = emptyReport(), flow: RunResult | undefined;
    gaps.clear();
    if (root.body.kind === 'flow') {
      const answer = runFlow(root.body.sourceId); flow = answer.result; trace = answer.trace; rootIssues.push(...answer.issues);
      if (flow?.status === 'ok') result = { kind: 'operand', answer: value(flow.output) };
    } else {
      const observation = options.observe === false ? undefined : observationFor(root, overlay.ast, overlay.overridden);
      const counter = { spent: 0, limit: 0 };
      const env: Environment = {
        ...environment, clock,
        read: (sourceId, path) => overlay.synthetic.get(sourceId) ?? environment.read(sourceId, path),
        ...(observation ? { observe: observation.evaluation, observationCost: counter, spend: () => { counter.spent++; } } : {}),
      };
      if (!rootIssues.length) {
        if (root.body.kind === 'condition') result = { kind: 'condition', answer: evaluatePredicate(overlay.ast as Predicate, env) };
        else if (root.body.kind === 'slot') {
          const previous = base.previousText.find(seed => anchorKey(seed.output) === anchorKey(root.anchor))?.text;
          result = { kind: 'operand', answer: resolveText(overlay.ast as typeof root.body.value, env, previous) };
        } else result = { kind: 'operand', answer: evaluateOperand(overlay.ast as Operand, env) };
      }
      trace = observation?.report ?? emptyReport();
      if (observation) {
        const observed = new Set(trace.events.map(event => event.blockId));
        for (const node of root.graph.nodes) {
          if (observed.has(node.id) || !['operand', 'condition', 'logic-ref'].includes(node.payload.kind)) continue;
          const at = root.sourceMap.find(location => location.nodeId === node.id)?.pointer;
          if (at === undefined || trace.events.length >= 2000) { trace.truncated = true; continue; }
          trace.events.push({ runId: options.runId ?? 'studio-run', root: root.anchor, blockId: node.id, pointer: at,
            inputs: [], provenance: 'computed', state: 'skipped', reason: 'Not evaluated by the shared evaluator; no value was observed.',
            clock, cost: { used: counter.spent, limit: 0 } });
        }
      }
    }
    rootIssues.push(...gaps);
    const rootNode = root.graph.nodes.find(node => root.graph.roots.some(graphRoot => graphRoot.nodeId === node.id && anchorKey(graphRoot.anchor) === anchorKey(root.anchor)));
    const sources = rootNode ? blockSources(program, rootNode, pins, Boolean(scenario), Boolean(!options.liveClock && (options.clock || scenario?.clock)), options.liveBlocks) : new Set(['live']);
    const source: OutputAnswer['source'] = sources.size > 1 ? 'Mixed' : sources.has('pin') ? 'Pinned' : sources.has('scenario') ? 'Scenario'
      : held.origin === 'sample' ? 'Sample' : held.stale ? 'Held/stale' : 'Live';
    outputs.push({ output: root.anchor, result, source, at: scenario?.capturedAt ?? held.at, issues: [...new Set(rootIssues)], trace, ...(flow ? { flow } : {}) });
  }
  return { mode: simulated ? 'Simulated' : 'Live', modified: Boolean(scenario && ((options.pins?.length ?? 0) > 0 || options.clock || options.liveClock)), outputs, issues };
}
export interface ScenarioResult {
  readonly id: string;
  readonly name: string;
  readonly status: 'Passed' | 'Failed' | 'Incomplete';
  readonly at: string;
  readonly outputs: readonly { readonly expected?: SimulationCase['expected'][number]; readonly actual: OutputAnswer; readonly status: ScenarioResult['status']; readonly reasons: readonly string[] }[];
  readonly reasons: readonly string[];
}
function equalResult(expected: SimulationCase['expected'][number], actual: SimulationResult): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'operand' && actual.kind === 'operand' && expected.absoluteTolerance !== undefined
    && expected.answer.status === 'value' && actual.answer.status === 'value' && typeof expected.answer.value === 'number' && typeof actual.answer.value === 'number') {
    return Math.abs(expected.answer.value - actual.answer.value) <= expected.absoluteTolerance;
  }
  return canonicalCompositionJSON(expected.answer) === canonicalCompositionJSON(actual.answer);
}
/** Run All takes exactly one held snapshot. Saved scenarios never fill gaps from it. */
export function runAll(program: SimulationProgram, scenarios: readonly SimulationCase[], held: HeldSnapshot): ScenarioResult[] {
  const frozen = clone(held);
  const blocked = scenarios.flatMap(scenario => pinProblems(program, scenario.pins));
  return scenarios.map(scenario => {
    const run = runSimulation(program, frozen, { scenario, observe: false });
    const outputs = run.outputs.map(actual => {
      const expected = scenario.expected.find(entry => anchorKey(entry.output) === anchorKey(actual.output));
      const reasons = [...actual.issues, ...blocked];
      if (!expected) reasons.push('No expected output recorded.');
      if (!actual.result) reasons.push('No answer was observed.');
      const status: ScenarioResult['status'] = reasons.length ? 'Incomplete' : equalResult(expected!, actual.result!) ? 'Passed' : 'Failed';
      return { expected, actual, status, reasons };
    });
    const missingRoots = scenario.expected.some(expected => !outputs.some(output => anchorKey(output.actual.output) === anchorKey(expected.output)));
    const reasons = missingRoots ? ['Unresolved expected output.'] : [];
    const status = reasons.length || !outputs.length || outputs.some(output => output.status === 'Incomplete') ? 'Incomplete'
      : outputs.some(output => output.status === 'Failed') ? 'Failed' : 'Passed';
    return { id: scenario.id, name: scenario.name, status, at: scenario.capturedAt, outputs, reasons };
  });
}
/** Capture is explicit and previewable. Persistence is a separate operation. */
export function captureScenario(program: SimulationProgram, held: HeldSnapshot, input: {
  readonly id: string; readonly name: string; readonly pins?: readonly SimulationPin[]; readonly clock?: SimulationClock;
}): SimulationCase {
  const base = clone(held.base);
  const bounded = {
    ...base,
    reads: base.reads.filter(read => program.reads.some(required => readKey(required) === readKey(read))),
    flowResponses: base.flowResponses.filter(flow => program.flows.has(flow.sourceId)).map(flow => {
      const cut = trimSample(copy(flow.response));
      return { ...flow, response: cut.json, trimmed: flow.trimmed || Boolean(cut.trimmed) };
    }),
    ...(base.viewer ? { viewer: Object.fromEntries(Object.entries(base.viewer).filter(([field]) => program.viewerFields.has(field as 'userId' | 'isAdmin' | 'personEntityId'))) } : {}),
  };
  const run = runSimulation(program, { ...held, base: bounded }, { pins: input.pins, clock: input.clock, observe: false });
  const expected: SimulationCase['expected'][number][] = run.outputs.flatMap(output => output.result ? [{ ...output.result, output: output.output }] : []);
  const scenario: SimulationCase = {
    version: 1, id: input.id, name: input.name, fingerprint: program.fingerprint, capturedAt: held.at,
    base: bounded, pins: clone(input.pins ?? []), ...(input.clock ? { clock: clone(input.clock) } : {}), expected,
  };
  return caseSchema.parse(scenario);
}
