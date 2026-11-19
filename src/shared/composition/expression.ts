import { z } from 'zod/v4';
import { shapeAt, type Shape } from './pipeline/shape';
import { identifierSchema } from '../validation';
import type { Json } from '../types';
import type { CompositionIssue } from './json';
import { attachSchemaAccounting, beginSchemaAccounting, reportAccounting } from './studio-logic/accounting';

/**
 * The generic grammar the native app accepts (`ServerUIOperand`, `ServerUIPredicate`, `ServerUICallService`,
 * `ServerUIExpressionParser`): a closed operand and predicate language, authored `call-service` actions and per-node
 * `visibleWhen` rules. There is no template language. `checkOperand`, `checkPredicate` and `checkCallService` port the
 * app parser's limits and combination rules with the same pointers; the Zod schemas carry the structure.
 */
const object = z.strictObject;
const id = identifierSchema;
const text = (maximum: number, blank = false) => z.string().max(maximum).refine(value => blank || Boolean(value.trim()));

export const MAX_EXPRESSION_DEPTH = 8;
export const MAX_EXPRESSION_NODES = 64;
export const MAX_CALL_NODES = 128;
export const callTargetKeys = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'] as const;
/** The math operations; `truncate` (toward zero, 1 or 2 arguments) is `sh.math-truncate@1`. */
export const mathOperations = ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'round', 'clamp', 'scale', 'truncate'] as const;
export const compareOperations = ['eq', 'ne', 'above', 'below', 'before', 'after'] as const;
export const parameterName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/);
export const MAX_CONDITION_NODES = 32;
export const MAX_CONDITION_DEPTH = 6;
export const MAX_RULE_CASES = 16;
/** The most entries a `count` operand tests (`sh.count@1`). One test each, so a full count is 33 nodes of the 64 an expression may hold. */
export const MAX_COUNT_ENTRIES = 32;
/** A `person.*` entity id, the form a `count` entry's viewer filter lists (`sh.count@1`). */
export const PERSON_ENTITY_ID = /^person\.[a-z0-9_]+$/;
export const whenUnknownPolicies = ['show', 'hide', 'keep'] as const;
/** What `enabledWhen` does while its condition cannot be answered (`sh.enabled-when@1`): enabled, disabled, or keep what it was. */
export const enabledUnknownPolicies = ['enabled', 'disabled', 'keep'] as const;
/** The date styles a `format` operand offers (six under `sh.pipeline-operands@1`, `hour` and `weekday` under `sh.flow-extras@1`), drawn in the phone's language and region. */
export const dateStyles = ['short-date', 'long-date', 'weekday-date', 'time', 'date-time', 'relative', 'hour', 'weekday'] as const;
/** The two date styles that need `sh.flow-extras@1`: the hour (`7 PM`) and the short weekday (`Mon`). */
export const flowExtrasDateStyles: readonly DateStyle[] = ['hour', 'weekday'];
/** The ways a `date` operand measures two moments: whole days between them, or how far the clock is from the first to the second (`sh.flow-extras@1`). */
export const dateOperations = ['days-between', 'progress', 'seconds-between'] as const;
/** What a `clock` operand reads: today's date, the wall time now (to the minute's tick), or the wall time now to the second (`sh.countdown@1`, a 1 Hz tick). */
export const clockParts = ['today', 'now', 'now-second'] as const;
/**
 * The styles of a duration `format` spec (`sh.duration-format@1`). The argument is a number of seconds (`unit` `minutes` on `compact` says minutes):
 * `compact` `30m`, `1h 30m`; `clock` `05:00`, `01:00:00`; `minutes-seconds` `4:30`; `span` `1 hour`, `3 days`, `3 weeks`, `2 months`.
 */
export const durationStyles = ['compact', 'clock', 'minutes-seconds', 'span'] as const;
/** The unit of a `compact` duration's number. */
export const durationUnits = ['seconds', 'minutes'] as const;
export type DurationStyle = typeof durationStyles[number];
export type DurationUnit = typeof durationUnits[number];
export type DateStyle = typeof dateStyles[number];
/**
 * The cases a text format asks for: `title` capitalizes after each underscore (`sh.pipeline-operands@1`), `words` after each underscore and each space
 * (`sh.text-case-words@1`, its own id so the vacuum's "Wheel Stuck" need not wait for the pipeline).
 */
export const textCases = ['title', 'words'] as const;
export type TextCase = typeof textCases[number];
/**
 * How one argument of a `format` operand is drawn: a number with at most six fraction digits (and, from `sh.pipeline-operands@1`, at least
 * `minimumFractionDigits` of them, so `72.0` keeps its zero), a date in one of the closed styles, or text with a capital on each word (`title`: `sh.pipeline-operands@1`; `words`: `sh.text-case-words@1`).
 */
export type FormatSpec = { number: { maximumFractionDigits: number; minimumFractionDigits?: number } } | { date: { style: DateStyle } } | { text: { case: TextCase } }
  | { duration: { style: DurationStyle; unit?: DurationUnit } };
/** The number of arguments each math operation takes. */
export const mathArity: Record<typeof mathOperations[number], [number, number]> = {
  add: [2, 8], multiply: [2, 8], min: [2, 8], max: [2, 8], subtract: [2, 2], divide: [2, 2], round: [1, 2], clamp: [3, 3], scale: [5, 5], truncate: [1, 2],
};

// MARK: Types

