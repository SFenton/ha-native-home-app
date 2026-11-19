import type { CompositionIssue } from '../json';
import { pointer as join } from '../json';
import {
  elementOf, hasObject, isAssignable, kindsOf, shapeAt, shapeProblem, withoutNull,
  type Shape,
} from './shape';
import { PIPELINE_LIMITS, type PipelineInputs, type PipelineOperand, type PipelineSource, type ReadKind } from './schema';
import { requestShape, subscriptionDomains } from './sources';
import { checkSegments, newFacts, typeOperand, typeSteps, type TypeFacts, type TypeScope } from './typing';

/**
 * The compiler rules of `sh.pipeline@1` that need only the flow itself: every reference inside it, the acyclic parameters, each step's typing,
 * the output and `schema`, the request and refresh rules, and the limits. What needs the whole document (a `read` of another source, a node that
 * names the flow as its provider) is `checkPipelineRead` and `checkPipelineProvider`, which the document compiler calls with the source in hand.
 */

/** Capability of the data-source model. */
export const PIPELINE_CAPABILITY = 'sh.pipeline@1';
/** Capability of the operands that exist only inside a flow (`item`, `param`, `clock`, `date`). */
export const PIPELINE_OPERANDS_CAPABILITY = 'sh.pipeline-operands@1';

/** Capability of a flow's `records` output, the `index` operand and the `repeat` node that draws the records. */
export const REPEAT_CAPABILITY = 'sh.repeat@1';
/** Capability of the steps `min`, `max`, `running-sum` and `annotate`, the date styles `hour` and `weekday`, and the `progress` operation of a `date` operand. */
export const FLOW_EXTRAS_CAPABILITY = 'sh.flow-extras@1';
export const FLOW_AVERAGE_CAPABILITY = 'sh.flow-average@1';

/** Capability of the rule value `choose`, shared with documents. */
export const RULES_CAPABILITY = 'sh.rules@1';
/** What a `format` of the `words` case needs, in a flow as in an expression. */
export const TEXT_CASE_WORDS_CAPABILITY = 'sh.text-case-words@1';

/** What compiling one flow found. Pointers are absolute (they start at the source's own pointer). */
export interface PipelineFacts {
  issues: CompositionIssue[];
  /** `read` operands (in parameters only), for the document's source and type checks. */
  reads: { read: Extract<PipelineOperand, { type: 'read' }>; path: string }[];
  /** `from` reads `to`: a parameter reading another flow's value. The document rejects cycles across sources. */
  dependencies: { from: string; to: string; path: string }[];
  capabilities: string[];
}

const entityPattern = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
/** Checks a literal entity id (and its domain when one is required); the issue pointer is `at`/value. */
function entity(facts: TypeFacts, value: string, at: string, domain?: string) {
  if (!entityPattern.test(value)) facts.issues.push({ code: 'invalid_value', pointer: join(at, 'value') });
  else if (domain && !value.startsWith(`${domain}.`)) facts.issues.push({ code: 'invalid_combination', pointer: join(at, 'value') });
}

// MARK: The flow

