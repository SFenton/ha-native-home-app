import { createId } from '../../ids';
import type { Json } from '../../types';
import { identifierSchema } from '../../validation';
import { checkOperand, checkPredicate, operandBase, predicateBase, type Operand, type Predicate } from '../expression';
import type { CompositionIssue } from '../json';
import { elementOf, isAssignable, withoutNull } from '../pipeline/shape';
import { requestShape } from '../pipeline/sources';
import { newFacts, typeOperand, typeSteps } from '../pipeline/typing';
import { checkGraphPipeline, AVERAGE_CAPABILITY, graphInputsSchema } from './capabilities';
import { measureBudget } from './budgets';
import { copy, fingerprint, record } from './json';
import type { GraphBudget, GraphDiagnostic, GraphPipelineInputs, GraphPipelineSource, GraphSourceLocation, Immutable, LogicAnchor, TemplateAst } from './types';

export interface RecipeValue { readonly ast: Operand | Predicate; readonly sources: readonly GraphPipelineSource[]; readonly sourceMap: readonly GraphSourceLocation[]; readonly budgets: readonly GraphBudget[]; readonly capabilities: readonly string[] }
export type RecipeResult = { readonly ok: true; readonly value: RecipeValue } | { readonly ok: false; readonly errors: readonly GraphDiagnostic[] };
const recipeAnchor: LogicAnchor = { kind: 'logic', id: 'recipe', field: '/body' };
const error = (code: GraphDiagnostic['code'], message: string, pointer = ''): Extract<RecipeResult, { ok: false }> => ({ ok: false, errors: [{ severity: 'error', code, message, anchor: recipeAnchor, pointer }] });
const read = (sourceId: string): Operand => ({ type: 'read', from: { type: 'source', sourceId, path: ['value'] }, as: 'number', missing: 'unavailable' });
const literal = (value: number): Operand => ({ type: 'literal', value });

/** Call once in the authoring transaction; lift/lower never allocates random IDs. */
export function allocateGraphId(prefix: string, existing: ReadonlySet<string>): string {
  let id: string;
  do { id = createId(prefix); } while (existing.has(id));
  return id;
}
function finish(ast: Operand | Predicate, sources: GraphPipelineSource[] = [], capabilities: readonly string[] = []): RecipeResult {
  const condition = predicateBase.safeParse(ast);
  const facts = condition.success ? checkPredicate(condition.data, '') : checkOperand(operandBase.parse(ast), '');
  const issues: CompositionIssue[] = [...facts.issues];
  for (const [index, source] of sources.entries()) issues.push(...checkGraphPipeline(source, `/dataSources/${index}`).issues);
  if (issues.length) return { ok: false, errors: issues.map(issue => ({ severity: 'error', code: issue.code, pointer: issue.pointer, anchor: recipeAnchor, message: `Recipe does not fit the existing grammar: ${issue.code}.` })) };
  const required = [...new Set([...capabilities, ...[...facts.needs].map(name => `sh.${name}@1`), ...(facts.usedOperands ? ['sh.operands@1'] : [])])].sort();
  const budgets = [
    measureBudget(ast, recipeAnchor, { capabilities: required, generatedFlowCount: sources.length }),
    ...sources.map(source => measureBudget(source, { kind: 'flow', id: source.id, field: '' }, { kind: 'flow', capabilities: checkGraphPipeline(source, '').capabilities })),
  ];
  const sourceMap: GraphSourceLocation[] = [];
  const map = (value: Json, pointer: string) => {
    sourceMap.push({ pointer, nodeId: 'recipe', portId: pointer.startsWith('/dataSources') ? 'sources' : 'value', anchor: recipeAnchor });
    if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, inner]) => map(inner, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
  };
  map(ast, ''); sources.forEach((source, i) => map(source, `/dataSources/${i}`));
  return { ok: true, value: { ast, sources, sourceMap, budgets, capabilities: required } };
}