/**
 * One entry of a `count` operand (`sh.count@1`): a condition over one or more entities' state or attributes, counted once when it holds, and an optional
 * viewer filter. With `viewer`, the entry is considered only while the signed-in person is one of the listed `person.*` entities, so one list can give
 * each person a different count.
 */
export type CountEntry = { test: Predicate; viewer?: { personEntityIds: string[] } };

export type Operand =
  | { type: 'literal'; value: Json }
  | { type: 'read'; from: { type: 'source'; sourceId: string; path: string[] }; as: 'string' | 'number' | 'boolean' | 'entity-id'; missing: 'unavailable' }
  /** The value a control is sending. Inside a dial control's one call, `stopper` names which stopper's value (`sh.dial-control@1`). */
  | { type: 'control'; stopper?: string }
  | { type: 'viewer'; field: 'userId' | 'isAdmin' | 'personEntityId' }
  | { type: 'format'; pattern: string; args: Record<string, Operand>; formats?: Record<string, FormatSpec> }
  // Reads of an entity that the plain `read` cannot give. Never inside a flow.
  /** The state text of an `ha-entity` source exactly as Home Assistant reports it, `unknown` and `unavailable` included (`sh.raw-state@1`). */
  | { type: 'raw-state'; sourceId: string }
  /** When the state of an `ha-entity` source last changed, as `YYYY-MM-DDTHH:MM:SS.sssZ` (`sh.entity-time@1`): text, or unavailable while the entity is. */
  | { type: 'last-changed'; sourceId: string }
  /** How many items the list attribute of an `ha-entity` source holds (`sh.list-read@1`): a number. */
  | { type: 'list-count'; from: { type: 'source'; sourceId: string; path: string[] } }
  /** Whether the list attribute of an `ha-entity` source holds an item equal to `value` (`sh.list-read@1`): yes or no. */
  | { type: 'list-includes'; from: { type: 'source'; sourceId: string; path: string[] }; value: Operand }
  /**
   * How many of its entries' conditions hold (`sh.count@1`): a number from 0 to the number of entries, evaluated once. It costs one node plus the nodes of
   * its tests, so 32 entities is 33 nodes. An entry that cannot be answered is not counted; the count is itself unavailable (or loading) only when every
   * entry in play cannot be answered. Never inside a flow.
   */
  | { type: 'count'; of: CountEntry[] }
  | { type: 'map'; of: Operand; cases: { equals: string | number | boolean; then: Operand }[]; otherwise: Operand }
  | { type: 'math'; op: typeof mathOperations[number]; args: Operand[] }
  | { type: 'object'; fields: Record<string, Operand> }
  | { type: 'list'; items: Operand[] }
  // Flow variants, gated by `sh.pipeline-operands@1`; `item` and `param` stand only inside a flow (the compiler's rule).
  | { type: 'item'; path: string[] }
  | { type: 'param'; name: string }
  | { type: 'clock'; part: typeof clockParts[number] }
  | { type: 'date'; op: typeof dateOperations[number]; from: Operand; to: Operand }
  /** The 0-based position of the item a step or a repeat is looking at (`sh.repeat@1`). */
  | { type: 'index' }
  // The rule value, gated by `sh.rules@1`: the first case whose condition holds, else `otherwise`.
  | { type: 'choose'; cases: { when: Predicate; then: Operand }[]; otherwise: Operand };
export type ObjectOperand = Extract<Operand, { type: 'object' }>;
export type Predicate =
  | { type: 'state'; sourceId: string; path: string[]; in: string[] }
  | { type: 'numeric'; sourceId: string; path: string[]; above?: Operand; below?: Operand }
  | { type: 'viewer'; isAdmin?: boolean; userIds?: string[] }
  | { type: 'viewer-person'; in: string[] }
  | { type: 'all' | 'any'; of: Predicate[] }
  | { type: 'not'; of: Predicate }
  // Leaves over operands, gated by `sh.conditions@1` outside a flow.
  | { type: 'compare'; op: typeof compareOperations[number]; left: Operand; right: Operand }
  | { type: 'in'; value: Operand; in: Operand[] }
  | { type: 'exists'; value: Operand };
/** A condition: the one name for a predicate, wherever it stands (`visibleWhen`, a flow's `where`, a rule's `when`). */
export type Condition = Predicate;
export type WhenUnknown = typeof whenUnknownPolicies[number];

// MARK: Structure