/** Compiles one pipeline source. `at` is the source's pointer, such as `/document/dataSources/3`. */
export function checkPipelineSource(source: PipelineSource, at: string): PipelineFacts {
  const inputs = source.inputs, base = join(at, 'inputs');
  const facts = newFacts();
  const issue = (code: CompositionIssue['code'], pointer: string) => facts.issues.push({ code, pointer });

  // Parameters: unique names, typed values, no reference to an unknown name, no cycle.
  const kinds = new Map<string, ReadKind>();
  inputs.parameters.forEach((parameter, index) => {
    if (kinds.has(parameter.name)) issue('duplicate_id', join(join(join(base, 'parameters'), index), 'name'));
    else kinds.set(parameter.name, parameter.type);
  });
  const parameterRefs: { from: string; name: string; pointer: string }[] = [];
  const parameterScope: TypeScope = { params: kinds, allowRead: true, allowViewer: true };
  inputs.parameters.forEach((parameter, index) => {
    const own = join(join(join(base, 'parameters'), index), 'value');
    const local = newFacts();
    const shape = typeOperand(parameter.value, parameterScope, own, local);
    facts.issues.push(...local.issues); facts.reads.push(...local.reads); facts.newOperands ||= local.newOperands; facts.wordsCase ||= local.wordsCase; facts.usesRules ||= local.usesRules; facts.flowExtras ||= local.flowExtras; facts.usesRepeat ||= local.usesRepeat; local.edge.forEach(name => facts.edge.add(name));
    local.paramRefs.forEach(ref => { facts.paramRefs.push(ref); parameterRefs.push({ from: parameter.name, ...ref }); });
    const have = kindsOf(withoutNull(shape));
    const wants = parameter.type === 'number' ? 'number' : parameter.type === 'boolean' ? 'boolean' : 'string';
    if (have.size && !have.has(wants)) issue('binding_type', own);
    if (parameter.type === 'entity-id' && parameter.value.type === 'literal' && (typeof parameter.value.value !== 'string' || !entityPattern.test(parameter.value.value))) issue('invalid_value', join(own, 'value'));
  });
  for (const ref of parameterRefs) {
    if (!kinds.has(ref.name)) continue;
    const pending = [ref.name], seen = new Set<string>();
    while (pending.length) {
      const name = pending.pop()!;
      if (name === ref.from) { issue('invalid_combination', ref.pointer); break; }
      if (!seen.has(name)) { seen.add(name); pending.push(...parameterRefs.filter(item => item.from === name).map(item => item.name)); }
    }
  }

  // Request.
  const request = inputs.request, requestAt = join(base, 'request');
  const requestScope: TypeScope = { params: kinds, allowRead: false, allowViewer: true };
  const absorb = (local: TypeFacts) => { facts.issues.push(...local.issues); facts.paramRefs.push(...local.paramRefs); facts.newOperands ||= local.newOperands; facts.wordsCase ||= local.wordsCase; facts.usesRules ||= local.usesRules; facts.flowExtras ||= local.flowExtras; facts.usesRepeat ||= local.usesRepeat; local.edge.forEach(name => facts.edge.add(name)); };
  const shapeCheck = (shape: Shape, pointer: string) => { const found = shapeProblem(shape, pointer); if (found) issue(found.code, found.pointer); };
  if (request.type === 'service-response') {
    const local = newFacts();
    const targets = Object.entries(request.target ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : 1);
    if (request.target && !targets.length) issue('invalid_value', join(requestAt, 'target'));
    for (const [key, operand] of targets) {
      const own = join(join(requestAt, 'target'), key);
      typeOperand(operand!, requestScope, own, local);
      if (operand!.type === 'literal') {
        const value = operand!.value;
        const ok = key === 'entity_id' ? typeof value === 'string' && entityPattern.test(value) || (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && entityPattern.test(item)))
          : typeof value === 'string' ? value.length > 0 : Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);
        if (!ok) issue('invalid_value', join(own, 'value'));
      }
      if (request.data && Object.hasOwn(request.data.fields, key)) issue('invalid_combination', own);
    }
    if (request.data) typeOperand(request.data, requestScope, join(requestAt, 'data'), local);
    absorb(local);
    shapeCheck(request.responseShape, join(requestAt, 'responseShape'));
  } else if (request.type === 'entity-attribute') {
    entity(facts, request.entityId.value, join(requestAt, 'entityId'));
    checkSegments(request.path, join(requestAt, 'path'), facts);
    shapeCheck(request.responseShape, join(requestAt, 'responseShape'));
  } else if (request.type === 'entities') {
    const seen = new Set<string>(), names = new Set<string>();
    request.entityIds.forEach((entry, index) => {
      const own = join(join(requestAt, 'entityIds'), index);
      entity(facts, entry.value, own);
      if (seen.has(entry.value)) issue('invalid_combination', join(own, 'value'));
      seen.add(entry.value);
    });
    request.attributes.forEach((name, index) => {
      const own = join(join(requestAt, 'attributes'), index);
      if (/^\d+$/.test(name) || ['__proto__', 'prototype', 'constructor', 'entityId', 'state'].includes(name)) issue('invalid_reference', own);
      else if (names.has(name)) issue('invalid_combination', own);
      names.add(name);
    });
  } else if (request.type === 'none') {
    const local = newFacts();
    typeOperand(request.value, requestScope, join(requestAt, 'value'), local);
    absorb(local);
  } else {
    entity(facts, request.entityId.value, join(requestAt, 'entityId'), subscriptionDomains[request.kind]);
  }

  // Refresh: a live source takes none; the others state when they run again.
  const refresh = inputs.refresh, refreshAt = join(base, 'refresh');
  if (request.type === 'ha-subscription' || request.type === 'entities' || request.type === 'none') {
    if (refresh) issue('invalid_combination', refreshAt);
  } else if (!refresh) issue('missing_required', refreshAt);
  else {
    if (new Set(refresh.on).size !== refresh.on.length) issue('invalid_combination', join(refreshAt, 'on'));
    const watches = refresh.on.includes('entity-change');
    if (request.type === 'service-response') {
      if (watches && !refresh.entityIds) issue('invalid_combination', join(refreshAt, 'on'));
      if (!watches && refresh.entityIds) issue('invalid_combination', join(refreshAt, 'entityIds'));
    } else if (refresh.entityIds) issue('invalid_combination', join(refreshAt, 'entityIds'));
    const seen = new Set<string>();
    refresh.entityIds?.forEach((entry, index) => {
      const own = join(join(refreshAt, 'entityIds'), index);
      entity(facts, entry.value, own);
      if (seen.has(entry.value)) issue('invalid_combination', join(own, 'value'));
      seen.add(entry.value);
    });
  }

  // Steps and output.
  const stepIds = new Set<string>();
  inputs.steps.forEach((step, index) => {
    if (stepIds.has(step.id)) issue('duplicate_id', join(join(join(base, 'steps'), index), 'id'));
    stepIds.add(step.id);
  });
  const before = facts.issues.length;
  const stepFacts = newFacts();
  const input = request.type === 'none' ? typeOperand(request.value, requestScope, join(requestAt, 'value'), newFacts()) : requestShape(request);
  const shapes = typeSteps(inputs.steps, input, kinds, base, stepFacts);
  absorb(stepFacts);
  const final = shapes.length ? shapes[shapes.length - 1] : input;
  const clean = facts.issues.length === before;
  const outputAt = join(base, 'output');
  const rowScope = (item: Shape): TypeScope => ({ item, params: kinds, allowRead: false, allowViewer: false });
  const output = inputs.output;
  if (clean) {
    const core = withoutNull(final), present = kindsOf(core);
    if (output.kind === 'rows') {
      const element = elementOf(final);
      if (element === undefined) issue('binding_type', join(outputAt, 'kind'));
      else {
        const local = newFacts();
        for (const key of ['id', 'title', 'subtitle', 'value'] as const) {
          const operand = output.row[key];
          if (!operand) continue;
          const own = join(join(outputAt, 'row'), key);
          const shape = typeOperand(operand, rowScope(element), own, local);
          const have = kindsOf(withoutNull(shape));
          if (have.size && !['boolean', 'number', 'string'].some(kind => have.has(kind as 'string'))) issue('binding_type', own);
        }
        absorb(local);
      }
    } else if (output.kind === 'records') {
      // `sh.repeat@1`: a list of objects, which the `repeat` node reads by field.
      const element = elementOf(final);
      if (element === undefined || !hasObject(element)) issue('binding_type', join(outputAt, 'kind'));
    } else if (output.kind === 'record') {
      if (core.kind !== 'any' && !(present.size === 1 && present.has('object'))) issue('binding_type', join(outputAt, 'kind'));
    } else if (core.kind !== 'any' && (!present.size || ![...present].every(kind => ['boolean', 'number', 'string'].includes(kind)))) issue('binding_type', join(outputAt, 'kind'));
  }

  // The authored shape must be sound, of the output's kind, and something the steps produce.
  const schemaAt = join(base, 'schema');
  const found = shapeProblem(inputs.schema, schemaAt);
  if (found) issue(found.code, found.pointer);
  else {
    const have = kindsOf(withoutNull(inputs.schema));
    const wanted = output.kind === 'rows' ? have.size === 1 && have.has('array')
      : output.kind === 'records' ? have.size === 1 && have.has('array') && (() => { const element = elementOf(inputs.schema); return element !== undefined && element.kind !== 'any' && hasObject(element) && kindsOf(withoutNull(element)).size === 1; })()
      : output.kind === 'record' ? have.size === 1 && have.has('object')
      : have.size > 0 && [...have].every(kind => ['boolean', 'number', 'string'].includes(kind)) && inputs.schema.kind !== 'any';
    if (inputs.schema.kind === 'any' || !wanted) issue('invalid_combination', schemaAt);
    else if (facts.issues.length === before && !isAssignable(withoutNull(final), withoutNull(inputs.schema))) issue('binding_type', schemaAt);
  }

  // References to parameters that do not exist.
  for (const ref of facts.paramRefs) if (!kinds.has(ref.name)) issue('invalid_reference', ref.pointer);
  if (inputs.steps.length > PIPELINE_LIMITS.steps) issue('limit_exceeded', join(base, 'steps'));

  const capabilities = [PIPELINE_CAPABILITY, ...(facts.newOperands ? [PIPELINE_OPERANDS_CAPABILITY] : []), ...(facts.wordsCase ? [TEXT_CASE_WORDS_CAPABILITY] : []), ...(facts.usesRules ? [RULES_CAPABILITY] : []),
    ...(output.kind === 'records' || facts.usesRepeat ? [REPEAT_CAPABILITY] : []), ...(facts.flowExtras ? [FLOW_EXTRAS_CAPABILITY] : []),
    ...(inputs.steps.some(step => step.op === 'average') ? [FLOW_AVERAGE_CAPABILITY] : []),
    ...[...facts.edge].sort().map(name => `sh.${name}@1`)];
  const dependencies = facts.reads.map(entry => ({ from: source.id, to: entry.read.from.sourceId, path: join(join(entry.pointer, 'from'), 'sourceId') }));
  return { issues: facts.issues, reads: facts.reads.map(entry => ({ read: entry.read, path: entry.pointer })), dependencies, capabilities };
}

