import type { Json } from '../../types';
import { z } from 'zod/v4';
import { compileCompositionDocument, parseCompositionShape } from '../compiler';
import { callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, predicateBase, type ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, pointer, type CompositionIssue } from '../json';
import { expandLogic, type LogicEntry } from '../logic-library';
import { conditional } from '../slots';
import { AVERAGE_CAPABILITY, checkGraphPipeline, graphInputsSchema, graphSourceSchema, graphTextSlotSchema, TEXT_KEEP_CAPABILITY } from './capabilities';
import { measureBudget } from './budgets';
import { copy, fingerprint, record, replaceAt, withoutCanvasMetadata } from './json';
import { expressionPort, portsCompatible } from './ports';
import { describeGrammar, type FragmentKind } from './grammar';
import type { GraphBudget, GraphDiagnostic, GraphRoot, GraphSourceLocation, LogicGraph, LoweringResult } from './types';
import { validateGraph } from './validate';

export interface LowerOptions {
  readonly targetCapabilities?: readonly string[];
  readonly library?: readonly LogicEntry[];
  readonly itemScope?: ItemScope;
}
/** Lossless buffer projection only. This does not authorize Apply, Save or publication. */
export function projectGraph(graph: LogicGraph): { readonly ast: Json; readonly sourceMap: readonly GraphSourceLocation[] } {
  const errors = validateGraph(graph, { projection: true });
  if (errors.length) throw new CompositionValidationError(errors.map(error => ({
    code: ['cycle', 'occupied_input', 'scope_mismatch', 'opaque_region', 'invalid_layout', 'recipe_disabled'].includes(error.code) ? 'invalid_combination' : error.code as CompositionIssue['code'],
    pointer: error.pointer,
  })));
  const byId = new Map(graph.nodes.map(node => [node.id, node])), sourceMap: GraphSourceLocation[] = [];
  const mapped = new Set<string>();
  let emitted = 0;
  const emit = (id: string, at: string, root: GraphRoot, rootIndex: number): Json => {
    if (++emitted > 100_000) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: at }]);
    const node = byId.get(id)!;
    let value = copy(node.payload.value);
    for (const input of node.inputs) {
      const edge = graph.edges.find(edge => edge.to.nodeId === id && edge.to.portId === input.id);
      if (edge && input.binding !== undefined) value = replaceAt(value, input.binding, emit(edge.from.nodeId, at + input.binding, root, rootIndex));
    }
    const map = (candidate: Json, own: string) => {
      const key = `${rootIndex}:${own}`;
      if (!mapped.has(key)) {
        if (mapped.size >= 100_000) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: own }]);
        mapped.add(key);
        sourceMap.push({ pointer: own, nodeId: id, portId: node.inputs.find(input => own.startsWith(at + (input.binding ?? '\0')))?.id ?? 'value', anchor: root.anchor });
      }
      if (candidate !== null && typeof candidate === 'object') Object.entries(candidate).forEach(([key, inner]) => map(inner, pointer(own, key)));
    };
    map(value, at);
    return value;
  };
  const values = graph.roots.map((root, index) => emit(root.nodeId, '', root, index));
  return { ast: values.length === 1 ? values[0] : values, sourceMap };
}
export function lower(graph: LogicGraph, options: LowerOptions = {}): LoweringResult {
  const errors: GraphDiagnostic[] = [...validateGraph(graph)];
  if (!graph.roots.length || errors.length) return { ok: false, original: graph.original, errors, budgets: [] };
  let ast: Json, sourceMap: readonly GraphSourceLocation[];
  try { ({ ast, sourceMap } = projectGraph(graph)); assertCompositionBounds(ast); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false, original: graph.original, errors: error.issues.map(issue => diagnostic(issue, graph.roots[0])), budgets: [] };
  }
  const values = graph.roots.length === 1 ? [ast] : Array.isArray(ast) ? ast : [ast];
  const budgets: GraphBudget[] = [];
  const dependencies: { from: string; to: string; path: string; root: GraphRoot }[] = [];
  graph.roots.forEach((root, index) => {
    const value = values[index], capabilities = new Set<string>();
    let expanded = value;
    const report = (issue: CompositionIssue) => errors.push(diagnostic(issue, root, sourceMap));
    const check = (candidate: Json, kind: FragmentKind, at = '', itemScope = options.itemScope): void => {
      if (kind === 'slot' && record(candidate) && candidate.type === 'conditional') parseCompositionShape(conditional(z.json()), candidate);
      if (kind === 'slot' && record(candidate) && (candidate.type === 'read' || candidate.type === 'expr')) parseCompositionShape(graphTextSlotSchema, candidate);
      if (kind === 'operand') {
        const facts = checkOperand(parseCompositionShape(operandBase, candidate), at, root.destination.allowControl, false, itemScope);
        facts.issues.forEach(report); facts.needs.forEach(name => capabilities.add(`sh.${name}@1`));
        capabilities.add('sh.operands@1');
      } else if (kind === 'condition') {
        const facts = checkPredicate(parseCompositionShape(predicateBase, candidate), at, false, itemScope);
        facts.issues.forEach(report); facts.needs.forEach(name => capabilities.add(`sh.${name}@1`));
      } else if (kind === 'call') {
        const facts = checkCallService(parseCompositionShape(callServiceSchema, candidate), at, root.destination.allowControl ?? false, itemScope);
        facts.issues.forEach(report); facts.needs.forEach(name => capabilities.add(`sh.${name}@1`));
        capabilities.add('sh.call-service@1');
      } else if (kind === 'flow' || kind === 'flow-inputs') {
        const source = kind === 'flow' ? parseCompositionShape(graphSourceSchema, candidate)
          : { id: 'graph-flow', kind: 'model' as const, model: 'pipeline@1' as const, inputs: parseCompositionShape(graphInputsSchema, candidate) };
        const facts = checkGraphPipeline(source, at);
        facts.issues.forEach(report); facts.capabilities.forEach(capability => capabilities.add(capability));
        dependencies.push(...facts.dependencies.map(dependency => ({ ...dependency, root })));
      } else if (kind === 'slot' && record(candidate) && candidate.type === 'read') {
        const { fallback: _fallback, whenUnavailable: _policy, ...operand } = candidate;
        check(operand, 'operand', at, itemScope);
      } else {
        const description = describeGrammar(candidate, kind);
        if (description.payload.kind === 'opaque') { report({ code: 'unknown_variant', pointer: at }); return; }
        for (const child of description.children) check(child.value, child.kind, at + child.binding, itemScope);
      }
      if (record(candidate) && Object.hasOwn(candidate, 'whenUnavailable')) capabilities.add(TEXT_KEEP_CAPABILITY);
    };
    try {
      if (root.destination.kind === 'document' && record(value) && Object.hasOwn(value, 'schemaVersion')) {
        const { studioCanvas: _layout, ...semantic } = value;
        const compiled = compileCompositionDocument(semantic);
        compiled.capabilities.forEach(capability => capabilities.add(capability));
        expanded = compiled.expanded;
      } else if (root.destination.kind === 'document') {
        const result = expandLogic(value).document;
        assertCompositionBounds(result);
        expanded = result as Json;
        check(expanded, 'document');
      } else {
        const result = expandLogic({ logicLibrary: options.library ?? [], value }).document;
        if (!record(result)) throw new Error('Logic expansion did not return an object.');
        expanded = result.value;
        check(expanded, root.destination.kind === 'flow' ? record(expanded) && expanded.model === 'pipeline@1' ? 'flow' : 'flow-inputs' : root.destination.kind);
      }
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      error.issues.forEach(issue => report({
        ...issue,
        pointer: root.destination.kind !== 'document' ? issue.pointer.replace(/^\/value(?=\/|$)/, '')
          : record(value) && Object.hasOwn(value, 'schemaVersion') ? issue.pointer.replace(/^\/document(?=\/|$)/, '') : issue.pointer,
      }));
    }
    if (root.destination.type && (root.destination.kind === 'operand' || root.destination.kind === 'condition')) {
      const actual = expressionPort(expanded, root.destination.kind === 'condition', {
        params: new Map(), allowRead: true, allowViewer: true,
        ...(options.itemScope && options.itemScope !== 'lenient' ? { item: options.itemScope.shape } : {}),
      });
      if (!portsCompatible(actual, root.destination.type).compatible) report({ code: 'binding_type', pointer: '' });
    }
    for (const node of graph.nodes) if (node.payload.kind === 'opaque') report({ code: 'unknown_variant', pointer: node.payload.pointer });
    for (const capability of capabilities) {
      if (options.targetCapabilities ? !options.targetCapabilities.includes(capability) : capability === AVERAGE_CAPABILITY || capability === TEXT_KEEP_CAPABILITY) report({ code: 'unsupported_capability', pointer: '', capability });
    }
    const budget = measureBudget(expanded, root.anchor, {
      kind: root.destination.kind === 'flow' && record(expanded) && expanded.model !== 'pipeline@1' ? 'flow-inputs' : root.destination.kind,
      capabilities: [...capabilities], itemScope: options.itemScope, allowControl: root.destination.allowControl,
    });
    for (const dependency of dependencies) {
      const pending = [dependency.to], seen = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (current === dependency.from) {
          errors.push(diagnostic({ code: 'invalid_combination', pointer: dependency.path }, dependency.root, sourceMap));
          break;
        }
        if (!seen.has(current)) { seen.add(current); pending.push(...dependencies.filter(edge => edge.from === current).map(edge => edge.to)); }
      }
    }
    budgets.push(budget);
  });
  if (errors.length) return { ok: false, original: graph.original, errors, budgets };
  return {
    ok: true, ast, sourceMap, budgets, generatedSources: [], generatedLibrary: [], diagnostics: [],
    replacements: graph.roots.map((root, index) => ({ anchor: root.anchor, ast: values[index] })),
  };
}
export function semanticFingerprint(graph: LogicGraph): string {
  const { ast } = projectGraph(graph);
  return fingerprint(graph.roots.length === 1 ? graph.roots[0].destination.kind === 'document' ? withoutCanvasMetadata(ast) : ast
    : Array.isArray(ast) ? ast.map((value, i) => graph.roots[i].destination.kind === 'document' ? withoutCanvasMetadata(value) : value) : ast);
}
function diagnostic(issue: CompositionIssue, root: GraphRoot, sourceMap: readonly GraphSourceLocation[] = []): GraphDiagnostic {
  const origin = sourceMap.find(location => location.anchor === root.anchor && location.pointer === issue.pointer);
  return { severity: 'error', code: issue.code, message: `Graph lowering refused: ${issue.code}.`, anchor: root.anchor, pointer: issue.pointer, ...(origin ? { nodeId: origin.nodeId, portId: origin.portId } : {}), ...(issue.capability ? { capability: issue.capability } : {}) };
}
