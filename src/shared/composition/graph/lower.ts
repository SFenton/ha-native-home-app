import type { Json } from '../../types';
import type { ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, pointer, type CompositionIssue } from '../json';
import type { LogicEntry } from '../logic-library';
import { compositionDependencyIssues } from '../compiler';
import { compileGraphValue, consumingDocument, contextualCompilation, type FragmentOptions } from './compile';
import { budgetFromCompilation } from './budgets';
import { fingerprint, record, withoutCanvasMetadata } from './json';
import type { GraphBudget, GraphDiagnostic, GraphEdge, GraphJSON, GraphRoot, GraphSourceLocation, LogicGraph, LoweringResult } from './types';
import { prepareGraphRevision, readGraphValidation, validateForLowering, validateGraph, type GraphRevisionIndex, type GraphValidation } from './validate';
import { expansionSourceMap } from './provenance';

export interface LowerOptions {
  readonly targetCapabilities?: readonly string[];
  readonly library?: readonly LogicEntry[];
  readonly itemScope?: ItemScope;
  readonly index?: GraphRevisionIndex;
  readonly accounting?: boolean;
}
const jsonArray = (value: GraphJSON): value is readonly GraphJSON[] => Array.isArray(value);
/** Lossless buffer projection only. This does not authorize Apply, Save or publication. */
export function projectGraph(graph: LogicGraph): { readonly ast: Json; readonly sourceMap: readonly GraphSourceLocation[] } {
  const index = prepareGraphRevision(graph);
  const errors = validateGraph(graph, { projection: true, index }).filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) throw new CompositionValidationError(errors.map(error => ({
    code: ['cycle', 'occupied_input', 'scope_mismatch', 'opaque_region', 'invalid_layout', 'recipe_disabled'].includes(error.code) ? 'invalid_combination' : error.code as CompositionIssue['code'],
    pointer: error.pointer,
  })));
  return projectValidatedGraph(graph, index);
}
function projectValidatedGraph(graph: LogicGraph, index: GraphRevisionIndex): { readonly ast: Json; readonly sourceMap: readonly GraphSourceLocation[] } {
  const sourceMap: GraphSourceLocation[] = [];
  let emitted = 0;
  const emit = (id: string, at: string, root: GraphRoot): Json => {
    if (++emitted > 100_000) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: at }]);
    const node = index.node(id)!;
    const bindings = node.inputs.length ? new Map<string, GraphEdge>() : undefined;
    for (const input of node.inputs) {
      const edge = index.incoming(id, input.id)[0];
      if (edge && input.binding !== undefined) bindings!.set(input.binding, edge);
    }
    const project = (candidate: GraphJSON, local: string): Json => {
      const edge = bindings?.get(local), own = at + local;
      if (edge) return emit(edge.from.nodeId, own, root);
      if (sourceMap.length >= 100_000) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: own }]);
      sourceMap.push({ pointer: own, nodeId: id, portId: 'value', anchor: root.anchor });
      if (jsonArray(candidate)) {
        const values: Json[] = [];
        for (let i = 0; i < candidate.length; i++) values.push(project(candidate[i], `${local}/${i}`));
        return values;
      }
      if (candidate !== null && typeof candidate === 'object') {
        const value: Record<string, Json> = {};
        for (const key of Object.keys(candidate)) value[key] = project(candidate[key], key.includes('~') || key.includes('/') ? pointer(local, key) : `${local}/${key}`);
        return value;
      }
      return candidate;
    };
    return project(node.payload.value, '');
  };
  const values = graph.roots.map(root => emit(root.nodeId, '', root));
  return { ast: values.length === 1 ? values[0] : values, sourceMap };
}
export function lower(graph: LogicGraph, options: LowerOptions = {}): LoweringResult {
  return lowerValidated(validateForLowering(graph, options.index), options);
}
/** Uses the explicitly validated immutable revision, with exactly the same refusal path as lower. */
export function lowerValidated(validated: GraphValidation, options: LowerOptions = {}): LoweringResult {
  const { graph, diagnostics: validation, index } = readGraphValidation(validated);
  const errors: GraphDiagnostic[] = validation.filter(diagnostic => diagnostic.severity === 'error');
  const hints = validation.filter(diagnostic => diagnostic.severity === 'warning');
  if (errors.length || !graph.roots.length) return { ok: false, original: graph.original, errors, budgets: [] };
  let ast: Json, sourceMap: readonly GraphSourceLocation[];
  try { ({ ast, sourceMap } = projectValidatedGraph(graph, index)); assertCompositionBounds(ast); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false, original: graph.original, errors: [...errors, ...error.issues.map(issue => diagnostic(issue, graph.roots[0]))], budgets: [] };
  }
  const values = graph.roots.length === 1 ? [ast] : Array.isArray(ast) ? ast : [ast];
  const budgets: GraphBudget[] = [];
  const capabilities = new Set<string>();
  const dependencies: { from: string; to: string; path: string }[] = [];
  const contextKeys = new Map<number, string>(), contextDocuments = new Map<string, Json>();
  const fingerprints = new Map<LogicGraph['original'], string>();
  graph.roots.forEach((root, index) => {
    const context = root.destination.context;
    if (!context) return;
    try {
      let key = fingerprints.get(context.document);
      if (key === undefined) { key = fingerprint(context.document); fingerprints.set(context.document, key); }
      contextKeys.set(index, key);
      contextDocuments.set(key, consumingDocument({ ...context, document: contextDocuments.get(key) ?? context.document }, values[index]));
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      error.issues.forEach(issue => errors.push(diagnostic(issue, root, sourceMap)));
    }
  });
  if (errors.length) return { ok: false, original: graph.original, errors, budgets: [] };
  const documents = new Map([...contextDocuments].map(([key, document]) => [key, compileGraphValue(document, { kind: 'document', accounting: options.accounting })]));
  const compileOptions: FragmentOptions[] = graph.roots.map((root, index) => ({
    kind: root.destination.kind === 'flow' && record(values[index]) && values[index].model !== 'pipeline@1' ? 'flow-inputs' as const : root.destination.kind,
    context: root.destination.context, library: options.library, itemScope: options.itemScope, allowControl: root.destination.allowControl,
    accounting: options.accounting,
    sourceId: root.destination.sourceId ?? (root.anchor.kind === 'flow' ? root.anchor.id : undefined),
  }));
  const compilations = graph.roots.map((root, index) => {
    const context = root.destination.context, key = contextKeys.get(index);
    return context && key !== undefined ? contextualCompilation(documents.get(key)!, context.pointer, values[index]) : compileGraphValue(values[index], compileOptions[index]);
  });
  graph.roots.forEach((root, index) => {
    const compiled = compilations[index], context = root.destination.context;
    const library = context && record(context.document) ? context.document.logicLibrary ?? options.library : options.library;
    sourceMap = [...sourceMap, ...expansionSourceMap(values[index], compiled.expanded, compiled.origins, root.anchor, sourceMap, library)];
  });
  graph.roots.forEach((root, index) => {
    const value = values[index], compiled = compilations[index];
    const report = (issue: CompositionIssue, landing?: string) => errors.push(diagnostic(issue, root, sourceMap, landing));
    compiled.issues.forEach((issue, issueIndex) => {
      const native = compiled.documentIssues?.[issueIndex];
      if (root.destination.context && native?.pointer.startsWith('/document')) {
        const documentPointer = native.pointer.replace(/^\/document(?=\/|$)/, '');
        const ownerIndex = graph.roots.map((candidate, i) => ({ candidate, i })).filter(({ candidate, i }) => candidate.destination.context
          && contextKeys.get(i) === contextKeys.get(index)
          && (documentPointer === candidate.destination.context.pointer || documentPointer.startsWith(`${candidate.destination.context.pointer}/`)))
          .sort((a, b) => b.candidate.destination.context!.pointer.length - a.candidate.destination.context!.pointer.length)[0]?.i;
        const owner = ownerIndex === undefined ? undefined : graph.roots[ownerIndex];
        const landing = compiled.expandedDocumentIssues?.[issueIndex]?.pointer.replace(/^\/document(?=\/|$)/, '');
        const mapped = diagnostic({ ...native, pointer: owner ? documentPointer.slice(owner.destination.context!.pointer.length) : documentPointer }, owner ?? root, owner ? sourceMap : [],
          landing === undefined ? undefined : owner ? landing.slice(owner.destination.context!.pointer.length) : landing);
        if (!errors.some(error => error.anchor === mapped.anchor && error.code === mapped.code && error.pointer === mapped.pointer)) errors.push({ ...mapped, documentPointer });
      } else report(issue, compiled.expandedIssues?.[issueIndex]?.pointer);
    });
    dependencies.push(...compiled.dependencies.map(dependency => ({ ...dependency, path: `/${index}${dependency.path}` })));
    for (const capability of compiled.capabilities) {
      capabilities.add(capability);
      if (options.targetCapabilities && !options.targetCapabilities.includes(capability)) report({ code: 'unsupported_capability', pointer: '', capability });
    }
    budgets.push(budgetFromCompilation(value, root.anchor, compiled, compileOptions[index]));
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
function diagnostic(issue: CompositionIssue, root: GraphRoot, sourceMap: readonly GraphSourceLocation[] = [], landing = issue.pointer): GraphDiagnostic {
  const origin = sourceMap.filter(location => location.anchor === root.anchor && (location.pointer === landing || landing.startsWith(`${location.pointer}/`)))
    .sort((a, b) => b.pointer.length - a.pointer.length || Number(b.stage === 'expanded') - Number(a.stage === 'expanded'))[0];
  return { severity: 'error', code: issue.code, message: issue.pointer.endsWith('/destination/context') ? 'A standalone slot requires its consuming document and field pointer; native field constraints are not guessed.' : `Graph lowering refused: ${issue.code}.`, anchor: root.anchor, pointer: issue.pointer, ...(origin ? { nodeId: origin.nodeId, portId: origin.portId, ...(origin.usePointer === undefined ? {} : { usePointer: origin.usePointer, authoredPointer: origin.authoredPointer }) } : {}), ...(issue.capability ? { capability: issue.capability } : {}) };
}
