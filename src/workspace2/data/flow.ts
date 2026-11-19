import type { CompositionDocument } from '../../shared/composition/schema';
import type { Operand, Predicate } from '../../shared/composition/expression';
import {
  PIPELINE_LIMITS, checkPipelineSource, elementOf, forecastTypes, hasObject, isEntityKeyed, kindsOf, newFacts, requestShape, todoItemShape, typeOperand, typeSteps, withoutNull,
  type PipelineInputs, type PipelineRequest, type PipelineSource, type PipelineStep, type Shape,
} from '../../shared/composition/pipeline';

/**
 * The Data tab's pure logic (studio-ux2, L-data): the five ways a Data Flow gets its data, a new flow for each, the steps that fit a shape,
 * the words of a step, and what uses a flow. Nothing here renders; the panel and the editor read it and the tests pin it.
 */

// MARK: Requests

/** The five choices of "Get data from", in the order the menu lists them. */
export const requestKinds = ['service', 'attribute', 'live-list', 'group', 'none'] as const;
export type RequestKind = typeof requestKinds[number];
/** What the menu calls each choice, and the second line under it. */
export const requestWords: Record<RequestKind, { title: string; note: string }> = {
  service: { title: 'A Service', note: 'Asks Home Assistant' },
  attribute: { title: "An Entity's Attribute", note: 'Follows the entity' },
  'live-list': { title: 'A Live List', note: 'To-do items, forecast' },
  group: { title: 'A Group of Entities', note: 'Up to 64; follows them' },
  none: { title: 'Nothing', note: 'A value from the inputs' },
};
/** The kind of a stored request. */
export function requestKind(request: PipelineRequest): RequestKind {
  switch (request.type) {
    case 'service-response': return 'service';
    case 'entity-attribute': return 'attribute';
    case 'ha-subscription': return 'live-list';
    case 'entities': return 'group';
    case 'none': return 'none';
  }
}
/** Whether a request runs once on demand: a service and an attribute have Run and Refresh; the live kinds have neither. */
export const hasRefresh = (request: PipelineRequest): boolean => request.type === 'service-response' || request.type === 'entity-attribute';

// MARK: Limits and words

/** The limits a person meets, each with its sentence. */
export const flowLimits = {
  flows: { max: PIPELINE_LIMITS.pipelines, words: `${PIPELINE_LIMITS.pipelines} data flows at most.` },
  entities: { max: PIPELINE_LIMITS.entities, words: `${PIPELINE_LIMITS.entities} entities at most.` },
  attributes: { max: PIPELINE_LIMITS.entityAttributes, words: `${PIPELINE_LIMITS.entityAttributes} attributes at most.` },
  steps: { max: PIPELINE_LIMITS.steps, words: `${PIPELINE_LIMITS.steps} steps at most.` },
  sortKeys: { max: PIPELINE_LIMITS.sortKeys, words: 'Up to 4. A later field breaks ties in the ones before it.' },
} as const;

/** The Data Flows of a document, in order. */
export function flowSources(document: CompositionDocument): PipelineSource[] {
  return document.dataSources.filter((source): source is PipelineSource => source.kind === 'model' && source.model === 'pipeline@1');
}
/** One flow by id. */
export const flowById = (document: CompositionDocument, id: string): PipelineSource | undefined => flowSources(document).find(source => source.id === id);
/** Whether another flow may be added. */
export const canAddFlow = (document: CompositionDocument): boolean => flowSources(document).length < flowLimits.flows.max;

// MARK: Shapes through a flow

/** The names a flow's parameters declare, as the type checker takes them. */
const parameterKinds = (inputs: PipelineInputs) => new Map(inputs.parameters.map(item => [item.name, item.type] as const));

