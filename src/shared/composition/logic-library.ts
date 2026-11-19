import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import { operandBase, parameterName, predicateBase, type BudgetAccountingObserver } from './expression';
import { assertCompositionBounds, CompositionValidationError, pointer, reject, type CompositionIssue } from './json';
import { observeStructuralRefusals } from './studio-logic/accounting';
import { prepareStudioDocument } from './studio-logic/prepare';
import type { ResolvedUseBinding } from './studio-logic/bindings';

/**
 * Reusable named logic, for the Studio only. A document's draft holds a `logicLibrary` and `logic-ref` uses; {@link expandLogic} works every use out
 * into plain operands and conditions before the compiler derives capabilities, so the published JSON, the shared contract corpus and the native app
 * see only the grammar they already know. Nothing here is published: the publication check ({@link assertNoLogic}) refuses a `logicLibrary`, a
 * `logic-ref` or a `hole` left in its document.
 *
 * An entry is `{id, name, kind, params, body}`. The body is an operand (`kind: 'operand'`) or a condition (`kind: 'condition'`) in which each
 * `{type: 'hole', name}` stands for the argument of the parameter `name`. A use `{type: 'logic-ref', logicId, args}` may stand wherever an operand or
 * a condition stands, in a document or in another entry's body.
 */

// MARK: Limits

/** Entries a library holds. */
export const MAX_LOGIC_ENTRIES = 100;
/** Parameters an entry declares. */
export const MAX_LOGIC_PARAMS = 8;
/** How deep entries may use entries: a use in a document is depth 1, a use inside its body depth 2, and so on. */
export const MAX_LOGIC_DEPTH = 4;
/** The values one expansion may produce from bodies, so a library cannot grow a document without bound. */
export const MAX_LOGIC_EXPANDED_VALUES = 100_000;
/** The bindings an entry of the component library may hold (`COMPONENT_ENTRY_LIMITS.bindings`); a test keeps the two equal. */
export const MAX_COMPONENT_BINDINGS = 128;

// MARK: Schema

/** What a parameter takes: an id of a data source, a text, a number, an operand, or a condition. */
export const logicParamKinds = ['source-id', 'text', 'number', 'operand', 'condition'] as const;
export type LogicParamKind = typeof logicParamKinds[number];
const object = z.strictObject;
const label = z.string().min(1).max(80).refine(value => Boolean(value.trim()) && !/[\p{Cc}\p{Cf}]/u.test(value));

/**
 * `sample` is an example argument of the parameter's kind, for an editor's preview; it also stands in for the argument when the library checks the entry's body.
 * `display` is a hint for the editor only (a `number` that the Studio draws as a time of day, or a `text` that holds a person's entity id and is drawn as a person picker); it changes nothing a use or an expansion does.
 */
export const logicParamSchema = object({ name: parameterName, kind: z.enum(logicParamKinds), label: label.optional(), sample: z.json().optional(), display: z.enum(['time', 'person']).optional() });
export const logicEntrySchema = object({
  id: identifierSchema,
  name: label,
  kind: z.enum(['operand', 'condition']),
  params: z.array(logicParamSchema).max(MAX_LOGIC_PARAMS),
  /** An operand or a condition, with holes where the arguments go. */
  body: z.record(z.string(), z.json()),
});
export const logicLibrarySchema = z.array(logicEntrySchema).max(MAX_LOGIC_ENTRIES);
/** A use: stands where an operand or a condition stands, in a draft. */
export const logicRefSchema = object({ type: z.literal('logic-ref'), logicId: identifierSchema, args: z.record(z.string(), z.json()) });
/** A hole: stands for one argument inside an entry's body. */
export const logicHoleSchema = object({ type: z.literal('hole'), name: parameterName });
export type LogicEntry = z.infer<typeof logicEntrySchema>;
export type LogicLibrary = z.infer<typeof logicLibrarySchema>;
export type LogicRef = z.infer<typeof logicRefSchema>;
export type LogicHole = z.infer<typeof logicHoleSchema>;

