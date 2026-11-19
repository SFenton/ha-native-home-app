import type { Json } from '../../types';
import type { ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, pointer, type CompositionIssue } from '../json';
import type { LogicEntry } from '../logic-library';
import { compositionDependencyIssues } from '../compiler';
import { compileGraphValue, consumingDocument } from './compile';
import { measureBudget } from './budgets';
import { copy, fingerprint, record, replaceAt, withoutCanvasMetadata } from './json';
import type { GraphBudget, GraphDiagnostic, GraphRoot, GraphSourceLocation, LogicGraph, LoweringResult } from './types';
import { validateGraph } from './validate';
import { expansionSourceMap } from './provenance';

export interface LowerOptions {
  readonly targetCapabilities?: readonly string[];
  readonly library?: readonly LogicEntry[];
  readonly itemScope?: ItemScope;
}
/** Lossless buffer projection only. This does not authorize Apply, Save or publication. */
export function projectGraph(graph: LogicGraph): { readonly ast: Json; readonly sourceMap: readonly GraphSourceLocation[] } {
  const errors = validateGraph(graph, { projection: true }).filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) throw new CompositionValidationError(errors.map(error => ({
    code: ['cycle', 'occupied_input', 'scope_mismatch', 'opaque_region', 'invalid_layout', 'recipe_disabled'].includes(error.code) ? 'invalid_combination' : error.code as CompositionIssue['code'],
    pointer: error.pointer,
  })));
  const byId = new Map(graph.nodes.map(node => [node.id, node])), sourceMap: GraphSourceLocation[] = [];
  const incoming = new Map(graph.edges.map(edge => [`${edge.to.nodeId}:${edge.to.portId}`, edge]));
  const mapped = new Set<string>();
  let emitted = 0;
  const emit = (id: string, at: string, root: GraphRoot, rootIndex: number): Json => {
    if (++emitted > 100_000) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: at }]);
    const node = byId.get(id)!;
    let value = copy(node.payload.value);
    for (const input of node.inputs) {
      const edge = incoming.get(`${id}:${input.id}`);
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
  const validation = validateGraph(graph), errors: GraphDiagnostic[] = validation.filter(diagnostic => diagnostic.severity === 'error');
  const hints = validation.filter(diagnostic => diagnostic.severity === 'warning');
  if (!graph.roots.length) return { ok: false, original: graph.original, errors, budgets: [] };
  let ast: Json, sourceMap: readonly GraphSourceLocation[];
  try { ({ ast, sourceMap } = projectGraph(graph)); assertCompositionBounds(ast); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false, original: graph.original, errors: [...errors, ...error.issues.map(issue => diagnostic(issue, graph.roots[0]))], budgets: [] };
  }
  const values = graph.roots.length === 1 ? [ast] : Array.isArray(ast) ? ast : [ast];
  const budgets: GraphBudget[] = [];
  const capabilities = new Set<string>();
  const dependencies: { from: string; to: string; path: string }[] = [];
  graph.roots.forEach((root, index) => {
    const value = values[index];
    const report = (issue: CompositionIssue) => errors.push(diagnostic(issue, root, sourceMap));
    let context = root.destination.context;
    try {
      if (context) {
        let document = copy(context.document);
        for (const [otherIndex, other] of graph.roots.entries()) {
          if (other.destination.context && fingerprint(other.destination.context.document) === fingerprint(context.document)) {
            document = consumingDocument({ ...other.destination.context, document }, values[otherIndex]);
          }
        }
        context = { ...context, document };
      }
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      error.issues.forEach(report);
    }
    const compileOptions = {
      kind: root.destination.kind === 'flow' && record(value) && value.model !== 'pipeline@1' ? 'flow-inputs' as const : root.destination.kind,
      context, library: options.library, itemScope: options.itemScope, allowControl: root.destination.allowControl,
    };
    const compiled = compileGraphValue(value, compileOptions);
    sourceMap = [...sourceMap, ...expansionSourceMap(value, compiled.expanded, compiled.origins, root.anchor, sourceMap, options.library)];
    compiled.issues.forEach((issue, issueIndex) => {
      const native = compiled.documentIssues?.[issueIndex];
      if (root.destination.context && native?.pointer.startsWith('/document')) {
        const documentPointer = native.pointer.replace(/^\/document(?=\/|$)/, '');
        const owner = graph.roots.filter(candidate => candidate.destination.context
          && fingerprint(candidate.destination.context.document) === fingerprint(root.destination.context!.document)
          && (documentPointer === candidate.destination.context.pointer || documentPointer.startsWith(`${candidate.destination.context.pointer}/`)))
          .sort((a, b) => b.destination.context!.pointer.length - a.destination.context!.pointer.length)[0];
        const mapped = diagnostic({ ...native, pointer: owner ? documentPointer.slice(owner.destination.context!.pointer.length) : documentPointer }, owner ?? root, owner ? sourceMap : []);
        if (!errors.some(error => error.anchor === mapped.anchor && error.code === mapped.code && error.pointer === mapped.pointer)) errors.push({ ...mapped, documentPointer });
      } else report(issue);
    });
    dependencies.push(...compiled.dependencies.map(dependency => ({ ...dependency, path: `/${index}${dependency.path}` })));
    for (const capability of compiled.capabilities) {
      capabilities.add(capability);
      if (options.targetCapabilities && !options.targetCapabilities.includes(capability)) report({ code: 'unsupported_capability', pointer: '', capability });
    }
    budgets.push(measureBudget(value, root.anchor, compileOptions));
  });
  if (graph.roots.length > 1) for (const issue of compositionDependencyIssues(dependencies)) {
    const index = Number(issue.pointer.split('/')[1]), root = graph.roots[index];
    const relative = { ...issue, pointer: issue.pointer.replace(/^\/\d+/, '') };
    if (!errors.some(error => error.anchor === root.anchor && error.code === relative.code && error.pointer === relative.pointer)) errors.push(diagnostic(relative, root, sourceMap));
    const budget = budgets[index];
    if (!budget.compilerIssues.some(found => found.code === relative.code && found.pointer === relative.pointer)) {
      budgets[index] = { ...budget, accepted: false, compilerIssues: [...budget.compilerIssues, relative] };
    }
  }
  if (errors.length) return { ok: false, original: graph.original, errors, budgets };
  return {
    ok: true, ast, sourceMap, budgets, capabilities: [...capabilities].sort(), generatedSources: [], generatedLibrary: [], diagnostics: hints,
    replacements: graph.roots.map((root, index) => ({ anchor: root.anchor, ast: values[index] })),
  };
}
export function semanticFingerprint(graph: LogicGraph): string {
  const { ast } = projectGraph(graph);
  return fingerprint(graph.roots.length === 1 ? graph.roots[0].destination.kind === 'document' ? withoutCanvasMetadata(ast) : ast
    : Array.isArray(ast) ? ast.map((value, i) => graph.roots[i].destination.kind === 'document' ? withoutCanvasMetadata(value) : value) : ast);
}
function diagnostic(issue: CompositionIssue, root: GraphRoot, sourceMap: readonly GraphSourceLocation[] = []): GraphDiagnostic {
  const origin = sourceMap.filter(location => location.anchor === root.anchor && (location.pointer === issue.pointer || issue.pointer.startsWith(`${location.pointer}/`)))
    .sort((a, b) => b.pointer.length - a.pointer.length || Number(b.stage === 'expanded') - Number(a.stage === 'expanded'))[0];
  return { severity: 'error', code: issue.code, message: issue.pointer.endsWith('/destination/context') ? 'A standalone slot requires its consuming document and field pointer; native field constraints are not guessed.' : `Graph lowering refused: ${issue.code}.`, anchor: root.anchor, pointer: issue.pointer, ...(origin ? { nodeId: origin.nodeId, portId: origin.portId, ...(origin.usePointer === undefined ? {} : { usePointer: origin.usePointer, authoredPointer: origin.authoredPointer }) } : {}), ...(issue.capability ? { capability: issue.capability } : {}) };
}
