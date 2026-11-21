import { operandKind, type Operand, type Predicate } from '../../shared/composition/expression';
import type { Environment, Tri } from '../../shared/composition/evaluator';
import { evaluatePredicate } from '../data/logic/logicEval';
import type { Json } from '../../shared/types';
import { isLogicOperand, operandSlot, slotOperand } from './tokens';
import { copySubtree, rebuiltFrom } from '../editors/provenance';
import { record } from '../../shared/composition/studio-logic/anchors';

/**
 * The value field's pure logic (spec "Files"): which mode a slot is in, what each mode seeds from the others, and the slot each mode
 * writes. A text slot's content is an operand; a look (a color, an icon) is the contract's look object.
 */

export type Kind = 'text' | 'color' | 'icon';
export type Mode = 'fixed' | 'entity' | 'rules' | 'custom';
type Slot = { type: string } & Record<string, unknown>;

/** The most rules a value holds. */
export const MAX_RULES = 16;

/** One rule: when its condition holds, its value. A rule with no condition yet is still being made. */
export interface RuleCase<T> { when: Predicate | undefined; then: T }
/** The rules of a value and what it gives when none holds. */
export interface RulesDraft<T> { cases: RuleCase<T>[]; otherwise: T }

/** The mode a slot is in. A text slot holding something the line cannot show is `custom`. */
export function modeOf(slot: Slot | undefined, kind: Kind): Mode {
  if (!slot || typeof slot === 'string') return 'fixed';
  if (kind !== 'text') return slot.type === 'conditional' ? 'rules' : slot.type === 'bound-color' || slot.type === 'bound-symbol' ? 'entity' : 'fixed';
  if (slot.type === 'literal') return 'fixed';
  if (slot.type === 'read') return 'entity';
  if (slot.type === 'expr') {
    const value = slot.value as Operand;
    if (value.type === 'choose') return 'rules';
    if (isLogicOperand(value)) return 'entity';
    if (value.type === 'literal') return 'fixed';
    return value.type === 'format' || value.type === 'read' ? 'entity' : 'custom';
  }
  return 'custom';
}

/** The rules a slot holds, or undefined when it is not in Rules. */
export function rulesOf(slot: Slot | undefined, kind: Kind): RulesDraft<Operand | Json> | undefined {
  if (!slot) return undefined;
  if (kind !== 'text') {
    if (slot.type !== 'conditional') return undefined;
    const rule = slot as unknown as { cases: { when: Predicate; then: Json }[]; otherwise: Json };
    return { cases: rule.cases.map(entry => ({ when: entry.when, then: entry.then })), otherwise: rule.otherwise };
  }
  const operand = slotOperand(slot);
  if (operand?.type !== 'choose') return undefined;
  return { cases: operand.cases.map(entry => ({ when: entry.when, then: entry.then })), otherwise: operand.otherwise };
}

/** The fixed content a slot stands for: its own value, or its Otherwise in Rules. */
export function fixedOf(slot: Slot, kind: Kind): Operand | Json {
  const rules = rulesOf(slot, kind);
  if (rules) return rules.otherwise;
  if (kind !== 'text' && (slot.type === 'bound-color' || slot.type === 'bound-symbol')) return slot.fallback as Json;
  return kind === 'text' ? slotOperand(slot) ?? { type: 'literal', value: '' } : slot as unknown as Json;
}

/** Rules, seeded the first time the mode is entered: the current value as Otherwise and one empty rule (spec "Changing mode keeps work"). */
export const seedRules = <T,>(current: T): RulesDraft<T> => ({ cases: [{ when: undefined, then: copySubtree(current) }], otherwise: current });

/** Why Rules cannot be stored yet, in words, or undefined: a rule with no condition, or text that mixes kinds. */
export function rulesProblem(rules: RulesDraft<Operand | Json>, kind: Kind): string | undefined {
  const missing = rules.cases.findIndex(entry => !entry.when);
  if (missing >= 0) return `Rule ${missing + 1} needs a condition.`;
  if (kind !== 'text') return undefined;
  return mixedKinds(rules as RulesDraft<Operand>)?.words;
}

const kindWords = { string: 'text', number: 'a number', boolean: 'yes or no', structure: 'a record' } as const;
/** The first rule that gives a different kind from the first one that can be told, with the sentence ("Every rule must give text. Rule 2 gives a number."). */
export function mixedKinds(rules: RulesDraft<Operand>): { at: number | 'otherwise'; words: string } | undefined {
  const all = [...rules.cases.map(entry => entry.then), rules.otherwise];
  const kinds = all.map(operandKind);
  const first = kinds.find(kind => kind !== undefined);
  if (!first) return undefined;
  const index = kinds.findIndex(kind => kind !== undefined && kind !== first);
  if (index < 0) return undefined;
  const subject = index === rules.cases.length ? 'Otherwise' : `Rule ${index + 1}`;
  return { at: index === rules.cases.length ? 'otherwise' : index, words: `Every rule must give ${first === 'number' || first === 'boolean' ? kindWords[first].replace(/^a /, 'a ') : kindWords[first]}. ${subject} gives ${kindWords[kinds[index]!]}.` };
}

/** The slot a mode writes. `fixed` is a look object or an operand; `rules` builds the `conditional` or the `choose`. */
export function toSlot(mode: Exclude<Mode, 'custom'>, content: { fixed?: Operand | Json; entity?: Operand; rules?: RulesDraft<Operand | Json> }, kind: Kind, previous: unknown): Slot {
  if (mode === 'rules') {
    const rules = content.rules!;
    const cases = rules.cases.map(entry => (entry.when ? { when: entry.when, then: entry.then } : { then: entry.then }) as { when: Predicate; then: typeof entry.then });
    if (kind === 'text') return operandSlot(rebuiltFrom(record(previous) && typeof previous.type === 'string' ? slotOperand(previous as Slot) : undefined,
      { type: 'choose', cases: cases as { when: Predicate; then: Operand }[], otherwise: rules.otherwise as Operand } as const), previous);
    return rebuiltFrom(previous, { type: 'conditional', cases, otherwise: rules.otherwise });
  }
  if (kind !== 'text') {
    if (mode === 'entity') return { type: kind === 'icon' ? 'bound-symbol' : 'bound-color', value: content.entity ?? { type: 'literal', value: '' }, fallback: content.fixed };
    return content.fixed as Slot;
  }
  const operand = (mode === 'entity' ? content.entity : content.fixed) as Operand;
  return operandSlot(operand, previous);
}

/** Which rule gives the value now: the first that holds, "Waiting" when a text rule above it cannot be told, or Otherwise. */
export interface RuleStatus { used: number | 'otherwise' | undefined; answers: (Tri | undefined)[]; waiting: number | undefined }
export function ruleStatus(rules: RulesDraft<unknown>, env: Environment | undefined, kind: Kind): RuleStatus {
  const answers: (Tri | undefined)[] = rules.cases.map(entry => entry.when && env ? evaluatePredicate(entry.when, env) : undefined);
  let waiting: number | undefined;
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    if (answer === 'yes') return { used: index, answers, waiting };
    // A text rule stops at a case it cannot answer (dfexpr, `choose`); a look skips it (`resolveLook`).
    if (answer === 'unknown') { waiting ??= index; if (kind === 'text') return { used: undefined, answers, waiting }; }
  }
  return { used: env ? 'otherwise' : undefined, answers, waiting };
}