// MARK: Result

/** One use in the draft that expansion replaced. `pointer` is the use's place in the draft, and equals its place in the expanded document. */
export interface LogicOrigin { pointer: string; logicId: string }
export interface LogicSourceLocation {
  pointer: string;
  authoredPointer: string;
  usePointer: string;
  bindingPointer?: string;
  sourcePointer?: string;
}
export interface LogicExpansion {
  /** The document with every use worked out and `logicLibrary` removed; the same object when the document holds no logic. */
  document: unknown;
  origins: LogicOrigin[];
  /**
   * For each component entry whose bindings were re-pointed (by entry index): the index in the draft's `bindings` of each binding of the worked-out entry,
   * so an issue about a worked-out binding can be reported at the binding the author wrote.
   */
  bindings: Record<number, number[]>;
  sourceMap: LogicSourceLocation[];
  useBindings: readonly ResolvedUseBinding[];
}

// MARK: Helpers

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: Rec, key: string): unknown => Object.hasOwn(value, key) ? value[key] : undefined;

/** Whether the document holds a `logicLibrary`, a `logic-ref` or a `hole` anywhere. */
export function usesLogic(document: unknown): boolean {
  if (isRecord(document) && (Object.hasOwn(document, 'logicLibrary') || document.type === 'logic-ref' || document.type === 'hole')) return true;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!isRecord(value)) return false;
    if (value.type === 'logic-ref' || value.type === 'hole') return true;
    return Object.values(value).some(visit);
  };
  return isRecord(document) ? Object.entries(document).some(([key, value]) => !['studioCanvas', 'logicUseBindings'].includes(key) && visit(value)) : visit(document);
}

/**
 * The publication check: refuses a `logicLibrary`, a `logic-ref` or a `hole` left in `document`, at the place it stands. `base` is the pointer of the
 * document in whatever envelope the caller checks.
 */
export function assertNoLogic(document: unknown, base = '/document'): void {
  if (isRecord(document)) for (const key of ['logicLibrary', 'studioCanvas', 'logicUseBindings']) {
    if (Object.hasOwn(document, key)) reject('unknown_field', pointer(base, key));
  }
  const visit = (value: unknown, at: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, pointer(at, index))); return; }
    if (!isRecord(value)) return;
    if (value.type === 'logic-ref' || value.type === 'hole') reject('unknown_variant', at);
    for (const [key, inner] of Object.entries(value)) visit(inner, pointer(at, key));
  };
  visit(document, base);
}

const zodIssues = (error: z.ZodError, base: string): CompositionIssue[] => error.issues.flatMap((issue): CompositionIssue[] => {
  const at = issue.path.reduce<string>((path, key) => pointer(path, String(key)), base);
  if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({ code: 'unknown_field' as const, pointer: pointer(at, key) }));
  if (issue.code === 'too_big' || issue.code === 'too_small') return [{ code: 'limit_exceeded', pointer: at }];
  if (issue.code === 'invalid_type' && issue.input === undefined) return [{ code: 'missing_required', pointer: at }];
  return [{ code: 'invalid_value', pointer: at }];
});

/** Whether `value` is an acceptable argument for a parameter of `kind`. */
export function argFits(kind: LogicParamKind, value: unknown, observer?: BudgetAccountingObserver, at = ''): boolean {
  switch (kind) {
    case 'source-id': return identifierSchema.safeParse(value).success;
    case 'text': return typeof value === 'string' && value.length <= 2000;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'operand':
    case 'condition': {
      const schema = kind === 'operand' ? operandBase : predicateBase;
      const parsed = schema.safeParse(value);
      if (!parsed.success && observer) observeStructuralRefusals(schema, value, parsed.error.issues, observer, at);
      return parsed.success;
    }
  }
}