const sourcePath = z.array(z.string().max(160)).min(1).max(8);
export const operandBase: z.ZodType<Operand> = z.lazy(() => z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.json()), z.record(z.string(), z.json())]) }),
  object({
    type: z.literal('read'), from: object({ type: z.literal('source'), sourceId: id, path: sourcePath }),
    as: z.enum(['string', 'number', 'boolean', 'entity-id']), missing: z.literal('unavailable'),
  }),
  object({ type: z.literal('control'), stopper: id.optional() }),
  object({ type: z.literal('viewer'), field: z.enum(['userId', 'isAdmin', 'personEntityId']) }),
  object({
    type: z.literal('format'), pattern: z.string().max(2000), args: z.record(z.string(), operandBase),
    formats: z.record(z.string(), z.union([
      object({ number: object({ maximumFractionDigits: z.number().int().min(0).max(6), minimumFractionDigits: z.number().int().min(0).max(6).optional() }) }),
      object({ date: object({ style: z.enum(dateStyles) }) }),
      object({ text: object({ case: z.enum(textCases) }) }),
      object({ duration: object({ style: z.enum(durationStyles), unit: z.enum(durationUnits).optional() }) }),
    ])).optional(),
  }),
  object({ type: z.literal('raw-state'), sourceId: id }),
  object({ type: z.literal('last-changed'), sourceId: id }),
  object({ type: z.literal('list-count'), from: object({ type: z.literal('source'), sourceId: id, path: sourcePath }) }),
  object({ type: z.literal('list-includes'), from: object({ type: z.literal('source'), sourceId: id, path: sourcePath }), value: operandBase }),
  object({
    type: z.literal('count'),
    of: z.array(object({
      test: predicateBase,
      viewer: object({ personEntityIds: z.array(z.string().min(1).max(255)).min(1).max(MAX_COUNT_ENTRIES) }).optional(),
    })).min(1).max(MAX_COUNT_ENTRIES),
  }),
  object({
    type: z.literal('map'), of: operandBase,
    cases: z.array(object({ equals: z.union([z.string(), z.number(), z.boolean()]), then: operandBase })).max(32),
    otherwise: operandBase,
  }),
  object({ type: z.literal('math'), op: z.enum(mathOperations), args: z.array(operandBase).max(8) }),
  object({ type: z.literal('object'), fields: z.record(z.string(), operandBase) }),
  object({ type: z.literal('list'), items: z.array(operandBase).max(64) }),
  object({ type: z.literal('item'), path: z.array(z.string().max(64)).min(0).max(8) }),
  object({ type: z.literal('param'), name: parameterName }),
  object({ type: z.literal('clock'), part: z.enum(clockParts) }),
  object({ type: z.literal('date'), op: z.enum(dateOperations), from: operandBase, to: operandBase }),
  object({ type: z.literal('index') }),
  object({
    type: z.literal('choose'), cases: z.array(object({ when: predicateBase, then: operandBase })).min(1).max(MAX_RULE_CASES), otherwise: operandBase,
  }),
]));
const objectOperand = object({ type: z.literal('object'), fields: z.record(z.string(), operandBase) });
export const predicateBase: z.ZodType<Predicate> = z.lazy(() => z.discriminatedUnion('type', [
  object({ type: z.literal('state'), sourceId: id, path: sourcePath, in: z.array(text(160)).min(1).max(32) }),
  object({ type: z.literal('numeric'), sourceId: id, path: sourcePath, above: operandBase.optional(), below: operandBase.optional() }),
  object({ type: z.literal('viewer'), isAdmin: z.boolean().optional(), userIds: z.array(text(160)).min(1).max(32).optional() }),
  object({ type: z.literal('viewer-person'), in: z.array(text(160)).min(1).max(32) }),
  object({ type: z.enum(['all', 'any']), of: z.array(predicateBase).min(1).max(16) }),
  object({ type: z.literal('not'), of: predicateBase }),
  object({ type: z.literal('compare'), op: z.enum(compareOperations), left: operandBase, right: operandBase }),
  object({ type: z.literal('in'), value: operandBase, in: z.array(operandBase).min(1).max(16) }),
  object({ type: z.literal('exists'), value: operandBase }),
]));
const confirmationSchema = z.discriminatedUnion('type', [
  object({ type: z.literal('policy') }),
  object({
    type: z.literal('additional'), style: z.enum(['alert', 'dialog']), title: text(240),
    message: text(2000, true).optional(), confirmLabel: text(240), cancelLabel: z.literal('Cancel'), destructive: z.boolean(),
    exemptUserIds: z.array(text(160)).min(1).max(32).optional(),
    /** Ask only when this holds (`sh.confirm-when@1`); with none, always ask. A condition that cannot be answered asks. */
    when: predicateBase.optional(),
  }),
]);
const optimisticSchema = object({
  sourceId: id, value: text(160), revertAfterSeconds: z.number().min(0.1).max(60), failsOnTimeout: z.boolean(),
});
const callServiceBase = object({
  type: z.literal('call-service'),
  domain: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), service: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  target: object({
    entity_id: operandBase.optional(), device_id: operandBase.optional(), area_id: operandBase.optional(),
    floor_id: operandBase.optional(), label_id: operandBase.optional(),
  }).optional(),
  data: objectOperand.optional(),
  optimistic: z.array(optimisticSchema).max(16).optional(),
  confirmation: confirmationSchema.optional(),
  feedback: z.literal('policy').optional(),
});
export type CallService = z.infer<typeof callServiceBase>;
export type CallConfirmation = z.infer<typeof confirmationSchema>;

// MARK: Parser port

/**
 * Where `item` and `index` may stand in a document's slots (`sh.repeat@1`): inside the template of a `repeat`, whose records have `shape`. A `placeholder`
 * template has no record, so `item` is refused there and `index` stays. `lenient` is the schema's own pass, which leaves the decision to the compiler's
 * walk (it knows where a node sits); an absent scope refuses both.
 */
export type ItemScope = { shape: Shape; placeholder?: boolean } | 'lenient';

/** What a walk over an authored expression found, beyond the issues. */
export interface ExpressionFacts {
  issues: CompositionIssue[];
  /** Sources named by a read or a predicate, for the compiler's reference checks. */
  references: { sourceId: string; path: string[]; pointer: string; kind: 'string' | 'number' | 'boolean' | 'entity-id' | undefined;
    /** Set for `raw-state`, `last-changed` and the list reads, which stand only on an `ha-entity` source; `list` also needs an attribute path. */ entityOnly?: 'raw' | 'changed' | 'list' }[];
  optimisticReferences: { sourceId: string; pointer: string }[];
  usedOperands: boolean;
  usesControl: boolean;
  /** Capability names (without `sh.` and `@1`) the walk found beyond the base grammar: `pipeline-operands`, `conditions`, `rules`. */
  needs: Set<string>;
}

