import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import type { Json } from '../types';
import type { CompositionIssue } from './json';

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
export const mathOperations = ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'round', 'clamp', 'scale'] as const;
export const whenUnknownPolicies = ['show', 'hide', 'keep'] as const;
const mathArity: Record<typeof mathOperations[number], [number, number]> = {
  add: [2, 8], multiply: [2, 8], min: [2, 8], max: [2, 8], subtract: [2, 2], divide: [2, 2], round: [1, 2], clamp: [3, 3], scale: [5, 5],
};

// MARK: Types

export type Operand =
  | { type: 'literal'; value: Json }
  | { type: 'read'; from: { type: 'source'; sourceId: string; path: string[] }; as: 'string' | 'number' | 'boolean' | 'entity-id'; missing: 'unavailable' }
  | { type: 'control' }
  | { type: 'viewer'; field: 'userId' | 'isAdmin' | 'personEntityId' }
  | { type: 'format'; pattern: string; args: Record<string, Operand>; formats?: Record<string, { number: { maximumFractionDigits: number } }> }
  | { type: 'map'; of: Operand; cases: { equals: string | number | boolean; then: Operand }[]; otherwise: Operand }
  | { type: 'math'; op: typeof mathOperations[number]; args: Operand[] }
  | { type: 'object'; fields: Record<string, Operand> }
  | { type: 'list'; items: Operand[] };
export type ObjectOperand = Extract<Operand, { type: 'object' }>;
export type Predicate =
  | { type: 'state'; sourceId: string; path: string[]; in: string[] }
  | { type: 'numeric'; sourceId: string; path: string[]; above?: Operand; below?: Operand }
  | { type: 'viewer'; isAdmin?: boolean; userIds?: string[] }
  | { type: 'viewer-person'; in: string[] }
  | { type: 'all' | 'any'; of: Predicate[] }
  | { type: 'not'; of: Predicate };
export type WhenUnknown = typeof whenUnknownPolicies[number];

// MARK: Structure