/** A stand-in argument of each kind, used to check an entry's body before any use of it exists. */
const stand: Record<LogicParamKind, unknown> = {
  'source-id': 'logic-sample', text: 'sample', number: 0,
  operand: { type: 'literal', value: 0 }, condition: { type: 'viewer', isAdmin: true },
};

/** Arguments for checking an unplaced body. A caller may mark absent string samples to distinguish stand-ins from real reads. */
export function logicSampleArguments(entry: Pick<LogicEntry, 'params'>, stringStandIn?: string): Record<string, unknown> {
  return Object.fromEntries(entry.params.map(param => [param.name, param.sample
    ?? (stringStandIn !== undefined && (param.kind === 'source-id' || param.kind === 'text') ? stringStandIn : stand[param.kind])]));
}

/** A binding of a component entry that fills a field inside a use's `args`, and where the filled value lands once the use is worked out. */
interface Hook {
  bindingIndex: number; argName: string;
  /** The steps after the argument's name, when the binding goes into an object argument (`args/then/value`: `['value']`); empty for a text or source-id argument. */
  rest: string[];
  prefix: string[]; landings: string[][];
  /** Set when the argument has no string where the binding points. */
  invalid?: boolean;
}

// MARK: Expander

interface Frame {
  /** Arguments by parameter name, while an entry's body is being worked out. */
  env?: Record<string, unknown>;
  stack: string[];
  /** The value count of each argument in `env`, worked out once, so filling a hole is charged what it copies. */
  sizes?: Record<string, number>;
  /** Where every issue found under this frame is reported: the use's `args` pointer (or the library body). */
  collapse?: string;
  argumentOrigins?: Record<string, { pointer: string; locations: LogicSourceLocation[] }>;
}

interface LogicAccounting { observer: BudgetAccountingObserver; at: string }
let expansionAccounting: WeakMap<Expander, LogicAccounting> | undefined;

class Expander {
  readonly issues: CompositionIssue[] = [];
  readonly origins: LogicOrigin[] = [];
  readonly sourceMap: LogicSourceLocation[] = [];
  private produced = 0;
  /** Whether the budget has run out. */
  exhausted = false;
  /** Names of holes that stay as they are where no use fills them (a template's own settings, while a use inside its body is worked out). */
  keep?: ReadonlySet<string>;
  private marks = 0;
  constructor(private readonly library: ReadonlyMap<string, LogicEntry>, accounting?: LogicAccounting) {
    if (accounting) (expansionAccounting ??= new WeakMap()).set(this, accounting);
  }

  private report(code: CompositionIssue['code'], at: string, frame: Frame) { this.issues.push({ code, pointer: frame.collapse ?? at }); }

  /** Counts `count` values produced from bodies; false (and one issue) once the budget is spent, before anything is copied. */
  private charge(count: number, at: string, frame: Frame): boolean {
    this.produced += count;
    if (this.produced <= MAX_LOGIC_EXPANDED_VALUES) return true;
    if (!this.exhausted) { this.exhausted = true; this.report('limit_exceeded', at, frame); }
    return false;
  }

  walk(value: unknown, at: string, frame: Frame, hooks?: ReadonlyMap<object, Hook[]>, location?: LogicSourceLocation): unknown {
    if (frame.stack.length > 0 && !this.charge(1, at, frame)) return value;
    if (isRecord(value) && value.type === 'hole') return this.hole(value, at, frame, location);
    if (isRecord(value) && value.type === 'logic-ref') return this.use(value, at, frame, hooks, location);
    if (location) this.sourceMap.push(location);
    const child = (key: string | number): LogicSourceLocation | undefined => location && {
      ...location, pointer: pointer(location.pointer, key), authoredPointer: pointer(location.authoredPointer, key),
    };
    if (Array.isArray(value)) return value.map((item, index) => this.walk(item, pointer(at, index), frame, hooks, child(index)));
    if (!isRecord(value)) return value;
    const out: Rec = {};
    for (const [key, inner] of Object.entries(value)) out[key] = this.walk(inner, pointer(at, key), frame, hooks, child(key));
    return out;
  }

