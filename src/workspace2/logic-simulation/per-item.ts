import { evaluateOperand, evaluatePredicate, type EvaluationObserver } from '../../shared/composition/evaluator';
import type { Operand, Predicate } from '../../shared/composition/expression';
import type { ObservationReport } from '../../shared/composition/graph-observation';
import type { GraphNode } from '../../shared/composition/graph/types';
import { evaluateParameters, PIPELINE_BUDGET, type PipelineInputs, type RunResult } from '../../shared/composition/pipeline';
import { Meter, type FlowContext } from '../../shared/composition/pipeline/operands';
import { nodeTitle } from '../canvas/blocks';
import { nodeFor, walkJSON, type SimulationRoot } from './program';

export interface ItemContext {
  readonly step: string;
  readonly count: number;
  readonly index?: number;
}
export interface PerItemObservations {
  readonly contexts: Readonly<Record<string, ItemContext & { readonly stepId: string }>>;
  /** Item-independent diagnostic values, separate from the actual execution trace. */
  readonly trace: ObservationReport;
}
const perItemSteps = new Set(['filter', 'sort', 'map', 'group', 'sum', 'unique', 'min', 'max', 'average', 'running-sum', 'annotate', 'default']);
function dependsOnItem(value: unknown): boolean {
  let dependent = false;
  walkJSON(value, expression => { if (expression.type === 'item' || expression.type === 'index') dependent = true; });
  return dependent;
}
export function itemContextText(context?: ItemContext): string | undefined {
  return context?.index === undefined ? undefined : `Item ${context.index + 1} of ${context.count}`;
}
export function noItemsText(context: ItemContext): string {
  return `Didn't run: no items reached ${context.step}`;
}

/** Expanded template descendants share the use's identity, but only its outer expressions complete the block. */
export function blockResultPointers(root: SimulationRoot): ReadonlyMap<string, ReadonlySet<string>> {
  const mapped = new Map<string, string[]>();
  const templates = new Set(root.graph.nodes.filter(node => node.payload.kind === 'logic-ref').map(node => node.id));
  const uses = root.sourceMap.filter(location => location.stage !== 'expanded' && templates.has(location.nodeId));
  const expandedUses = new Set(root.sourceMap.flatMap(location => location.usePointer === undefined ? [] : [location.usePointer]));
  const add = (id: string, at: string) => {
    const pointers = mapped.get(id) ?? [];
    pointers.push(at);
    mapped.set(id, pointers);
  };
  for (const location of root.sourceMap) {
    if (location.portId !== 'value') continue;
    // Authored argument paths are stale after expansion, including arguments that were never used.
    if (location.stage !== 'expanded' && [...expandedUses].some(at => location.pointer === at || location.pointer.startsWith(`${at}/`))) continue;
    add(location.nodeId, location.pointer);
    if (location.stage === 'expanded') for (const use of uses) {
      const original = location.authoredPointer;
      // An identity template can complete with its argument's callback rather than its own block ID.
      if (original === use.pointer || original?.startsWith(`${use.pointer}/`)) add(use.nodeId, location.pointer);
    }
  }
  return new Map([...mapped].map(([id, pointers]) => {
    const outer = new Set<string>();
    for (const at of pointers.sort((a, b) => a.length - b.length)) {
      if (![...outer].some(parent => at === parent || at.startsWith(`${parent}/`))) outer.add(at);
    }
    return [id, outer];
  }));
}

export function observePerItem(root: SimulationRoot, inputs: PipelineInputs, flow: Extract<RunResult, { status: 'ok' }>, execution: ObservationReport,
  context: FlowContext, observation: { readonly report: ObservationReport; readonly evaluation: EvaluationObserver },
  originalPointer: (at: string) => string): PerItemObservations {
  const contexts: Record<string, ItemContext & { readonly stepId: string }> = {};
  const candidates: { expression: Record<string, unknown>; condition: boolean }[] = [];
  const resultPointers = blockResultPointers(root);
  const resultBlocks = new Map<string, GraphNode[]>();
  for (const block of root.graph.nodes) for (const at of resultPointers.get(block.id) ?? []) {
    resultBlocks.set(at, [...resultBlocks.get(at) ?? [], block]);
  }
  const scopes: { value: unknown; pointer: string; item: ItemContext & { readonly stepId: string } }[] = inputs.steps.flatMap((step, index) => {
    if (!perItemSteps.has(step.op)) return [];
    const block = nodeFor(root, originalPointer(`/steps/${index}`));
    const recorded = execution.steps.find(recorded => recorded.blockId === block?.id);
    if (!block || !recorded) return [];
    const count = recorded.before ?? (recorded.input !== null && typeof recorded.input === 'object' && !Array.isArray(recorded.input) && (step.op === 'map' || step.op === 'default') ? 1 : 0);
    return [{ value: step, pointer: `/steps/${index}`, item: { stepId: block.id, step: nodeTitle(block, root.graph), count } }];
  });
  if (inputs.output.kind === 'rows') {
    const block = nodeFor(root, '/output');
    if (block) scopes.push({ value: inputs.output, pointer: '/output', item: { stepId: block.id, step: nodeTitle(block, root.graph), count: Array.isArray(flow.value) ? flow.value.length : 0 } });
  }
  for (const scope of scopes) {
    const fragments = new Map<string, { block: GraphNode; expressions: Record<string, unknown>[] }>();
    walkJSON(scope.value, (expression, at) => {
      if (typeof expression.type !== 'string') return;
      for (const block of resultBlocks.get(originalPointer(at)) ?? []) {
        if (!['operand', 'condition', 'logic-ref'].includes(block.payload.kind)) continue;
        const fragment = fragments.get(block.id) ?? { block, expressions: [] };
        fragment.expressions.push(expression);
        fragments.set(block.id, fragment);
      }
    }, scope.pointer);
    for (const { block, expressions } of fragments.values()) {
      const dependent = expressions.some(dependsOnItem);
      if (dependent || scope.item.count > 0) contexts[block.id] = scope.item;
      if (!dependent) candidates.push(...expressions.map(expression => ({ expression, condition: block.outputs[0]?.type.representation === 'condition' })));
    }
  }
  if (candidates.length) {
    // The native parameter evaluator and the same frozen capture are reused; diagnostic work never spends the flow's meter.
    const params = evaluateParameters(inputs, context, new Meter(PIPELINE_BUDGET)), observed = new WeakSet<object>();
    const env = {
      flow: true, clock: context.clock, viewer: context.viewer, params,
      read: (sourceId: string, path: string[]) => {
        const value = context.read?.(sourceId, path);
        return value === undefined ? { status: 'unavailable' as const } : { status: 'value' as const, value };
      },
      observe: (event: Parameters<EvaluationObserver>[0]) => { observed.add(event.node); observation.evaluation(event); },
    };
    for (const { expression, condition } of candidates) {
      if (observed.has(expression)) continue;
      // These fragments belong to the already-validated pipeline AST; keep their identities for the observer's pointer map.
      if (condition) evaluatePredicate(expression as Predicate, env);
      else evaluateOperand(expression as Operand, env);
    }
  }
  return { contexts, trace: observation.report };
}