export function averageFixed(values: readonly Immutable<Operand>[]): RecipeResult {
  if (values.length < 2 || values.length > 8) return error('limit_exceeded', 'Average Fixed Values requires 2..8 numeric operands.', '/values');
  for (const [index, value] of values.entries()) {
    const parsed = operandBase.safeParse(value);
    if (!parsed.success) return error('invalid_value', 'Invalid fixed operand.', `/values/${index}`);
    const shape = typeOperand(parsed.data, { params: new Map(), allowRead: true, allowViewer: true }, '', newFacts());
    if (!isAssignable(withoutNull(shape), { kind: 'number' })) return error('binding_type', 'Average Fixed Values requires numbers, not text or unresolved values.', `/values/${index}`);
  }
  return finish({ type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: values.map(value => operandBase.parse(value)) }, literal(values.length)] });
}

export interface FixedForEach {
  readonly mode: 'fixed';
  readonly selection: readonly { readonly sourceId: string; readonly viewer?: { readonly personEntityIds: readonly string[] } }[];
  readonly test: Immutable<TemplateAst<Predicate>>;
  readonly sourceParameter: string;
  readonly reducer: 'count' | 'any' | 'all';
}
interface FlowForEachBase {
  readonly mode: 'flow';
  readonly id: string;
  readonly test?: Immutable<Predicate>;
  readonly reducer: 'count' | 'any' | 'all';
  readonly existingSourceIds?: readonly string[];
  readonly existingFlowCount?: number;
}
export type FlowForEach = FlowForEachBase & (
  | { readonly entityIds: readonly string[]; readonly attributes: readonly string[]; readonly preprocessing?: Immutable<GraphPipelineInputs['steps']>; readonly prefix?: never }
  | { readonly prefix: Immutable<GraphPipelineInputs>; readonly entityIds?: never; readonly attributes?: never; readonly preprocessing?: never }
);
export function lowerForEach(recipe: FixedForEach | FlowForEach): RecipeResult {
  if (recipe.mode === 'fixed') {
    if (recipe.selection.length < 1 || recipe.selection.length > 32) return error('limit_exceeded', 'Fixed counts require 1..32 declared sources. Change explicitly to Data Flow mode for larger selections.', '/selection');
    const substitute = (value: Json, sourceId: string): Json => {
      if (Array.isArray(value)) return value.map(value => substitute(value, sourceId));
      if (!record(value)) return value;
      if (value.type === 'hole' && value.name === recipe.sourceParameter && Object.keys(value).length === 2) return sourceId;
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, substitute(inner, sourceId)]));
    };
    const entries: Extract<Operand, { type: 'count' }>['of'] = [];
    for (const [index, source] of recipe.selection.entries()) {
      if (!identifierSchema.safeParse(source.sourceId).success) return error('invalid_reference', 'Selection must name declared source IDs.', `/selection/${index}/sourceId`);
      const parsed = predicateBase.safeParse(substitute(copy(recipe.test), source.sourceId));
      if (!parsed.success) return error('invalid_value', 'The source setting must substitute into a valid document condition.', '/test');
      entries.push({ test: parsed.data, ...(source.viewer ? { viewer: { personEntityIds: [...source.viewer.personEntityIds] } } : {}) });
    }
    const count: Operand = { type: 'count', of: entries };
    if (recipe.reducer === 'count') return finish(count);
    const denominator: Operand = entries.some(entry => entry.viewer) ? {
      type: 'count', of: entries.map(entry => ({ test: { type: 'compare', op: 'eq', left: literal(1), right: literal(1) }, ...(entry.viewer ? { viewer: entry.viewer } : {}) })),
    } : literal(entries.length);
    return finish({ type: 'compare', op: recipe.reducer === 'any' ? 'above' : 'eq', left: count, right: recipe.reducer === 'any' ? literal(0) : denominator });
  }
  let prefix: GraphPipelineInputs;
  if (recipe.prefix) {
    const parsed = graphInputsSchema.safeParse(recipe.prefix);
    if (!parsed.success) return error('invalid_value', 'Invalid typed list prefix.', '/prefix');
    prefix = parsed.data;
  } else {
    if (recipe.entityIds.length < 1 || recipe.entityIds.length > 64) return error('limit_exceeded', 'Entity flows require 1..64 entities; selections are never chunked.', '/entityIds');
    if (new Set(recipe.entityIds).size !== recipe.entityIds.length) return error('invalid_combination', 'Flow entity selections must be distinct; unlike count, duplicates are not supported.', '/entityIds');
    if (recipe.attributes.length > 8 || new Set(recipe.attributes).size !== recipe.attributes.length) return error('limit_exceeded', 'Select at most 8 distinct attributes.', '/attributes');
    const preprocessing = graphInputsSchema.shape.steps.safeParse(recipe.preprocessing ?? []);
    if (!preprocessing.success) return error('invalid_value', 'Invalid preprocessing steps.', '/preprocessing');
    prefix = {
      title: 'For Each', parameters: [],
      request: { type: 'entities', entityIds: recipe.entityIds.map(value => ({ type: 'literal', value })), attributes: [...recipe.attributes] },
      steps: preprocessing.data, output: { kind: 'scalar' }, schema: { kind: 'number' },
    };
  }
  const checkedTest = recipe.test === undefined ? undefined : predicateBase.safeParse(recipe.test);
  if (checkedTest && !checkedTest.success) return error('invalid_value', 'Invalid flow condition.', '/test');
  const test = checkedTest?.data;
  const make = (id: string, filtered: boolean): GraphPipelineSource => ({
    id, kind: 'model', model: 'pipeline@1',
    inputs: { ...prefix, steps: [...prefix.steps, ...(filtered && test ? [{ id: 'matching', op: 'filter' as const, where: test }] : []), { id: 'count', op: 'count' }] },
  });
  const sources = [make(`${recipe.id}-matching`, true)];
  const countRead = read(sources[0].id);
  let ast: Operand | Predicate = countRead;
  if (recipe.reducer === 'any') ast = { type: 'compare', op: 'above', left: countRead, right: literal(0) };
  if (recipe.reducer === 'all') {
    sources.push(make(`${recipe.id}-eligible`, false));
    ast = { type: 'compare', op: 'eq', left: countRead, right: read(sources[1].id) };
  }
  if (sources.some(source => recipe.existingSourceIds?.includes(source.id))) return error('duplicate_id', 'Generated flow IDs collide with existing sources.', '/id');
  if ((recipe.existingFlowCount ?? 0) + sources.length > 128) return error('limit_exceeded', 'For Each would exceed 128 flow sources.', '/dataSources');
  return finish(ast, sources, ['sh.pipeline@1']);
}