  private hole(value: Rec, at: string, frame: Frame, location?: LogicSourceLocation): unknown {
    const extra = Object.keys(value).filter(key => key !== 'type' && key !== 'name');
    for (const key of extra) this.report('unknown_field', pointer(at, key), frame);
    const name = value.name;
    if (typeof name !== 'string' || !parameterName.safeParse(name).success) { this.report('invalid_value', pointer(at, 'name'), frame); return value; }
    if (frame.stack.length === 0 && !frame.env && this.keep?.has(name)) return value;
    if (!frame.env || !Object.hasOwn(frame.env, name)) { this.report('invalid_reference', at, frame); return value; }
    // A hole copies its whole argument: charge it before copying, so a body with many holes and a large argument cannot grow past the budget.
    if (!this.charge(frame.sizes?.[name] ?? 1, at, frame)) return value;
    if (location) {
      const source = frame.argumentOrigins?.[name];
      if (source) this.sourceMap.push(...source.locations.map(item => ({
        ...item, pointer: `${location.pointer}${item.pointer.slice(source.pointer.length)}`,
      })));
      else this.sourceMap.push(location);
    }
    return structuredClone(frame.env[name]);
  }

  private use(value: Rec, at: string, frame: Frame, hooks: ReadonlyMap<object, Hook[]> | undefined, location?: LogicSourceLocation): unknown {
    const topLevel = frame.stack.length === 0 && frame.collapse === undefined;
    let ok = true;
    for (const key of Object.keys(value).filter(key => !['type', 'logicId', 'args'].includes(key))) { this.report('unknown_field', pointer(at, key), frame); ok = false; }
    const logicId = value.logicId, rawArgs = value.args;
    if (typeof logicId !== 'string') { this.report(logicId === undefined ? 'missing_required' : 'invalid_value', pointer(at, 'logicId'), frame); return value; }
    if (!isRecord(rawArgs)) { this.report(rawArgs === undefined ? 'missing_required' : 'invalid_value', pointer(at, 'args'), frame); return value; }
    const entry = this.library.get(logicId);
    if (!entry) { this.report('invalid_reference', pointer(at, 'logicId'), frame); return value; }
    if (frame.stack.includes(logicId)) { this.report('invalid_combination', at, frame); return value; }
    if (frame.stack.length >= MAX_LOGIC_DEPTH) { this.report('limit_exceeded', at, frame); return value; }
    const declared = new Set(entry.params.map(param => param.name));
    for (const name of Object.keys(rawArgs)) if (!declared.has(name)) { this.report('unknown_field', pointer(pointer(at, 'args'), name), frame); ok = false; }
    // The arguments are worked out in the place of the use: a hole in one is the enclosing entry's, a use in one is a use of its own.
    const env: Rec = {}, real: Rec = {}, sizes: Record<string, number> = {};
    const argumentOrigins: NonNullable<Frame['argumentOrigins']> = {};
    const bound = hooks?.get(value) ?? [];
    for (const param of entry.params) {
      const slot = pointer(pointer(at, 'args'), param.name);
      if (!Object.hasOwn(rawArgs, param.name)) { this.report('missing_required', slot, frame); ok = false; continue; }
      const start = this.sourceMap.length;
      const arg = this.walk(rawArgs[param.name], slot, frame, undefined, {
        pointer: slot, authoredPointer: pointer(pointer(location?.authoredPointer ?? at, 'args'), param.name),
        usePointer: location?.usePointer ?? at,
      });
      argumentOrigins[param.name] = { pointer: slot, locations: this.sourceMap.splice(start) };
      // While a template's own body is worked out, an argument that is one of its settings (a kept hole) is checked when the template is used.
      const accounting = expansionAccounting?.get(this);
      if (!(this.keep && holdsKeptHole(arg, this.keep)) && !argFits(param.kind, arg, accounting?.observer, accounting ? `${accounting.at}${slot}` : undefined)) { this.report('invalid_value', slot, frame); ok = false; continue; }
      real[param.name] = arg; env[param.name] = arg; sizes[param.name] = valueCount(arg);
    }
    if (!ok) return value;
    // A component binding that fills one of this use's arguments: the argument is worked out with a mark in the bound string's place (the argument itself,
    // or a string inside an operand argument), and the places the mark lands are where the binding points once the use is gone. A mark is an identifier,
    // so it passes the checks of a source-id or a text argument.
    const marks = new Map<string, { mark: string; original: string; hooks: Hook[] }>();
    for (const hook of bound) {
      const key = [hook.argName, ...hook.rest].join('/');
      let known = marks.get(key);
      if (!known) {
        const leaf = hook.rest.length === 0 ? real[hook.argName] : leafAt(env[hook.argName], hook.rest);
        if (typeof leaf !== 'string' || (hook.rest.length === 0 && marks.size > 0 && [...marks.keys()].some(other => other.startsWith(`${hook.argName}/`)))) { hook.invalid = true; continue; }
        known = { mark: `bindmark-${this.marks++}`, original: leaf, hooks: [] };
        env[hook.argName] = hook.rest.length === 0 ? known.mark : withLeaf(env[hook.argName], hook.rest, known.mark);
        marks.set(key, known);
      }
      known.hooks.push(hook);
    }
    const inner: Frame = { env, sizes, argumentOrigins, stack: [...frame.stack, logicId], collapse: frame.collapse ?? pointer(at, 'args') };
    const libraryIndex = [...this.library.keys()].indexOf(logicId);
    let result = this.walk(entry.body, pointer(at, 'body'), inner, undefined, {
      pointer: location?.pointer ?? at, authoredPointer: `/logicLibrary/${libraryIndex}/body`, usePointer: location?.usePointer ?? at,
    });
    for (const { mark, original, hooks: marked } of marks.values()) {
      const landings = findMark(result, mark);
      for (const hook of marked) hook.landings = landings;
      result = replaceMark(result, mark, original);
    }
    if (topLevel) this.origins.push({ pointer: at, logicId });
    return result;
  }
}