// MARK: Reads and providers

/**
 * Checks a `read` that names a flow: a record flow is read by field name, a scalar flow by `["value"]`, a rows or records flow not at all (a list cannot be
 * indexed; a node shows rows through its provider, and records through a `repeat`). The field must exist in `schema` and be a scalar of the kind the read asks for.
 * Returns the issue's pointer suffix (relative to the read) and code, or undefined when the read is sound.
 */
export function checkPipelineRead(inputs: PipelineInputs, path: readonly string[], as: ReadKind): { code: CompositionIssue['code']; suffix: string } | undefined {
  const output = inputs.output;
  if (output.kind === 'rows' || output.kind === 'records') return { code: 'invalid_reference', suffix: '/from/path' };
  let leaf: Shape | undefined;
  if (output.kind === 'scalar') leaf = path.length === 1 && path[0] === 'value' ? inputs.schema : undefined;
  else leaf = shapeAt(inputs.schema, path);
  if (!leaf) return { code: 'invalid_reference', suffix: '/from/path' };
  const have = kindsOf(withoutNull(leaf));
  if (!have.size) return undefined;
  const want = as === 'number' ? 'number' : as === 'boolean' ? 'boolean' : 'string';
  return have.has(want) ? undefined : { code: 'binding_type', suffix: '/as' };
}
/**
 * Checks a node that names a flow as its `providerId`: only a rows flow is a provider, and a `collection` shows it with the `rows` template.
 * `at` is the pointer of the node's `props`. Returns issues with absolute pointers.
 */