const sourcePath = z.array(z.string().max(160)).min(1).max(8);
const operandBase: z.ZodType<Operand> = z.lazy(() => z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.json()), z.record(z.string(), z.json())]) }),
  object({
    type: z.literal('read'), from: object({ type: z.literal('source'), sourceId: id, path: sourcePath }),
    as: z.enum(['string', 'number', 'boolean', 'entity-id']), missing: z.literal('unavailable'),
  }),
  object({ type: z.literal('control') }),
  object({ type: z.literal('viewer'), field: z.enum(['userId', 'isAdmin', 'personEntityId']) }),
  object({
    type: z.literal('format'), pattern: z.string().max(2000), args: z.record(z.string(), operandBase),
    formats: z.record(z.string(), object({ number: object({ maximumFractionDigits: z.number().int().min(0).max(6) }) })).optional(),
  }),
  object({
    type: z.literal('map'), of: operandBase,
    cases: z.array(object({ equals: z.union([z.string(), z.number(), z.boolean()]), then: operandBase })).max(32),
    otherwise: operandBase,
  }),
  object({ type: z.literal('math'), op: z.enum(mathOperations), args: z.array(operandBase).max(8) }),
  object({ type: z.literal('object'), fields: z.record(z.string(), operandBase) }),
  object({ type: z.literal('list'), items: z.array(operandBase).max(64) }),
]));
const objectOperand = object({ type: z.literal('object'), fields: z.record(z.string(), operandBase) });
const predicateBase: z.ZodType<Predicate> = z.lazy(() => z.discriminatedUnion('type', [
  object({ type: z.literal('state'), sourceId: id, path: sourcePath, in: z.array(text(160)).min(1).max(32) }),
  object({ type: z.literal('numeric'), sourceId: id, path: sourcePath, above: operandBase.optional(), below: operandBase.optional() }),
  object({ type: z.literal('viewer'), isAdmin: z.boolean().optional(), userIds: z.array(text(160)).min(1).max(32).optional() }),
  object({ type: z.literal('viewer-person'), in: z.array(text(160)).min(1).max(32) }),
  object({ type: z.enum(['all', 'any']), of: z.array(predicateBase).min(1).max(16) }),
  object({ type: z.literal('not'), of: predicateBase }),
]));
const confirmationSchema = z.discriminatedUnion('type', [
  object({ type: z.literal('policy') }),
  object({
    type: z.literal('additional'), style: z.enum(['alert', 'dialog']), title: text(240),
    message: text(2000, true).optional(), confirmLabel: text(240), cancelLabel: z.literal('Cancel'), destructive: z.boolean(),
    exemptUserIds: z.array(text(160)).min(1).max(32).optional(),
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

/** What a walk over an authored expression found, beyond the issues. */
export interface ExpressionFacts {
  issues: CompositionIssue[];
  /** Sources named by a read or a predicate, for the compiler's reference checks. */
  references: { sourceId: string; path: string[]; pointer: string; kind: 'string' | 'number' | 'boolean' | 'entity-id' | undefined }[];
  optimisticReferences: { sourceId: string; pointer: string }[];
  usedOperands: boolean;
  usesControl: boolean;
}

/** Walks operands, predicates and calls with the app parser's budget, depth, text and combination rules. */
class Checker implements ExpressionFacts {
  issues: CompositionIssue[] = [];
  references: ExpressionFacts['references'] = [];
  optimisticReferences: ExpressionFacts['optimisticReferences'] = [];
  usedOperands = false;
  usesControl = false;
  private budget = 0;
  constructor(private readonly allowControl: boolean) {}
  add(code: CompositionIssue['code'], pointer: string) { this.issues.push({ code, pointer }); }
  start(nodes: number) { this.budget = nodes; }
  private enter(pointer: string, depth: number): boolean {
    if (depth > MAX_EXPRESSION_DEPTH || this.budget <= 0) { this.add('limit_exceeded', pointer); return false; }
    this.budget -= 1;
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
        if (!this.allowControl) this.add('invalid_combination', pointer);
        this.usesControl = true;
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
        for (const key of Object.keys(value.formats ?? {}).sort()) if (!Object.hasOwn(value.args, key)) this.add('invalid_reference', at('formats', key));
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
  predicate(value: Predicate, pointer: string, depth: number) {
    if (!this.enter(pointer, depth)) return;
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
        value.of.forEach((part, index) => this.predicate(part, `${pointer}/of/${index}`, depth + 1));
        break;
      case 'not': this.predicate(value.of, `${pointer}/of`, depth + 1); break;
    }
  }
  call(value: CallService, pointer: string) {
    this.start(MAX_CALL_NODES);
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
  }
}
const isIdentifier = (value: unknown) => typeof value === 'string' ? value.length > 0
  : Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);

/** Checks one operand the way the app's parser does. `allowControl` is true only inside a control's own call. */
export function checkOperand(value: Operand, pointer: string, allowControl = false): ExpressionFacts {
  const checker = new Checker(allowControl); checker.start(MAX_EXPRESSION_NODES); checker.operand(value, pointer, 1); return checker;
}
/** Checks one predicate. */
export function checkPredicate(value: Predicate, pointer: string): ExpressionFacts {
  const checker = new Checker(false); checker.start(MAX_EXPRESSION_NODES); checker.predicate(value, pointer, 1); return checker;
}
/** Checks one `call-service` action. */
export function checkCallService(value: CallService, pointer: string, allowControl: boolean): ExpressionFacts {
  const checker = new Checker(allowControl); checker.call(value, pointer); return checker;
}

// MARK: Schemas with the parser's checks attached

/** Attaches the parser port to a schema; its issues keep the app's code through `params.shCode`. */
function withChecks<T>(schema: z.ZodType<T>, run: (value: T) => ExpressionFacts) {
  return schema.check(z.check<T>(context => {
    // The structure is already wrong somewhere below; the parser port only judges values that are well formed.
    if (context.issues.length) return;
    for (const issue of run(context.value).issues) {
      const path = issue.pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
      context.issues.push({ code: 'custom', input: context.value, path, params: { shCode: issue.code }, message: issue.code });
    }
  }));
}
export const operandSchema = withChecks(operandBase, value => checkOperand(value, '', true));
export const predicateSchema = withChecks(predicateBase, value => checkPredicate(value, ''));
export const callServiceSchema = withChecks(callServiceBase, value => checkCallService(value, '', true));
export const whenUnknownSchema = z.enum(whenUnknownPolicies);
/** The two optional fields every node and tab carries. */
export const visibilityFields = { visibleWhen: predicateSchema.optional(), whenUnknown: whenUnknownSchema.optional() };
export type CallServiceAction = CallService;