/** What a flow's data looks like at each point: the request's shape, then after every step. `clean` is false when a step does not fit what arrives. */
export interface FlowShapes { request: Shape; after: Shape[]; final: Shape; clean: boolean; badStep?: number }
/** Types a flow's steps over its request. Never throws. */
export function flowShapes(inputs: PipelineInputs): FlowShapes {
  const params = parameterKinds(inputs);
  const first = newFacts();
  const request = inputs.request.type === 'none' ? typeOperand(inputs.request.value, { params, allowRead: false, allowViewer: true }, 'v', first) : requestShape(inputs.request);
  const after: Shape[] = [];
  let current = request, badStep: number | undefined;
  inputs.steps.forEach((step, index) => {
    const facts = newFacts();
    current = typeSteps([step], current, params, '', facts)[0];
    if (facts.issues.length && badStep === undefined) badStep = index;
    after.push(current);
  });
  return { request, after, final: after.at(-1) ?? request, clean: badStep === undefined, badStep };
}

/**
 * Keeps a flow's authored `schema` equal to the shape its steps produce, and its Output on a kind the shape allows. Called after every edit, so a
 * person never writes a schema: it follows the steps. A flow whose steps do not type keeps the schema it had.
 */
export function settleFlow(inputs: PipelineInputs): PipelineInputs {
  const shapes = flowShapes(inputs);
  if (!shapes.clean || shapes.final.kind === 'any' || shapes.final.kind === 'never') return inputs;
  return { ...inputs, schema: withoutNull(shapes.final).kind === 'array' || inputs.output.kind !== 'rows' ? shapes.final : inputs.schema };
}

/** The fields of the item a step looks at: the element of a list, or the object itself. */
export function itemFields(shape: Shape): { name: string; shape: Shape; optional: boolean }[] {
  const element = elementOf(shape) ?? withoutNull(shape);
  const object = [...(element.kind === 'union' ? element.of : [element])].find(member => member.kind === 'object');
  if (!object || object.kind !== 'object') return [];
  return Object.entries(object.fields).map(([name, field]) => ({ name, shape: field.shape, optional: Boolean(field.optional) || kindsOf(field.shape).has('null') }));
}

/** What a field is, in the words of the outline's kind chips. */
export type FieldKind = 'Text' | 'Number' | 'Yes or No' | 'Date' | 'Date and Time' | 'Entity' | 'List' | 'Group' | 'Mixed' | 'Empty';
/** The kind of a shape, in words; an enum of 8 or fewer words is reported as `values`. */
export function kindWords(shape: Shape): { kind: FieldKind; values?: string[]; optional: boolean } {
  const optional = kindsOf(shape).has('null');
  const core = withoutNull(shape);
  switch (core.kind) {
    case 'never': return { kind: 'Empty', optional };
    case 'any': return { kind: 'Mixed', optional };
    case 'boolean': return { kind: 'Yes or No', optional };
    case 'number': return { kind: 'Number', optional };
    case 'string': return core.format === 'date' ? { kind: 'Date', optional } : core.format === 'date-time' ? { kind: 'Date and Time', optional }
      : core.format === 'entity-id' ? { kind: 'Entity', optional } : core.format === 'numeric' ? { kind: 'Number', optional } : core.enum?.length ? { kind: 'Text', values: core.enum, optional } : { kind: 'Text', optional };
    case 'array': return { kind: 'List', optional };
    case 'object': return { kind: 'Group', optional };
    case 'union': return { kind: 'Mixed', optional };
    default: return { kind: 'Empty', optional };
  }
}

// MARK: Steps

/** The operation of a step. */
export type PipelineStepOp = PipelineStep['op'];