export function checkPipelineProvider(inputs: PipelineInputs, node: { type: 'row-collection' | 'collection'; template?: string; refreshable?: boolean }, at: string): CompositionIssue[] {
  const found: CompositionIssue[] = [];
  if (inputs.output.kind !== 'rows') found.push({ code: 'binding_type', pointer: join(at, 'providerId') });
  // Pull to refresh runs the flow again, so the flow must be one a person can pull ("When pulled": `manual`); a live flow has no refresh.
  if (node.refreshable && !('refresh' in inputs && inputs.refresh?.on.includes('manual'))) found.push({ code: 'invalid_combination', pointer: join(at, 'refreshable') });
  if (node.type === 'collection' && node.template !== 'rows') found.push({ code: 'invalid_combination', pointer: join(at, 'template') });
  return found;
}

/**
 * Checks a `repeat` node's `providerId` (`sh.repeat@1`): only a records flow is drawn by a `repeat`, so any other output is `binding_type` at the
 * provider. `at` is the pointer of the node's `props`. Returns the shape of one record, or undefined with an issue.
 */
export function checkRepeatProvider(inputs: PipelineInputs, at: string): { issues: CompositionIssue[]; item?: Shape } {
  if (inputs.output.kind !== 'records') return { issues: [{ code: 'binding_type', pointer: join(at, 'providerId') }] };
  return { issues: [], item: elementOf(inputs.schema) };
}