/** Whether `value` is, or holds, a hole named in `keep`. */
function holdsKeptHole(value: unknown, keep: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some(item => holdsKeptHole(item, keep));
  if (!isRecord(value)) return false;
  if (value.type === 'hole') return typeof value.name === 'string' && keep.has(value.name);
  return Object.values(value).some(item => holdsKeptHole(item, keep));
}
/** How many values (objects, arrays and scalars) `value` holds. */
function valueCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + valueCount(item), 1);
  if (isRecord(value)) return Object.values(value).reduce<number>((total, item) => total + valueCount(item), 1);
  return 1;
}
/** The value at `steps` inside `value`, or undefined. */
function leafAt(value: unknown, steps: string[]): unknown {
  let current = value;
  for (const step of steps) {
    if (Array.isArray(current)) current = current[Number(step)];
    else if (isRecord(current)) current = own(current, step);
    else return undefined;
  }
  return current;
}
/** A copy of `value` with the string at `steps` replaced by `leaf`. */
function withLeaf(value: unknown, steps: string[], leaf: string): unknown {
  if (steps.length === 0) return leaf;
  const [head, ...rest] = steps;
  if (Array.isArray(value)) return value.map((item, index) => String(index) === head ? withLeaf(item, rest, leaf) : item);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === head ? withLeaf(item, rest, leaf) : item]));
  return value;
}

function findMark(value: unknown, mark: string, path: string[] = []): string[][] {
  if (value === mark) return [path];
  if (Array.isArray(value)) return value.flatMap((item, index) => findMark(item, mark, [...path, String(index)]));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, inner]) => findMark(inner, mark, [...path, key]));
  return [];
}
function replaceMark(value: unknown, mark: string, replacement: unknown): unknown {
  if (value === mark) return replacement;
  if (Array.isArray(value)) return value.map(item => replaceMark(item, mark, replacement));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, replaceMark(inner, mark, replacement)]));
  return value;
}