/** A step's operation, in the words people use (studio-pipes D6). */
export const stepNames: Record<PipelineStep['op'], string> = {
  get: 'Go Into', 'select-key': 'Choose Entry', filter: 'Filter', sort: 'Sort', limit: 'Limit', map: 'Set Fields', group: 'Group', count: 'Count', sum: 'Add Up', first: 'First Item',
  flatten: 'Flatten', unique: 'Remove Duplicates', default: 'Fill In Missing',
  // `sh.flow-extras@1`
  min: 'Lowest', max: 'Highest', average: 'Average', 'running-sum': 'Running Total', annotate: 'Add List-Wide Values',
};
/** A new step of an operation, with the first field of the item filled in where it takes one. */
export function newStep(op: PipelineStep['op'], id: string, given?: string | string[]): PipelineStep {
  const path = Array.isArray(given) ? given : [given ?? ''], field = Array.isArray(given) ? given.join('.') : given;
  const item: Operand = { type: 'item', path };
  switch (op) {
    case 'get': return { id, op, path: given ? path : ['items'] };
    case 'select-key': return { id, op, key: { type: 'literal', value: field ?? '' } };
    case 'filter': return { id, op, where: { type: 'exists', value: item } };
    case 'sort': return { id, op, by: [{ value: item, direction: 'ascending', kind: 'text' }] };
    case 'limit': return { id, op, count: 10 };
    case 'map': return { id, op, fields: { id: item, title: item } };
    case 'group': return { id, op, by: item };
    case 'count': return { id, op };
    case 'sum': return { id, op, value: item };
    case 'first': return { id, op };
    case 'flatten': return { id, op, path: given ? path : [] };
    case 'unique': return { id, op, by: item };
    case 'default': return { id, op, path, value: { type: 'literal', value: '' } };
    case 'min': case 'max': case 'average': return { id, op, value: item };
    case 'running-sum': return { id, op, value: item, into: 'total', nullPropagates: true };
    case 'annotate': return { id, op, fields: { lowest: { aggregate: 'min', value: item } } };
  }
}
/** A step id not taken by the flow's steps. */
export function stepId(steps: readonly PipelineStep[], op: PipelineStep['op']): string {
  const taken = new Set(steps.map(item => item.id));
  let at = 1;
  while (taken.has(`${op}-${at}`)) at += 1;
  return `${op}-${at}`;
}

/**
 * The steps that fit the data arriving at a point (studio-pipes "Add Step"): a list of items offers Filter, Sort, Limit, Set Fields, Group, Count, Add Up,
 * First Item and Remove Duplicates; a group offers Go Into and Choose Entry; a value offers none. Steps that do not fit are not listed.
 */
export function stepsThatFit(shape: Shape): PipelineStep['op'][] {
  const core = withoutNull(shape);
  if (core.kind === 'any') return ['get', 'filter', 'sort', 'limit', 'map', 'count', 'first'];
  if (kindsOf(core).has('array')) {
    const element = elementOf(core);
    const objects = element !== undefined && hasObject(element);
    return objects ? ['filter', 'sort', 'limit', 'map', 'group', 'count', 'sum', 'first', 'unique', 'default', 'min', 'max', 'average', 'running-sum', 'annotate']
      : ['limit', 'count', 'first'];
  }
  if (core.kind === 'object') return isEntityKeyed(core) ? ['select-key', 'get', 'map'] : ['get', 'map', 'default'];
  return [];
}

/** One line for a step, in words ("State is on", "Largest first by days", "Keeps the first 10"). */
export function stepSummary(step: PipelineStep): string {
  const name = (operand: Operand): string => operand.type === 'item' ? operand.path.join('.') || 'this item' : operand.type === 'literal' ? String(operand.value) : operand.type === 'param' ? operand.name : 'a value';
  switch (step.op) {
    case 'get': return `Go into ${step.path.join(' › ')}`;
    case 'select-key': return step.key.type === 'literal' ? `Entry ${String(step.key.value)}` : `Entry named by ${name(step.key)}`;
    case 'filter': return predicateWords(step.where);
    case 'sort': return step.by.map(by => `${name(by.value)} ${directionWords(by)}`).join(', ');
    case 'limit': return `Keeps the first ${step.count}`;
    case 'map': return `Fields ${Object.keys(step.fields).join(', ')}`;
    case 'group': return `Groups by ${name(step.by)}`;
    case 'count': return 'Counts the items';
    case 'sum': return `Adds up ${name(step.value)}`;
    case 'first': return 'Keeps the first item';
    case 'flatten': return step.path.length ? `Joins the lists in ${step.path.join(' › ')}` : 'Joins the lists';
    case 'unique': return `One item for each ${name(step.by)}`;
    case 'default': return `${step.path.join(' › ')} is ${name(step.value) || 'empty'} when missing`;
    case 'min': return `The lowest ${name(step.value)}`;
    case 'max': return `The highest ${name(step.value)}`;
    case 'average': return `The average ${name(step.value)}`;
    case 'running-sum': return `${step.into} is the total of ${name(step.value)} so far`;
    case 'annotate': return `Every item gets ${Object.entries(step.fields).map(([field, entry]) => `${field} (${entry.aggregate === 'min' ? 'lowest' : 'highest'} ${name(entry.value)})`).join(', ')}`;
  }
}
const directionWords = (by: { direction: 'ascending' | 'descending'; kind: 'text' | 'number' | 'date' }) =>
  by.kind === 'text' ? (by.direction === 'ascending' ? 'A to Z' : 'Z to A') : by.kind === 'number' ? (by.direction === 'ascending' ? 'smallest first' : 'largest first') : (by.direction === 'ascending' ? 'oldest first' : 'newest first');