export type BudgetScopeKind = 'expression' | 'predicate' | 'flow-operand' | 'flow-condition';
/** Synchronous, read-only snapshots of actual checker visits, not a second AST walk. Null limits/remaining mean uncapped. */
export type BudgetAccountingEvent =
  | { readonly type: 'scope'; readonly scopeId: string; readonly kind: BudgetScopeKind; readonly pointer: string; readonly nodeLimit: number | null; readonly depthLimit: number | null }
  // Cumulative scope snapshots: attempts include refused entries; charges exclude them.
  | { readonly type: 'node'; readonly scopeId: string; readonly pointer: string; readonly depth: number; readonly charged: boolean;
    readonly nodes: number; readonly attemptedNodes: number; readonly maxDepth: number; readonly maxChargedDepth: number; readonly remaining: number | null }
  | { readonly type: 'condition-budget'; readonly action: 'reset' | 'restore'; readonly pointer: string;
    readonly previousScopeId: string; readonly scopeId: string; readonly previousRemaining: number | null; readonly remaining: number | null }
  | { readonly type: 'rule-cases'; readonly pointer: string; readonly count: number; readonly limit: number }
  | { readonly type: 'steps'; readonly scopeId: string; readonly pointer: string; readonly count: number; readonly limit: number }
  /** A structural refusal with no safely traversable Checker root. No partial traversal events are retained. */
  | { readonly type: 'schema-limit'; readonly pointer: string; readonly count: number; readonly limit: number;
    readonly direction: 'minimum' | 'maximum'; readonly partial: true };
export type BudgetAccountingObserver = (event: BudgetAccountingEvent) => void;

/** Observer-only state shared by the expression and flow checkers. Never constructed on the unobserved path. */
export class BudgetAccountingScope {
  readonly id: string;
  private nodes = 0;
  private attemptedNodes = 0;
  private maxDepth = 0;
  private maxChargedDepth = 0;
  constructor(readonly observer: BudgetAccountingObserver, kind: BudgetScopeKind, pointer: string, nodeLimit: number | null, depthLimit: number | null, scopeId = `${kind}:${pointer}`) {
    this.id = scopeId;
    reportAccounting(observer, { type: 'scope', scopeId: this.id, kind, pointer, nodeLimit, depthLimit });
  }
  enter(pointer: string, depth: number, charged: boolean, remaining: number) {
    this.attemptedNodes += 1;
    this.maxDepth = Math.max(this.maxDepth, depth);
    if (charged) { this.nodes += 1; this.maxChargedDepth = Math.max(this.maxChargedDepth, depth); }
    reportAccounting(this.observer, { type: 'node', scopeId: this.id, pointer, depth, charged, nodes: this.nodes, attemptedNodes: this.attemptedNodes,
      maxDepth: this.maxDepth, maxChargedDepth: this.maxChargedDepth, remaining: Number.isFinite(remaining) ? remaining : null });
  }
}

// Synchronous observation is scoped and reentrant; unobserved instances need neither fields nor WeakMap lookups.
let accountingChecker: Checker | undefined;
let checkerAccounting: { observer: BudgetAccountingObserver; expression?: BudgetAccountingScope; predicate?: BudgetAccountingScope } | undefined;
function observing<T>(checker: Checker, observer: BudgetAccountingObserver, run: () => T): T {
  const previousChecker = accountingChecker, previous = checkerAccounting;
  accountingChecker = checker; checkerAccounting = { observer };
  try { return run(); }
  finally { accountingChecker = previousChecker; checkerAccounting = previous; }
}