// MARK: Library check

/** Problems in the library itself, reported at the entry: ids, parameter names, holes, recursion, and a body that is not an operand or condition. */
function checkLibrary(raw: unknown, observer?: BudgetAccountingObserver, at = ''): { issues: CompositionIssue[]; entries: LogicEntry[]; expander?: Expander } {
  const parsed = logicLibrarySchema.safeParse(raw);
  if (!parsed.success) {
    if (observer) observeStructuralRefusals(logicLibrarySchema, raw, parsed.error.issues, observer, `${at}/logicLibrary`);
    return { issues: zodIssues(parsed.error, '/logicLibrary'), entries: [] };
  }
  const entries = parsed.data, issues: CompositionIssue[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) issues.push({ code: 'duplicate_id', pointer: `/logicLibrary/${index}/id` });
    seen.add(entry.id);
    const names = new Set<string>();
    entry.params.forEach((param, offset) => {
      if (names.has(param.name)) issues.push({ code: 'duplicate_id', pointer: `/logicLibrary/${index}/params/${offset}/name` });
      names.add(param.name);
      if (param.sample !== undefined && !argFits(param.kind, param.sample, observer, observer ? `${at}/logicLibrary/${index}/params/${offset}/sample` : undefined)) issues.push({ code: 'invalid_value', pointer: `/logicLibrary/${index}/params/${offset}/sample` });
    });
  });
  if (issues.length) return { issues, entries };
  const map = new Map(entries.map(entry => [entry.id, entry]));
  // One budget for the whole check, and the document's expansion goes on spending it: what a sample or a body copies is charged wherever it is copied.
  const expander = new Expander(map, observer ? { observer, at } : undefined);
  for (const [index, entry] of entries.entries()) {
    const body = `/logicLibrary/${index}/body`;
    const env = logicSampleArguments(entry);
    const sizes = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, valueCount(value)]));
    const result = expander.walk(entry.body, body, { env, sizes, stack: [entry.id], collapse: body });
    if (expander.issues.length) { issues.push(...expander.issues.splice(0)); if (expander.exhausted) break; continue; }
    const fits = argFits(entry.kind, result, observer, observer ? `${at}${body}` : undefined);
    if (!fits) issues.push({ code: 'invalid_value', pointer: body });
  }
  return { issues, entries, expander };
}

// MARK: Expansion

/** The bindings of a component entry that point through a use's `args`, keyed by the use object, so expansion can re-point them. */
function bindingHooks(entry: Rec): Map<object, Hook[]> {
  const hooks = new Map<object, Hook[]>();
  const bindings = entry.bindings, root = entry.node;
  if (!Array.isArray(bindings) || !isRecord(root)) return hooks;
  const find = (value: unknown, id: string): Rec | undefined => {
    if (Array.isArray(value)) { for (const item of value) { const hit = find(item, id); if (hit) return hit; } return undefined; }
    if (!isRecord(value) || value.type === 'logic-ref') return undefined;
    if (value.id === id && typeof value.type === 'string') return value;
    for (const inner of Object.values(value)) { const hit = find(inner, id); if (hit) return hit; }
    return undefined;
  };
  bindings.forEach((binding, bindingIndex) => {
    if (!isRecord(binding) || typeof binding.nodeId !== 'string' || typeof binding.field !== 'string') return;
    const steps = binding.field.split('/').filter(step => step.length > 0);
    let current: unknown = find(root, binding.nodeId);
    for (let index = 0; index < steps.length && current !== undefined; index++) {
      if (isRecord(current) && current.type === 'logic-ref' && steps[index] === 'args' && index + 1 < steps.length) {
        const list = hooks.get(current) ?? [];
        list.push({ bindingIndex, argName: steps[index + 1], rest: steps.slice(index + 2), prefix: steps.slice(0, index), landings: [] });
        hooks.set(current, list);
        return;
      }
      current = isRecord(current) ? own(current, steps[index]) : Array.isArray(current) ? current[Number(steps[index])] : undefined;
    }
  });
  return hooks;
}

