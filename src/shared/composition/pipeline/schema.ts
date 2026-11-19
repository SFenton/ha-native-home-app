import { z } from 'zod/v4';
import { identifierSchema } from '../../validation';
import { shapeSchema, type Shape } from './shape';
import { compareOperations, mathArity, mathOperations, operandBase, parameterName, predicateBase, type Operand, type Predicate } from '../expression';

/**
 * The `sh.pipeline@1` contract: a Data Flow as a document data source (`kind: 'model'`, `model: 'pipeline@1'`).
 *
 * A flow asks Home Assistant for data (a service with a response, an entity attribute, or a live subscription from a closed list),
 * runs a closed, pure list of steps on the answer, and gives rows, a record or one value. It never carries a URL, a header or a key:
 * a request names a Home Assistant service, and Home Assistant holds the secrets. Every object is strict, so an unknown field is
 * refused rather than ignored (a published layout that an older app reads half-way is worse than one it refuses).
 *
 * `sh.pipeline-operands@1` covers the four operand variants that exist only inside a flow: `item`, `param`, `clock` and `date`.
 */
const object = z.strictObject;
const id = identifierSchema;
const text = (maximum: number) => z.string().max(maximum).refine(value => Boolean(value.trim()));
const integer = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);

export const PIPELINE_LIMITS = {
  pipelines: 128, entities: 64, entityAttributes: 8, parameters: 8, steps: 32, sortKeys: 4, rows: 100, limit: 1000, mapFields: 32, entityIds: 8, path: 8,
  operandDepth: 8, operandNodes: 64, whereNodes: 32, timeout: { min: 1, max: 30 }, stale: { min: 30, max: 86_400 },
} as const;

// MARK: Closed lists

export const parameterTypes = ['string', 'number', 'boolean', 'entity-id'] as const;
export const refreshTriggers = ['open', 'manual', 'entity-change'] as const;
export const forecastTypes = ['daily', 'hourly', 'twice_daily'] as const;
export const subscriptionKinds = ['todo-items', 'weather-forecast'] as const;
export const sortKinds = ['text', 'number', 'date'] as const;
export { compareOperations };
export const stepOperations = ['get', 'select-key', 'filter', 'sort', 'limit', 'map', 'group', 'count', 'sum', 'average', 'first', 'flatten', 'unique', 'default'] as const;
/** The steps that need `sh.flow-extras@1`: two list aggregates, a running total and a list-wide value written onto each item. */
export const flowExtrasSteps = ['min', 'max', 'running-sum', 'annotate'] as const;
/** The aggregates `annotate` writes onto every item of the list. */
export const annotateAggregates = ['min', 'max'] as const;
export { mathOperations };
export { mathArity };
export type ReadKind = 'string' | 'number' | 'boolean' | 'entity-id';

// MARK: Operands

/**
 * An operand inside a flow is the shared operand (`expression.ts`): the generic grammar's `literal`, `read`, `viewer`, `format`, `map`, `math`,
 * `object` and `list`, the flow variants `item` (a field of the item a step is looking at), `param` (a declared parameter), `clock` (today or
 * now on the viewer's clock) and `date` (whole days between two dates), and the rule value `choose`. `control` has no meaning here and the
 * compiler refuses it. Where each may stand is the compiler's rule, not the schema's: `read` only in a parameter, `viewer` only in a parameter
 * or the request, `item` only in a step or a row.
 */
export type PipelineOperand = Operand;
/** A path through objects: 1 to 8 segments of `[A-Za-z0-9_-]`, never all digits (a list cannot be indexed). */
const segments = (minimum: number) => z.array(z.string().max(64)).min(minimum).max(PIPELINE_LIMITS.path);
export { parameterName };
const operand: z.ZodType<PipelineOperand> = operandBase;
export const pipelineOperandSchema = operand;
const objectOperand = object({ type: z.literal('object'), fields: z.record(z.string(), operand) });

// MARK: Conditions and steps

/**
 * A condition is the shared condition (`expression.ts`): `all`, `any`, `not`, `compare`, `in` and `exists`, and the document leaves `state`,
 * `numeric`, `viewer` and `viewer-person`. `eq` and `ne` compare scalars, `above` and `below` numbers, `before` and `after` dates (to the second).
 */
export type Where = Predicate;
const where: z.ZodType<Where> = predicateBase;
const stepId = { id };
/** The name of a field a step writes onto each item. */
const fieldName = z.string().max(160);
const path = (minimum: number) => segments(minimum);
export const stepSchema = z.discriminatedUnion('op', [
  object({ ...stepId, op: z.literal('get'), path: path(1) }),
  object({ ...stepId, op: z.literal('select-key'), key: operand }),
  object({ ...stepId, op: z.literal('filter'), where }),
  object({
    ...stepId, op: z.literal('sort'),
    by: z.array(object({ value: operand, direction: z.enum(['ascending', 'descending']), kind: z.enum(sortKinds) })).min(1).max(PIPELINE_LIMITS.sortKeys),
  }),
  object({ ...stepId, op: z.literal('limit'), count: integer(1, PIPELINE_LIMITS.limit) }),
  object({ ...stepId, op: z.literal('map'), fields: z.record(z.string(), operand) }),
  object({ ...stepId, op: z.literal('group'), by: operand }),
  object({ ...stepId, op: z.literal('count') }),
  object({ ...stepId, op: z.literal('sum'), value: operand }),
  object({ ...stepId, op: z.literal('first') }),
  object({ ...stepId, op: z.literal('flatten'), path: path(0) }),
  object({ ...stepId, op: z.literal('unique'), by: operand }),
  object({ ...stepId, op: z.literal('default'), path: path(1), value: operand }),
  // `sh.flow-extras@1`: aggregates and scans over a list (see `FLOW_EXTRAS_CAPABILITY`).
  object({ ...stepId, op: z.literal('min'), value: operand }),
  object({ ...stepId, op: z.literal('max'), value: operand }),
  object({ ...stepId, op: z.literal('average'), value: operand }),
  object({ ...stepId, op: z.literal('running-sum'), value: operand, into: fieldName, nullPropagates: z.boolean() }),
  object({ ...stepId, op: z.literal('annotate'), fields: z.record(z.string(), object({ aggregate: z.enum(annotateAggregates), value: operand })) }),
]);
export type PipelineStep = z.infer<typeof stepSchema>;