export interface ListAverageRecipe {
  readonly id: string;
  readonly prefix: Immutable<GraphPipelineInputs>;
  readonly value: Immutable<Operand>;
  readonly targetCapabilities: readonly string[];
  readonly strategy?: 'step' | 'two-flow';
  readonly inputKind?: 'numeric' | 'entity-state';
  readonly existingSourceIds?: readonly string[];
  readonly existingFlowCount?: number;
}
/** Creating this recipe is an explicit graph edit, never a publish-time migration. */
export function lowerListAverage(recipe: ListAverageRecipe): RecipeResult {
  if (recipe.inputKind === 'entity-state') return error('recipe_disabled', 'A-number-state: entities.state is statically string. The required math-add-zero normalization is blocked until compiler/native evidence reconciles typing.', '/steps/0/fields/value/args/0');
  const parsed = graphInputsSchema.safeParse(recipe.prefix);
  if (!parsed.success) return error('invalid_value', 'Invalid flow prefix.', '/prefix');
  const prefix = parsed.data, value = operandBase.safeParse(recipe.value);
  if (!value.success) return error('invalid_value', 'Invalid average value operand.', '/value');
  // A prefix must still be a linear list transformation; reductions do not become lists implicitly.
  const params = new Map(prefix.parameters.map(parameter => [parameter.name, parameter.type]));
  const facts = newFacts();
  const scope = { params, allowRead: false, allowViewer: true };
  const initial = prefix.request.type === 'none' ? typeOperand(prefix.request.value, scope, '/request/value', facts) : requestShape(prefix.request);
  const baselineSteps = prefix.steps.filter(step => step.op !== 'average');
  if (baselineSteps.length !== prefix.steps.length) return error('invalid_combination', 'An average prefix cannot contain a terminal Average.', '/prefix/steps');
  const shapes = typeSteps(baselineSteps, initial, params, '', facts);
  const item = elementOf(shapes.at(-1) ?? initial);
  if (!item) return error('binding_type', 'Average requires a typed list stream.', '/value');
  const shape = typeOperand(value.data, { params, item, allowRead: false, allowViewer: false }, '/value', facts);
  if (facts.issues.length || !isAssignable(withoutNull(shape), { kind: 'number' })) return error('binding_type', 'Average requires number/null, not arbitrary text or unresolved values.', facts.issues[0]?.pointer ?? '/value');
  const supported = recipe.targetCapabilities.includes(AVERAGE_CAPABILITY);
  const strategy = recipe.strategy ?? (supported ? 'step' : 'two-flow');
  if (strategy === 'step' && !supported) return error('unsupported_capability', 'Target does not support sh.flow-average@1.', '/targetCapabilities');
  const make = (id: string, steps: GraphPipelineInputs['steps']): GraphPipelineSource => ({
    id, kind: 'model', model: 'pipeline@1', inputs: { ...prefix, steps: [...prefix.steps, ...steps], output: { kind: 'scalar' }, schema: { kind: 'number' } },
  });
  const sources = strategy === 'step' ? [make(`${recipe.id}-average`, [{ id: 'average', op: 'average', value: value.data }])]
    : [
      make(`${recipe.id}-sum`, [{ id: 'total', op: 'sum', value: value.data }]),
      make(`${recipe.id}-valid-count`, [{ id: 'valid', op: 'filter', where: { type: 'exists', value: value.data } }, { id: 'count', op: 'count' }]),
    ];
  if (sources.some(source => recipe.existingSourceIds?.includes(source.id))) return error('duplicate_id', 'Generated flow IDs collide with existing sources.', '/id');
  if ((recipe.existingFlowCount ?? 0) + sources.length > 128) return error('limit_exceeded', 'Average would exceed 128 flow sources.', '/dataSources');
  const ast: Operand = strategy === 'step' ? read(sources[0].id) : { type: 'math', op: 'divide', args: sources.map(source => read(source.id)) };
  const requirements = [...new Set(sources.flatMap(source => checkGraphPipeline(source, '').capabilities))];
  const missing = requirements.find(capability => !recipe.targetCapabilities.includes(capability));
  if (missing) return error('unsupported_capability', `Target does not support ${missing}.`, '/targetCapabilities');
  const result = finish(ast, sources, requirements);
  if (result.ok) {
    const missing = result.value.capabilities.find(capability => !recipe.targetCapabilities.includes(capability));
    if (missing) return error('unsupported_capability', `Target does not support ${missing}.`, '/targetCapabilities');
  }
  return result;
}