/**
 * Works every `logic-ref` of `document` out and removes `logicLibrary`. Pure: the input is not changed, and a document that holds no logic comes back
 * as the same object. Issues are reported together, as a {@link CompositionValidationError}, at the use (`/pages/0/...`): a missing, extra or wrong-kind
 * argument at `<use>/args/<name>`, an unknown id at `<use>/logicId`, a cycle or a use nested too deep at the use itself. Pointers carry no `/document`
 * prefix (the compiler adds it); {@link remapLogicIssues} turns the issues of a later compile of the result into the draft's pointers.
 *
 * A saved component whose binding fills an argument of a use in its body (a Vent Tile whose subtitle is a use fed by the tile's Entity setting) keeps
 * working: the binding is re-pointed to every field the argument lands in, so the component expands as the hand-written one would. More bindings than
 * a component may hold is `limit_exceeded` at the component's `bindings`.
 */
export function expandLogic(document: unknown, observer?: BudgetAccountingObserver, accountingAt = ''): LogicExpansion {
  assertCompositionBounds(document);
  return expandBounded(document, observer, accountingAt);
}

/**
 * Works out the uses inside `value`, one of a library entry's own body: the holes named in `keep` (that entry's settings) stay holes, so the result is still the
 * entry's body. This is what unlinking a use inside a template needs; a document's own expansion never keeps a hole.
 */
export function expandKeepingHoles(library: readonly LogicEntry[], value: unknown, keep: ReadonlySet<string>): unknown {
  const checked = checkLibrary(library);
  if (checked.issues.length) throw new CompositionValidationError(checked.issues);
  const expander = checked.expander ?? new Expander(new Map());
  expander.keep = keep;
  const out = expander.walk(value, '/x', { stack: [] });
  if (expander.issues.length) throw new CompositionValidationError(expander.issues);
  return out;
}

/** {@link expandLogic} for a document whose bounds were already asserted. */
export function expandBounded(document: unknown, observer?: BudgetAccountingObserver, accountingAt = ''): LogicExpansion {
  const prepared = prepareStudioDocument(document);
  document = prepared.document;
  if (!isRecord(document) || !usesLogic(document)) return { document, origins: [], bindings: {}, sourceMap: [], useBindings: prepared.bindings };
  const checked = checkLibrary(document.logicLibrary === undefined ? [] : document.logicLibrary, observer, accountingAt);
  if (checked.issues.length) throw new CompositionValidationError(checked.issues);
  const expander = checked.expander ?? new Expander(new Map());
  expander.sourceMap.length = 0;
  const top: Frame = { stack: [] };
  const out: Rec = {}, bindings: Record<number, number[]> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'logicLibrary') continue;
    if (key === 'componentLibrary' && Array.isArray(value)) out[key] = value.map((entry, index) => expandComponent(expander, entry, pointer(pointer('', key), index), map => { bindings[index] = map; }));
    else out[key] = expander.walk(value, pointer('', key), top);
  }
  if (expander.issues.length) throw new CompositionValidationError(expander.issues);
  const sourceMap = expander.sourceMap.map(location => {
    const binding = prepared.bindings.find(item => location.authoredPointer === `${item.usePointer}/args/${item.argument}`);
    return binding ? { ...location, bindingPointer: binding.pointer, sourcePointer: binding.sourcePointer } : location;
  });
  for (const binding of prepared.bindings) {
    const generated = /^\/componentLibrary\/(\d+)\/bindings\/(\d+)$/.exec(binding.componentBindingPointer ?? '');
    if (!generated) continue;
    bindings[Number(generated[1])]?.forEach((original, index) => {
      if (original === Number(generated[2])) sourceMap.push({
        pointer: `/componentLibrary/${generated[1]}/bindings/${index}`,
        authoredPointer: binding.pointer, usePointer: binding.usePointer, bindingPointer: binding.pointer, sourcePointer: binding.sourcePointer,
      });
    });
  }
  return { document: out, origins: expander.origins, bindings, sourceMap, useBindings: prepared.bindings };
}