/** A sort field's direction in the words its kind uses. */
export const sortDirectionWords = directionWords;

const comparisonText: Record<string, string> = { eq: 'is', ne: 'is not', above: 'is above', below: 'is below', before: 'is before', after: 'is after' };
/** A filter's condition in one line. */
export function predicateWords(where: Predicate): string {
  const operandText = (operand: Operand): string => operand.type === 'item' ? operand.path.join('.') || 'this item' : operand.type === 'literal' ? String(operand.value)
    : operand.type === 'clock' ? (operand.part === 'today' ? 'Today' : 'Now') : operand.type === 'param' ? operand.name : 'a value';
  switch (where.type) {
    case 'compare': return `${operandText(where.left)} ${comparisonText[where.op] ?? where.op} ${operandText(where.right)}`;
    case 'in': return `${operandText(where.value)} is one of ${where.in.map(operandText).join(', ')}`;
    case 'exists': return `${operandText(where.value)} has a value`;
    case 'not': return where.of.type === 'exists' ? `${operandText(where.of.value)} has no value` : `Not ${predicateWords(where.of)}`;
    case 'all': return where.of.length === 1 ? predicateWords(where.of[0]) : `All of ${where.of.length} conditions`;
    case 'any': return where.of.length === 1 ? predicateWords(where.of[0]) : `Any of ${where.of.length} conditions`;
    default: return 'A condition';
  }
}

// MARK: Making a flow

const taken = (document: CompositionDocument, id: string) => document.dataSources.some(source => source.id === id);
/** A flow id and a title no other flow has: "flow-2", "Data Flow 2". */
export function freshNames(document: CompositionDocument, title = 'Data Flow'): { id: string; title: string } {
  const titles = new Set(flowSources(document).map(source => source.inputs.title));
  let at = 1, id = 'flow-1', named = title;
  while (taken(document, id)) { at += 1; id = `flow-${at}`; }
  at = 1;
  while (titles.has(named)) { at += 1; named = `${title} ${at}`; }
  return { id, title: named };
}

/** What a new flow needs a person has already chosen: an entity, optionally. */
export interface NewFlowOptions { entityId?: string; entityIds?: string[]; title?: string; feed?: 'todo-items' | 'weather-forecast' }
const literalEntity = (value: string) => ({ type: 'literal' as const, value });

/**
 * A new flow for each request, that compiles at once and draws something: a live to-do list gives rows of its items; a service reads a to-do
 * list's items; an attribute reads a list the entity holds; a group lists its entities; Nothing gives a fixed value.
 */
export function newFlow(document: CompositionDocument, kind: RequestKind, options: NewFlowOptions = {}): { document: CompositionDocument; id: string } {
  if (!canAddFlow(document)) throw new Error(flowLimits.flows.words);
  const { id, title } = freshNames(document, options.title);
  const source: PipelineSource = { id, kind: 'model', model: 'pipeline@1', inputs: defaultInputs(kind, title, options) };
  return { document: { ...document, dataSources: [...document.dataSources, source] }, id };
}