export interface FlowBranch {
  readonly id: string;
  readonly inputs: Immutable<GraphPipelineInputs>;
}
/** Forks are materialized as separate visible sources, including duplicated request prefixes. */
export function lowerFlowBranches(branches: readonly FlowBranch[], existingSourceIds: readonly string[] = []): { readonly ok: true; readonly sources: readonly GraphPipelineSource[] } | { readonly ok: false; readonly errors: readonly GraphDiagnostic[] } {
  if (branches.length + existingSourceIds.length > 128) return error('limit_exceeded', 'Flow branches exceed 128 sources.', '/dataSources');
  const seen = new Set(existingSourceIds), sources: GraphPipelineSource[] = [];
  for (const [index, branch] of branches.entries()) {
    if (!identifierSchema.safeParse(branch.id).success || seen.has(branch.id)) return error('duplicate_id', 'Each flow branch needs a stable, unique source ID.', `/branches/${index}/id`);
    seen.add(branch.id);
    const inputs = graphInputsSchema.safeParse(branch.inputs);
    if (!inputs.success) return error('invalid_value', 'Invalid flow branch.', `/branches/${index}/inputs`);
    const source: GraphPipelineSource = { id: branch.id, kind: 'model', model: 'pipeline@1', inputs: inputs.data };
    const facts = checkGraphPipeline(source, `/branches/${index}`);
    if (facts.issues.length) return error(facts.issues[0].code, 'Flow branch does not type-check.', facts.issues[0].pointer);
    sources.push(source);
  }
  return { ok: true, sources };
}