/** Walks operands, predicates and calls with the app parser's budget, depth, text and combination rules. */
class Checker implements ExpressionFacts {
  issues: CompositionIssue[] = [];
  references: ExpressionFacts['references'] = [];
  optimisticReferences: ExpressionFacts['optimisticReferences'] = [];
  usedOperands = false;
  usesControl = false;
  needs = new Set<string>();
  private budget = 0;
  /** Nodes left for the condition being walked; unlimited for a document predicate, whose shipped limits are the operand ones. */
  private conditionBudget = Number.POSITIVE_INFINITY;
  /** `flow` is true inside a Data Flow, where `item` and `param` may stand and `control` may not. */
  /**
   * `controlStoppers` is the stopper ids of a dial control's one call (`sh.dial-control@1`): there every `control` names one of them. `'any'` is the
   * schema's own pass, which leaves that to the compiler. Absent, a `control` names none (a bound control, a swipe, or a stopper's own call).
   */
  constructor(private readonly allowControl: boolean, private readonly flow = false, private readonly scope?: ItemScope, private readonly controlStoppers?: readonly string[] | 'any') {}
  add(code: CompositionIssue['code'], pointer: string) { this.issues.push({ code, pointer }); }
  start(nodes: number, pointer: string) {
    this.budget = nodes;
    const accounting = accountingChecker === this ? checkerAccounting : undefined;
    if (accounting) {
      accounting.expression = new BudgetAccountingScope(accounting.observer, 'expression', pointer, nodes, MAX_EXPRESSION_DEPTH);
      accounting.predicate = new BudgetAccountingScope(accounting.observer, 'predicate', pointer, null, null, `predicate:${pointer}:initial`);
    }
  }
  beginCondition(pointer: string) {
    const accounting = accountingChecker === this ? checkerAccounting : undefined;
    if (accounting) {
      const previousScopeId = accounting.predicate!.id;
      accounting.predicate = new BudgetAccountingScope(accounting.observer, 'predicate', pointer, MAX_CONDITION_NODES, MAX_CONDITION_DEPTH);
      reportAccounting(accounting.observer, { type: 'condition-budget', action: 'reset', pointer, previousScopeId, scopeId: accounting.predicate.id,
        previousRemaining: Number.isFinite(this.conditionBudget) ? this.conditionBudget : null, remaining: MAX_CONDITION_NODES });
    }
    this.conditionBudget = MAX_CONDITION_NODES;
  }
  private enter(pointer: string, depth: number): boolean {
    const accounting = accountingChecker === this ? checkerAccounting : undefined;
    if (depth > MAX_EXPRESSION_DEPTH || this.budget <= 0) {
      accounting?.expression!.enter(pointer, depth, false, this.budget);
      this.add('limit_exceeded', pointer); return false;
    }
    this.budget -= 1;
    accounting?.expression!.enter(pointer, depth, true, this.budget);
    return true;
  }
  operand(value: Operand, pointer: string, depth: number) {
    if (!this.enter(pointer, depth)) return;
    this.usedOperands = true;
    const at = (...parts: (string | number)[]) => parts.reduce<string>((base, part) => `${base}/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`, pointer);
    switch (value.type) {
      case 'literal': this.literal(value.value, at('value'), 1); break;
      case 'read':
        this.path(value.from.path, at('from', 'path'));
        this.references.push({ sourceId: value.from.sourceId, path: value.from.path, pointer, kind: value.as });
        break;
      case 'control':
        if (!this.allowControl || this.flow) this.add('invalid_combination', pointer);
        this.usesControl = true;
        if (value.stopper !== undefined) this.needs.add('dial-control');
        if (this.controlStoppers !== 'any') {
          // Inside a dial control's one call the stopper is required and must be one of the node's; anywhere else it may not stand.
          if (this.controlStoppers === undefined) { if (value.stopper !== undefined) this.add('invalid_combination', at('stopper')); }
          else if (value.stopper === undefined) this.add('invalid_combination', pointer);
          else if (!this.controlStoppers.includes(value.stopper)) this.add('invalid_reference', at('stopper'));
        }
        break;
      case 'viewer': break;
      case 'format': {
        const names = Object.keys(value.args);
        if (names.length > 16) this.add('limit_exceeded', at('args'));
        for (const key of names.sort()) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(key)) this.add('invalid_value', at('args', key));
          this.operand(value.args[key], at('args', key), depth + 1);
        }
        let rest = value.pattern;
        for (let open = rest.indexOf('{'); open >= 0; open = rest.indexOf('{')) {
          const close = rest.indexOf('}', open);
          if (close < 0) { this.add('invalid_value', at('pattern')); break; }
          if (!Object.hasOwn(value.args, rest.slice(open + 1, close))) this.add('invalid_reference', at('pattern'));
          rest = rest.slice(close + 1);
        }
        if (!value.pattern.trim()) this.add('invalid_value', at('pattern'));
        for (const key of Object.keys(value.formats ?? {}).sort()) {
          if (!Object.hasOwn(value.args, key)) { this.add('invalid_reference', at('formats', key)); continue; }
          // A date style draws a date or a date and time: text. A kind that is known and is not text cannot be one. Title case draws text too.
          const spec = value.formats![key];
          if ('duration' in spec) {
            // A duration draws a number of seconds (or minutes, for a compact one): text. `unit` only means something to `compact`.
            this.needs.add('duration-format');
            if (spec.duration.unit !== undefined && spec.duration.style !== 'compact') this.add('invalid_combination', at('formats', key, 'duration', 'unit'));
            const kind = operandKind(value.args[key]);
            if (kind !== undefined && kind !== 'number') this.add('binding_type', at('formats', key));
          } else if ('date' in spec || 'text' in spec) {
            // `title` is the pipeline's; `words` stands alone under its own id.
            this.needs.add('text' in spec && spec.text.case === 'words' ? 'text-case-words' : 'pipeline-operands');
            if ('date' in spec && flowExtrasDateStyles.includes(spec.date.style)) this.needs.add('flow-extras');
            const kind = operandKind(value.args[key]);
            if (kind !== undefined && kind !== 'string') this.add('binding_type', at('formats', key));
          } else if (spec.number.minimumFractionDigits !== undefined) {
            // A fixed count of fraction digits: it cannot exceed the most the number may have.
            this.needs.add('pipeline-operands');
            if (spec.number.minimumFractionDigits > spec.number.maximumFractionDigits) this.add('invalid_combination', at('formats', key, 'number', 'minimumFractionDigits'));
          }
        }
        break;
      }
      case 'raw-state':
        this.needs.add('raw-state');
        if (this.flow) this.add('invalid_combination', pointer);
        this.references.push({ sourceId: value.sourceId, path: ['state'], pointer, kind: undefined, entityOnly: 'raw' });
        break;
      case 'last-changed':
        this.needs.add('entity-time');
        if (this.flow) this.add('invalid_combination', pointer);
        this.references.push({ sourceId: value.sourceId, path: ['state'], pointer, kind: undefined, entityOnly: 'changed' });
        break;
      case 'list-count': case 'list-includes':
        this.needs.add('list-read');
        if (this.flow) this.add('invalid_combination', pointer);
        this.path(value.from.path, at('from', 'path'));
        this.references.push({ sourceId: value.from.sourceId, path: value.from.path, pointer, kind: 'string', entityOnly: 'list' });
        if (value.type === 'list-includes') {
          this.operand(value.value, at('value'), depth + 1);
          // Items are compared as scalars: a list or an object cannot be one.
          if (operandKind(value.value) === 'structure') this.add('binding_type', at('value'));
        }
        break;
      case 'count': {
        this.needs.add('count');
        // The tests read sources of the document, which a flow does not have: its reads are its own.
        if (this.flow) this.add('invalid_combination', pointer);
        if (!value.of.length || value.of.length > MAX_COUNT_ENTRIES) this.add('limit_exceeded', at('of'));
        const outer = this.conditionBudget;
        const accounting = accountingChecker === this ? checkerAccounting : undefined;
        const outerScope = accounting?.predicate;
        value.of.forEach((entry, index) => {
          // Each test has the condition budget a rule's case has.
          this.beginCondition(accounting ? at('of', index, 'test') : '');
          this.predicate(entry.test, at('of', index, 'test'), depth + 1, 1);
          entry.viewer?.personEntityIds.forEach((person, slot) => {
            if (!PERSON_ENTITY_ID.test(person)) this.add('invalid_value', at('of', index, 'viewer', 'personEntityIds', slot));
          });
        });
        if (accounting) {
          reportAccounting(accounting.observer, { type: 'condition-budget', action: 'restore', pointer, previousScopeId: accounting.predicate!.id,
            scopeId: outerScope!.id, previousRemaining: Number.isFinite(this.conditionBudget) ? this.conditionBudget : null, remaining: Number.isFinite(outer) ? outer : null });
          accounting.predicate = outerScope;
        }
        this.conditionBudget = outer;
        break;
      }
      case 'map':
        this.operand(value.of, at('of'), depth + 1);
        this.operand(value.otherwise, at('otherwise'), depth + 1);
        if (!value.cases.length || value.cases.length > 32) this.add('limit_exceeded', at('cases'));
        value.cases.forEach((entry, index) => this.operand(entry.then, at('cases', index, 'then'), depth + 1));
        break;
      case 'math': {
        const [low, high] = mathArity[value.op];
        if (value.op === 'truncate') this.needs.add('math-truncate');
        if (value.args.length < low || value.args.length > high) this.add('invalid_combination', at('args'));
        value.args.forEach((arg, index) => this.operand(arg, at('args', index), depth + 1));
        break;
      }
      case 'object': {
        const keys = Object.keys(value.fields);
        if (keys.length > 64) this.add('limit_exceeded', at('fields'));
        for (const key of keys.sort()) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) this.add('invalid_value', at('fields', key));
          this.operand(value.fields[key], at('fields', key), depth + 1);
        }
        break;
      }
      case 'list':
        if (value.items.length > 64) this.add('limit_exceeded', at('items'));
        value.items.forEach((item, index) => this.operand(item, at('items', index), depth + 1));
        break;
      case 'item':
        this.needs.add('pipeline-operands');
        if (this.flow) { /* a flow's own scope */ }
        else if (this.scope === 'lenient') this.needs.add('repeat');
        else if (this.scope) {
          this.needs.add('repeat');
          if (this.scope.placeholder || !shapeAt(this.scope.shape, value.path)) this.add(this.scope.placeholder ? 'invalid_combination' : 'invalid_reference', this.scope.placeholder ? pointer : at('path'));
        } else this.add('invalid_combination', pointer);
        this.path(value.path, at('path'));
        break;
      case 'index':
        this.needs.add('repeat');
        if (!this.flow && !this.scope) this.add('invalid_combination', pointer);
        break;
      case 'param':
        this.needs.add('pipeline-operands');
        if (!this.flow) this.add('invalid_combination', pointer);
        break;
      case 'clock':
        this.needs.add('pipeline-operands');
        // The second clock is the page's own 1 Hz tick; a flow runs once on the minute clock it is given.
        if (value.part === 'now-second') { this.needs.add('countdown'); if (this.flow) this.add('invalid_combination', pointer); }
        break;
      case 'date':
        this.needs.add('pipeline-operands');
        if (value.op === 'progress') this.needs.add('flow-extras');
        if (value.op === 'seconds-between') this.needs.add('countdown');
        this.operand(value.from, at('from'), depth + 1);
        this.operand(value.to, at('to'), depth + 1);
        break;
      case 'choose': {
        this.needs.add('rules');
        const accounting = accountingChecker === this ? checkerAccounting : undefined;
        if (accounting) reportAccounting(accounting.observer, { type: 'rule-cases', pointer: at('cases'), count: value.cases.length, limit: MAX_RULE_CASES });
        if (!value.cases.length || value.cases.length > MAX_RULE_CASES) this.add('limit_exceeded', at('cases'));
        value.cases.forEach((entry, index) => {
          this.beginCondition(accounting ? at('cases', index, 'when') : '');
          this.predicate(entry.when, at('cases', index, 'when'), depth + 1, 1);
          this.operand(entry.then, at('cases', index, 'then'), depth + 1);
        });
        this.operand(value.otherwise, at('otherwise'), depth + 1);
        // The branches of a rule give one kind: a mismatch is reported at the second branch that disagrees.
        const kinds = [...value.cases.map((entry, index) => [operandKind(entry.then), at('cases', index, 'then')] as const), [operandKind(value.otherwise), at('otherwise')] as const];
        const first = kinds.find(([kind]) => kind !== undefined);
        if (first) for (const [kind, where] of kinds) if (kind !== undefined && kind !== first[0]) { this.add('binding_type', where); break; }
        break;
      }
    }
  }
  private literal(value: unknown, pointer: string, depth: number): void {
    if (typeof value === 'string') { if (value.length > 2000) this.add('limit_exceeded', pointer); return; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) this.add('invalid_value', pointer); return; }
    if (typeof value === 'boolean') return;
    if (value === null || value === undefined) { this.add('invalid_value', pointer); return; }
    const entries: [string, unknown][] = Array.isArray(value) ? value.map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1);
    if (depth > 4 || entries.length > 64) { this.add('limit_exceeded', pointer); return; }
    for (const [key, item] of entries) this.literal(item, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
  }
  private path(path: string[], pointer: string) {
    path.forEach((segment, index) => {
      if (new TextEncoder().encode(segment).length > 160 || ['__proto__', 'prototype', 'constructor'].includes(segment)
        || !/^[A-Za-z0-9_-]+$/.test(segment) || /^\d+$/.test(segment)) this.add('invalid_reference', `${pointer}/${index}`);
    });
  }
  predicate(value: Predicate, pointer: string, depth: number, conditionDepth = 1) {
    if (!this.enter(pointer, depth)) return;
    const accounting = accountingChecker === this ? checkerAccounting : undefined;
    if (this.conditionBudget !== Number.POSITIVE_INFINITY && (conditionDepth > MAX_CONDITION_DEPTH || this.conditionBudget <= 0)) {
      accounting?.predicate!.enter(pointer, conditionDepth, false, this.conditionBudget);
      this.add('limit_exceeded', pointer); return;
    }
    this.conditionBudget -= 1;
    accounting?.predicate!.enter(pointer, conditionDepth, true, this.conditionBudget);
    switch (value.type) {
      case 'state':
        this.path(value.path, `${pointer}/path`);
        this.references.push({ sourceId: value.sourceId, path: value.path, pointer, kind: undefined });
        break;
      case 'numeric':
        if (value.above === undefined && value.below === undefined) { this.add('invalid_combination', pointer); return; }
        this.path(value.path, `${pointer}/path`);
        this.references.push({ sourceId: value.sourceId, path: value.path, pointer, kind: undefined });
        if (value.above) this.operand(value.above, `${pointer}/above`, depth + 1);
        if (value.below) this.operand(value.below, `${pointer}/below`, depth + 1);
        break;
      case 'viewer':
        if (value.isAdmin === undefined && value.userIds === undefined) this.add('invalid_combination', pointer);
        break;
      case 'viewer-person': break;
      case 'all': case 'any':
        value.of.forEach((part, index) => this.predicate(part, `${pointer}/of/${index}`, depth + 1, conditionDepth + 1));
        break;
      case 'not': this.predicate(value.of, `${pointer}/of`, depth + 1, conditionDepth + 1); break;
      case 'compare': {
        this.needs.add('conditions');
        this.operand(value.left, `${pointer}/left`, depth + 1);
        this.operand(value.right, `${pointer}/right`, depth + 1);
        const [a, b] = [operandKind(value.left), operandKind(value.right)];
        // `above` and `below` take numbers; `before` and `after` take date text.
        const want = value.op === 'above' || value.op === 'below' ? 'number' : value.op === 'before' || value.op === 'after' ? 'string' : undefined;
        if (want && ((a && a !== want) || (b && b !== want))) this.add('binding_type', `${pointer}/${a && a !== want ? 'left' : 'right'}`);
        else if (!want && a && b && a !== b && a !== 'structure' && b !== 'structure') this.add('binding_type', `${pointer}/right`);
        break;
      }
      case 'in':
        this.needs.add('conditions');
        this.operand(value.value, `${pointer}/value`, depth + 1);
        value.in.forEach((part, index) => this.operand(part, `${pointer}/in/${index}`, depth + 1));
        break;
      case 'exists': this.needs.add('conditions'); this.operand(value.value, `${pointer}/value`, depth + 1); break;
    }
  }
  call(value: CallService, pointer: string) {
    this.start(MAX_CALL_NODES, pointer);
    if (value.data) this.operand(value.data, `${pointer}/data`, 1);
    const target = Object.entries(value.target ?? {}).sort(([a], [b]) => a < b ? -1 : 1);
    if (value.target && !target.length) this.add('invalid_value', `${pointer}/target`);
    for (const [key, operand] of target) {
      const at = `${pointer}/target/${key}`;
      if (!operand) continue;
      this.operand(operand, at, 1);
      if (operand.type === 'literal' && !isIdentifier(operand.value)) this.add('invalid_value', `${at}/value`);
      if (value.data && Object.hasOwn(value.data.fields, key)) this.add('invalid_combination', at);
    }
    value.optimistic?.forEach((entry, index) =>
      this.optimisticReferences.push({ sourceId: entry.sourceId, pointer: `${pointer}/optimistic/${index}/sourceId` }));
    if (value.confirmation?.type === 'additional' && !value.confirmation.cancelLabel) this.add('invalid_value', `${pointer}/confirmation/cancelLabel`);
    if (value.confirmation?.type === 'additional' && value.confirmation.when) {
      this.needs.add('confirm-when');
      const at = `${pointer}/confirmation/when`;
      this.beginCondition(at);
      this.predicate(value.confirmation.when, at, 1);
    }
  }
}
/** The kind an operand gives when it can be told without typing (`undefined` when it cannot): used for the rule and comparison checks. */
export function operandKind(value: Operand): 'string' | 'number' | 'boolean' | 'structure' | undefined {
  switch (value.type) {
    case 'literal': return typeof value.value === 'string' ? 'string' : typeof value.value === 'number' ? 'number' : typeof value.value === 'boolean' ? 'boolean' : value.value === null ? undefined : 'structure';
    case 'read': return value.as === 'entity-id' ? 'string' : value.as;
    case 'viewer': return value.field === 'isAdmin' ? 'boolean' : 'string';
    case 'format': case 'clock': case 'raw-state': case 'last-changed': return 'string';
    case 'math': case 'date': case 'list-count': case 'count': case 'index': return 'number';
    case 'list-includes': return 'boolean';
    case 'object': case 'list': return 'structure';
    case 'map': return operandKind(value.otherwise);
    case 'choose': return operandKind(value.otherwise);
    default: return undefined;
  }
}
const isIdentifier = (value: unknown) => typeof value === 'string' ? value.length > 0
  : Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);