/** The inputs of a flow that gets its data the `kind` way, with its steps and Output filled so it compiles. Changing "Get data from" starts from these, keeping the title. */
export function defaultInputs(kind: RequestKind, title: string, options: NewFlowOptions = {}): PipelineInputs {
  const entity = options.entityId;
  const row = (idField: string, titleField: string, more: { subtitle?: string; value?: string } = {}): PipelineInputs['output'] => ({
    kind: 'rows', max: 50, row: { id: { type: 'item', path: [idField] }, title: { type: 'item', path: [titleField] }, ...(more.subtitle ? { subtitle: { type: 'item', path: [more.subtitle] } } : {}), ...(more.value ? { value: { type: 'item', path: [more.value] } } : {}) },
  });
  let inputs: PipelineInputs;
  const base = { title, parameters: [] as PipelineInputs['parameters'], schema: { kind: 'any' } as Shape };
  if (kind === 'live-list') {
    const weather = options.feed === 'weather-forecast';
    const request: PipelineRequest = weather
      ? { type: 'ha-subscription', kind: 'weather-forecast', entityId: literalEntity(entity ?? 'weather.example_home'), forecastType: forecastTypes[0] }
      : { type: 'ha-subscription', kind: 'todo-items', entityId: literalEntity(entity ?? 'todo.example_list') };
    inputs = { ...base, request, steps: [{ id: 'get-1', op: 'get', path: [weather ? 'forecast' : 'items'] }], output: weather ? row('datetime', 'condition', { value: 'temperature' }) : row('uid', 'summary', { subtitle: 'due' }) };
  } else if (kind === 'service') {
    const list = entity ?? 'todo.example_list';
    inputs = { ...base, request: { type: 'service-response', domain: 'todo', service: 'get_items', target: { entity_id: { type: 'literal', value: list } }, timeoutSeconds: 10,
      responseShape: { kind: 'object', fields: { [list]: { shape: { kind: 'object', fields: { items: { shape: { kind: 'array', of: todoItemShape } } } } } } } },
    steps: [{ id: 'select-key-1', op: 'select-key', key: { type: 'literal', value: list } }, { id: 'get-1', op: 'get', path: ['items'] }],
    output: row('uid', 'summary', { subtitle: 'due' }), refresh: { on: ['open', 'manual'], staleAfterSeconds: 300 } };
  } else if (kind === 'attribute') {
    inputs = { ...base, request: { type: 'entity-attribute', entityId: literalEntity(entity ?? 'sensor.example_sensor'), path: ['items'],
      responseShape: { kind: 'array', of: { kind: 'object', fields: { name: { shape: { kind: 'string' } } } } } },
    steps: [], output: row('name', 'name'), refresh: { on: ['open', 'manual', 'entity-change'], staleAfterSeconds: 300 } };
  } else if (kind === 'group') {
    const entities = options.entityIds?.length ? options.entityIds : [entity ?? 'light.example_lamp'];
    inputs = { ...base, request: { type: 'entities', entityIds: entities.map(literalEntity), attributes: [] }, steps: [], output: row('entityId', 'entityId', { value: 'state' }) };
  } else {
    inputs = { ...base, request: { type: 'none', value: { type: 'literal', value: 'Hello' } }, steps: [], output: { kind: 'scalar' } };
  }
  return settleFlow(inputs);
}

/** Whether a flow compiles on its own: the Studio draws a flow that does not with a red step and its reason. */
export const flowIssues = (source: PipelineSource) => checkPipelineSource(source, '/flow').issues;

/** Replaces one flow's inputs and keeps its schema following its steps. */
export function updateFlow(document: CompositionDocument, id: string, change: (inputs: PipelineInputs) => PipelineInputs): CompositionDocument {
  return { ...document, dataSources: document.dataSources.map(source => source.kind === 'model' && source.model === 'pipeline@1' && source.id === id ? { ...source, inputs: settleFlow(change(source.inputs)) } : source) };
}

/** Removes a flow and clears what pointed at it is the caller's job; this is only the source. */
export const removeFlow = (document: CompositionDocument, id: string): CompositionDocument => ({ ...document, dataSources: document.dataSources.filter(source => source.id !== id) });