// MARK: Request, output, refresh

const literalEntity = object({ type: z.literal('literal'), value: text(160) });
const target = object({
  entity_id: operand.optional(), device_id: operand.optional(), area_id: operand.optional(), floor_id: operand.optional(), label_id: operand.optional(),
});
/**
 * How a flow gets its data. Never a URL or a key.
 * - `service-response`: a Home Assistant service that answers with data (the to-do domain's `get_items`, a script, a REST command). `responseShape` is the
 *   authored shape of the answer the steps are typed against.
 * - `entity-attribute`: an attribute of one entity the app already holds, read from the entity store. `path` starts with the attribute.
 * - `entities`: the state and chosen attributes of up to 64 entities the app already holds; no `refresh`, the flow runs when one changes.
 * - `none`: no data; `value` is an operand over the parameters, the viewer and the clock.
 * - `ha-subscription`: a live feed from a closed list, held on the app's one connection. The answer's shape is fixed by `kind`.
 *
 * TODO(studio): a `service-response` of the to-do domain's `get_items` is accepted; the Studio will later suggest the live `todo-items` source for it.
 */
export const requestSchema = z.discriminatedUnion('type', [
  object({
    type: z.literal('service-response'),
    domain: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), service: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    target: target.optional(), data: objectOperand.optional(),
    timeoutSeconds: integer(PIPELINE_LIMITS.timeout.min, PIPELINE_LIMITS.timeout.max), responseShape: shapeSchema,
  }),
  object({ type: z.literal('entity-attribute'), entityId: literalEntity, path: path(1), responseShape: shapeSchema }),
  // Up to 64 literal entities the app already holds, read from the entity store; rows are `{entityId, state, ...attributes}`. No refresh: the flow
  // runs again when an observed entity changes.
  object({
    type: z.literal('entities'), entityIds: z.array(literalEntity).min(1).max(PIPELINE_LIMITS.entities),
    attributes: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(PIPELINE_LIMITS.entityAttributes),
  }),
  // No data from anywhere: the value is an operand over the parameters, the viewer and the clock.
  object({ type: z.literal('none'), value: operand }),
  z.discriminatedUnion('kind', [
    object({ type: z.literal('ha-subscription'), kind: z.literal('todo-items'), entityId: literalEntity }),
    object({ type: z.literal('ha-subscription'), kind: z.literal('weather-forecast'), entityId: literalEntity, forecastType: z.enum(forecastTypes) }),
  ]),
]);
export type PipelineRequest = z.infer<typeof requestSchema>;

/** What the flow gives: a list of rows, a list of records (`sh.repeat@1`), one record, or one value. The final value of the steps is what is given; `schema` is its shape. */
export const outputSchema = z.discriminatedUnion('kind', [
  object({
    kind: z.literal('rows'), max: integer(1, PIPELINE_LIMITS.rows),
    row: object({ id: operand, title: operand, subtitle: operand.optional(), value: operand.optional() }),
  }),
  object({ kind: z.literal('record') }),
  object({ kind: z.literal('scalar') }),
  // `sh.repeat@1`: the final list, every item an object typed by `schema`, for a `repeat` node to draw.
  object({ kind: z.literal('records'), max: integer(1, PIPELINE_LIMITS.rows) }),
]);
export type PipelineOutput = z.infer<typeof outputSchema>;

/**
 * When a flow runs again. Present only for a `service-response` or `entity-attribute` request; a live subscription runs its steps again
 * on every push and takes no `refresh`. There is no timer: Home Assistant reports changes, and a person can pull to refresh.
 * `entityIds` names what to watch for a service (up to 8); an attribute watches its own entity.
 */
export const refreshSchema = object({
  on: z.array(z.enum(refreshTriggers)).min(1).max(3),
  entityIds: z.array(literalEntity).min(1).max(PIPELINE_LIMITS.entityIds).optional(),
  staleAfterSeconds: integer(PIPELINE_LIMITS.stale.min, PIPELINE_LIMITS.stale.max),
});

export const pipelineInputsSchema = object({
  title: text(240),
  parameters: z.array(object({ name: parameterName, type: z.enum(parameterTypes), value: operand })).max(PIPELINE_LIMITS.parameters),
  request: requestSchema,
  steps: z.array(stepSchema).max(PIPELINE_LIMITS.steps),
  output: outputSchema,
  /** The authored shape of the final value. The compiler proves the steps produce it; nodes read against it. */
  schema: shapeSchema,
  refresh: refreshSchema.optional(),
  /** Which clock `clock` operands and dates use: the device's or the home's. Absent means the device's. */
  clock: object({ zone: z.enum(['device', 'home']) }).optional(),
});
export type PipelineInputs = z.infer<typeof pipelineInputsSchema>;
export const pipelineSourceSchema = object({ id, kind: z.literal('model'), model: z.literal('pipeline@1'), inputs: pipelineInputsSchema });
export type PipelineSource = z.infer<typeof pipelineSourceSchema>;
export type { Shape };