/** Checks one operand the way the app's parser does. `allowControl` is true only inside a control's own call. */
export function checkOperand(value: Operand, pointer: string, allowControl = false, flow = false, scope?: ItemScope, observer?: BudgetAccountingObserver): ExpressionFacts {
  const checker = new Checker(allowControl, flow, scope);
  if (observer) return observedOperand(checker, value, pointer, observer);
  checker.start(MAX_EXPRESSION_NODES, pointer); checker.operand(value, pointer, 1); return checker;
}
function observedOperand(checker: Checker, value: Operand, pointer: string, observer: BudgetAccountingObserver) {
  return observing(checker, observer, () => { checker.start(MAX_EXPRESSION_NODES, pointer); checker.operand(value, pointer, 1); return checker; });
}
/** Checks one predicate. */
export function checkPredicate(value: Predicate, pointer: string, flow = false, scope?: ItemScope, observer?: BudgetAccountingObserver): ExpressionFacts {
  const checker = new Checker(false, flow, scope);
  if (observer) return observedPredicate(checker, value, pointer, flow, observer);
  checker.start(MAX_EXPRESSION_NODES, pointer); if (flow) checker.beginCondition(pointer); checker.predicate(value, pointer, 1); return checker;
}
function observedPredicate(checker: Checker, value: Predicate, pointer: string, flow: boolean, observer: BudgetAccountingObserver) {
  return observing(checker, observer, () => { checker.start(MAX_EXPRESSION_NODES, pointer); if (flow) checker.beginCondition(pointer); checker.predicate(value, pointer, 1); return checker; });
}
/** Checks one `call-service` action. */
export function checkCallService(value: CallService, pointer: string, allowControl: boolean, scope?: ItemScope, controlStoppers?: readonly string[] | 'any', observer?: BudgetAccountingObserver): ExpressionFacts {
  const checker = new Checker(allowControl, false, scope, controlStoppers);
  if (observer) return observedCall(checker, value, pointer, observer);
  checker.call(value, pointer); return checker;
}
function observedCall(checker: Checker, value: CallService, pointer: string, observer: BudgetAccountingObserver) {
  return observing(checker, observer, () => { checker.call(value, pointer); return checker; });
}