/** Moves a step up or down. */
export function moveStep(steps: readonly PipelineStep[], from: number, by: -1 | 1): PipelineStep[] {
  const to = from + by;
  if (to < 0 || to >= steps.length) return [...steps];
  const next = [...steps];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Whether the output's `rows` operands name a field the final shape no longer has: the reason in words, or undefined. */
export function outputProblem(inputs: PipelineInputs): string | undefined {
  const shapes = flowShapes(inputs);
  if (!shapes.clean) return `Step ${(shapes.badStep ?? 0) + 1} does not fit the data before it.`;
  if (inputs.output.kind !== 'rows') return undefined;
  const fields = itemFields(shapes.final).map(field => field.name);
  for (const key of ['id', 'title', 'subtitle', 'value'] as const) {
    const operand = inputs.output.row[key];
    if (operand?.type === 'item' && operand.path[0] && !fields.includes(operand.path[0])) return `${inputs.title} no longer has the field “${operand.path[0]}”.`;
  }
  return undefined;
}

// MARK: Count of Entities

/**
 * "Count of Entities…": a group flow over the chosen entities, a Filter on `state` being one of the chosen words, and a Count. It reads one value.
 * `states` are the words to count ("on"); the flow is named for what it counts ("Lights On").
 */
export function countFlow(document: CompositionDocument, entityIds: readonly string[], states: readonly string[], title = 'Count'): { document: CompositionDocument; id: string } {
  const { id, title: named } = freshNames(document, title);
  const where: Predicate = states.length === 1
    ? { type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: states[0] } }
    : { type: 'in', value: { type: 'item', path: ['state'] }, in: states.map(value => ({ type: 'literal', value })) };
  const inputs: PipelineInputs = settleFlow({
    title: named, parameters: [], request: { type: 'entities', entityIds: entityIds.map(literalEntity), attributes: [] },
    steps: [{ id: 'filter-1', op: 'filter', where }, { id: 'count-1', op: 'count' }], output: { kind: 'scalar' }, schema: { kind: 'any' },
  });
  return { document: { ...document, dataSources: [...document.dataSources, { id, kind: 'model', model: 'pipeline@1', inputs }] }, id };
}

// MARK: Used by

/** One place that reads a flow: a node's slot, by the node's title and the field. */
export interface FlowUse { nodeId: string; nodeTitle: string; fields: string[] }
const isNode = (value: unknown): value is { id: string; title?: string; type: string } => Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { type?: unknown }).type === 'string';
/**
 * The nodes that read a source: any string in a node (or in a page, modal or tab) that is the source's id, by the field it sits in. A list names its flow in
 * `providerId`; a text or a condition names it in a `read`. Sources are not scanned here (a flow reading another is its parameters').
 */
export function usedBy(document: CompositionDocument, sourceId: string): FlowUse[] {
  const out = new Map<string, FlowUse>();
  const walk = (value: unknown, owner: { id: string; title: string } | undefined, field: string) => {
    if (typeof value === 'string') {
      if (value === sourceId && owner) { const found = out.get(owner.id) ?? { nodeId: owner.id, nodeTitle: owner.title, fields: [] }; if (!found.fields.includes(field)) found.fields.push(field); out.set(owner.id, found); }
      return;
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, owner, field); return; }
    if (!value || typeof value !== 'object') return;
    const here = isNode(value) ? { id: value.id, title: value.title ?? value.id } : owner;
    for (const [key, child] of Object.entries(value)) walk(child, here, key === 'id' ? field : key);
  };
  const { dataSources, ...rest } = document;
  void dataSources;
  walk(rest, undefined, '');
  return [...out.values()];
}
/** How many places read a source. */
export const usedCount = (document: CompositionDocument, sourceId: string): number => usedBy(document, sourceId).reduce((sum, use) => sum + use.fields.length, 0);
/** The words for a field name a use sits in. */
export const fieldWords = (field: string): string => field === 'providerId' ? 'Rows' : field === 'sourceId' ? 'Source' : field.replace(/([A-Z])/g, ' $1').replace(/^\w/, letter => letter.toUpperCase());

// MARK: Continue from a field