function expandComponent(expander: Expander, entry: unknown, at: string, mapped: (draftIndexes: number[]) => void): unknown {
  if (!isRecord(entry)) return expander.walk(entry, at, { stack: [] });
  const hooks = bindingHooks(entry);
  const out: Rec = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'bindings') continue;
    out[key] = expander.walk(value, pointer(at, key), { stack: [] }, key === 'node' ? hooks : undefined);
  }
  if (Array.isArray(entry.bindings)) {
    const byIndex = new Map<number, Hook[]>();
    for (const list of hooks.values()) for (const hook of list) byIndex.set(hook.bindingIndex, [...byIndex.get(hook.bindingIndex) ?? [], hook]);
    const origin: number[] = [];
    const next = entry.bindings.flatMap((binding, index) => {
      const hook = byIndex.get(index)?.[0];
      if (!hook) { origin.push(index); return [binding]; }
      // A binding that points at something the argument does not hold is refused where the author wrote it, as a hand-written binding would be.
      if (hook.invalid) { expander.issues.push({ code: 'binding_type', pointer: pointer(pointer(pointer(at, 'bindings'), index), 'field') }); return [binding]; }
      return hook.landings.map(landing => { origin.push(index); return { ...(binding as Rec), field: [...hook.prefix, ...landing].join('/') }; });
    });
    mapped(origin);
    if (next.length > MAX_COMPONENT_BINDINGS) expander.issues.push({ code: 'limit_exceeded', pointer: pointer(at, 'bindings') });
    out.bindings = next;
  }
  return out;
}

/**
 * The issues of compiling an expanded document, as they read in the draft: an issue at a use's place stays at the use (a use of the wrong kind for where
 * it stands), one inside the worked-out text (the budgets: depth, nodes, condition nodes) moves to the use's `args` pointer. `prefix` is what the
 * compiler puts before a pointer (`/document`).
 */
export function remapLogicIssues(issues: readonly CompositionIssue[], origins: readonly LogicOrigin[], prefix = '/document', bindings: Record<number, number[]> = {}, useBindings: readonly ResolvedUseBinding[] = []): CompositionIssue[] {
  if (origins.length === 0 && Object.keys(bindings).length === 0) return [...issues];
  return issues.map(issue => {
    if (!issue.pointer.startsWith(prefix)) return issue;
    const local = issue.pointer.slice(prefix.length);
    // A binding that was re-pointed has a new index: report the one the author wrote.
    const binding = /^\/componentLibrary\/(\d+)\/bindings\/(\d+)(\/.*)?$/.exec(local);
    if (binding && bindings[Number(binding[1])]) {
      const draftIndex = bindings[Number(binding[1])][Number(binding[2])];
      if (draftIndex !== undefined) {
        const generated = useBindings.find(item => item.componentBindingPointer === `/componentLibrary/${binding[1]}/bindings/${draftIndex}`);
        return { ...issue, pointer: generated ? `${prefix}${generated.pointer}` : `${prefix}/componentLibrary/${binding[1]}/bindings/${draftIndex}${binding[3] ?? ''}` };
      }
    }
    const hit = origins.find(origin => local === origin.pointer || local.startsWith(`${origin.pointer}/`));
    if (!hit) return issue;
    return { ...issue, pointer: `${prefix}${local === hit.pointer ? hit.pointer : `${hit.pointer}/args`}` };
  });
}

/** The document as it is published: every use worked out, no library. The input itself when it holds no logic; throws what {@link expandLogic} throws. */
export const publishedDocument = <T>(document: T): T => expandLogic(document).document as T;