// MARK: Schemas with the parser's checks attached

/** Attaches the parser port to a schema; its issues keep the app's code through `params.shCode`. */
function withChecks<T>(schema: z.ZodType<T>, run: (value: T, observer?: BudgetAccountingObserver) => ExpressionFacts) {
  return schema.check(z.check<T>(context => {
    // The structure is already wrong somewhere below; the parser port only judges values that are well formed.
    if (context.issues.length) return;
    const accounting = beginSchemaAccounting();
    for (const issue of run(context.value, accounting?.observer).issues) {
      const path = issue.pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
      const found = { code: 'custom' as const, input: context.value, path, params: { shCode: issue.code }, message: issue.code };
      if (accounting) attachSchemaAccounting(found, accounting, path.length);
      context.issues.push(found);
    }
  }));
}
export const operandSchema = withChecks(operandBase, (value, observer) => checkOperand(value, '', true, false, 'lenient', observer));
export const predicateSchema = withChecks(predicateBase, (value, observer) => checkPredicate(value, '', false, 'lenient', observer));
export const callServiceSchema = withChecks(callServiceBase, (value, observer) => checkCallService(value, '', true, 'lenient', 'any', observer));
export const whenUnknownSchema = z.enum(whenUnknownPolicies);
/** `enabledWhen` (`sh.enabled-when@1`): a condition and what to do while it cannot be answered. Both are required: never an implicit look. */
export const enabledWhenSchema = object({ condition: predicateSchema, whenUnknown: z.enum(enabledUnknownPolicies) });
export type EnabledWhen = z.infer<typeof enabledWhenSchema>;
/** The two optional fields every node and tab carries. */
export const visibilityFields = { visibleWhen: predicateSchema.optional(), whenUnknown: whenUnknownSchema.optional() };
export type CallServiceAction = CallService;