/** The steps a click on a field offers, each prefilled with it: "Filter by Due…", "Sort by Due", "Group by Due", "Fill In When Missing…". */
export function fieldSteps(kind: FieldKind): { op: PipelineStep['op']; label: (field: string) => string }[] {
  const out: { op: PipelineStep['op']; label: (field: string) => string }[] = [];
  if (kind === 'List') return [{ op: 'get', label: () => 'Go Into This List' }];
  if (kind === 'Group') return [{ op: 'get', label: () => 'Go Into This Group' }];
  out.push({ op: 'filter', label: field => `Filter by ${field}…` });
  out.push({ op: 'sort', label: field => `Sort by ${field}` });
  out.push({ op: 'group', label: field => `Group by ${field}` });
  out.push({ op: 'default', label: field => `Fill In When ${field} Is Missing…` });
  return out;
}
/** A step of an operation prefilled with a field of the item: a sort reads its kind from the field, a filter keeps items that have it. */
export function stepForField(op: PipelineStep['op'], id: string, field: string[], kind: FieldKind): PipelineStep {
  const step = newStep(op, id, field);
  if (step.op === 'sort') return { ...step, by: [{ value: { type: 'item', path: field }, direction: kind === 'Number' ? 'descending' : 'ascending', kind: kind === 'Number' ? 'number' : kind === 'Date' || kind === 'Date and Time' ? 'date' : 'text' }] };
  return step;
}
/** Adds a step at a place (`at` is the index it takes; the end by default). */
export function addStepAt(inputs: PipelineInputs, step: PipelineStep, at = inputs.steps.length): PipelineInputs {
  return { ...inputs, steps: [...inputs.steps.slice(0, at), step, ...inputs.steps.slice(at)] };
}
/** The row fields a field can fill: Title and Subtitle take any scalar, Value too, ID any scalar. */
export const rowSlots = ['title', 'subtitle', 'value', 'id'] as const;
export type RowSlot = typeof rowSlots[number];
/** What a row slot is called. */
export const rowSlotWords: Record<RowSlot, string> = { title: 'Title', subtitle: 'Subtitle', value: 'Value', id: 'ID' };
/** Whether a field of a kind can fill a row slot (text, numbers, yes or no, dates and entities can; a list or a group cannot). */
export const fillsRow = (kind: FieldKind): boolean => !['List', 'Group', 'Mixed', 'Empty'].includes(kind);
/** Points a row slot of a Rows output at a field of the item. Other outputs are left alone. */
export function pointRowAt(inputs: PipelineInputs, slot: RowSlot, field: string[]): PipelineInputs {
  if (inputs.output.kind !== 'rows') return inputs;
  return { ...inputs, output: { ...inputs.output, row: { ...inputs.output.row, [slot]: { type: 'item', path: field } } } };
}

/** The field a new step starts on, by what the step does with it: a sum wants a number, a sort a date, a number or text, the rest the first field. */
export function defaultFieldFor(op: PipelineStep['op'], shape: Shape): string[] | undefined {
  if (op === 'select-key') return [Object.keys((withoutNull(shape).kind === 'object' ? (withoutNull(shape) as Extract<Shape, { kind: 'object' }>).fields : {}))[0] ?? ''];
  const fields = itemFields(shape), words = fields.map(field => ({ name: field.name, kind: kindWords(field.shape).kind }));
  const prefer = (...kinds: FieldKind[]) => words.find(field => kinds.includes(field.kind))?.name;
  const chosen = op === 'sum' || op === 'average' ? prefer('Number') : op === 'sort' ? prefer('Date', 'Date and Time', 'Number', 'Text') : op === 'default' ? fields.find(field => field.optional)?.name
    : op === 'get' ? words.find(field => field.kind === 'List' || field.kind === 'Group')?.name : op === 'flatten' ? words.find(field => field.kind === 'List')?.name : op === 'filter' || op === 'group' || op === 'unique' ? prefer('Text', 'Number', 'Date', 'Yes or No') : undefined;
  const name = chosen ?? words[0]?.name;
  return name === undefined ? undefined : [name];
}

/** Moves a step to where `at` says, for the keyboard and the menu (one change). */
export const withoutStep = (steps: readonly PipelineStep[], at: number): PipelineStep[] => steps.filter((_, index) => index !== at);
/** Where a list of steps stands after a step is replaced. */
export const replaceStep = (steps: readonly PipelineStep[], at: number, step: PipelineStep): PipelineStep[] => steps.map((item, index) => index === at ? step : item);
/** "42 → 18" for a step that keeps some of a list, "18" for one that gives a value, and "" when nothing ran. */
export function countWords(before: number | null | undefined, after: number | null | undefined): string {
  if (after === undefined) return '';
  if (after === null) return '';
  return before !== undefined && before !== null && before !== after ? `${before} → ${after}` : String(after);
}
