import type { DateStyle, FormatSpec, Operand, Predicate, TextCase } from '../../shared/composition/expression';

/**
 * The token line's pure logic (spec "The token line"): between a text slot and the parts the line shows (typed text and value tokens).
 * No token is a `literal`; one bare text token is a `read`; anything else is a `format` whose arguments are named `a`, `b`, … and never shown.
 */

/** A value inside text: the operand it reads, and the decimals when it is a number. */
export interface Token {
  operand: Operand; digits?: number;
  /** Set (to the same count as `digits`, or fewer) when the number keeps its trailing zeros: 72 reads 72.0 (`minimumFractionDigits`). */
  minDigits?: number;
  /** Set when the value is drawn as a date. */ dateStyle?: DateStyle;
  /** Set when the text is drawn with capitals: `title` after each underscore (`heat_cool` reads Heat Cool), `words` after each underscore and space (`wheel stuck` reads Wheel Stuck). */ textCase?: TextCase;
}
/** A piece of the line: typed text, or a value. */
export type Part = { text: string } | { token: Token };

/** The most values one line holds. */
export const MAX_TOKENS = 16;
/** Text can't contain `{` or `}`: they stand for values in the stored pattern. */
export const stripBraces = (text: string) => text.replace(/[{}]/g, '');
/** Whether typed text holds a brace that was refused. */
export const hasBraces = (text: string) => /[{}]/.test(text);
/** The count of values in a line. */
export const tokenCount = (parts: readonly Part[]) => parts.filter(part => 'token' in part).length;
/** Whether the 17th value would be refused. */
export const tooMany = (parts: readonly Part[]) => tokenCount(parts) > MAX_TOKENS;

const argName = (index: number) => index < 26 ? String.fromCharCode(97 + index) : `v${index}`;

/** Merges neighbouring text and drops empty text, so a line has one canonical form. */
export function tidy(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    if ('text' in part) {
      if (!part.text) continue;
      const last = out.at(-1);
      if (last && 'text' in last) out[out.length - 1] = { text: last.text + part.text }; else out.push({ text: part.text });
    } else out.push(part);
  }
  return out;
}

/** Writes the parts as an operand: a `literal`, one bare text `read`, or a `format`. */
export function writeLine(parts: readonly Part[]): Operand {
  const line = tidy(parts);
  const tokens = line.filter((part): part is { token: Token } => 'token' in part);
  if (!tokens.length) return { type: 'literal', value: line.map(part => 'text' in part ? part.text : '').join('') };
  if (line.length === 1 && tokens[0].token.operand.type === 'read' && tokens[0].token.operand.as === 'string' && tokens[0].token.digits === undefined && tokens[0].token.dateStyle === undefined && !tokens[0].token.textCase) return tokens[0].token.operand;
  const args: Record<string, Operand> = {}, formats: Record<string, FormatSpec> = {};
  let pattern = '', index = 0;
  for (const part of line) {
    if ('text' in part) { pattern += part.text; continue; }
    const name = argName(index++);
    args[name] = part.token.operand; pattern += `{${name}}`;
    if (part.token.dateStyle !== undefined) formats[name] = { date: { style: part.token.dateStyle } };
    else if (part.token.textCase) formats[name] = { text: { case: part.token.textCase } };
    else if (part.token.digits !== undefined) formats[name] = { number: { maximumFractionDigits: part.token.digits, ...(part.token.minDigits !== undefined ? { minimumFractionDigits: part.token.minDigits } : {}) } };
  }
  return { type: 'format', pattern, args, ...(Object.keys(formats).length ? { formats } : {}) };
}

/** Reads an operand as parts, or undefined when the line cannot show it (a rule, a map, math: a custom value). */
export function parseLine(operand: Operand): Part[] | undefined {
  if (operand.type === 'literal') return typeof operand.value === 'string' ? tidy([{ text: operand.value }]) : undefined;
  if (operand.type === 'read') return [{ token: { operand } }];
  if (operand.type !== 'format') return undefined;
  const parts: Part[] = [];
  let rest = operand.pattern;
  for (let open = rest.indexOf('{'); open >= 0; open = rest.indexOf('{')) {
    const close = rest.indexOf('}', open);
    if (close < 0) return undefined;
    parts.push({ text: rest.slice(0, open) });
    const name = rest.slice(open + 1, close), arg = operand.args[name];
    if (!arg) return undefined;
    const spec = operand.formats?.[name], digits = spec && 'number' in spec ? spec.number.maximumFractionDigits : undefined, dateStyle = spec && 'date' in spec ? spec.date.style : undefined;
    const minDigits = spec && 'number' in spec ? spec.number.minimumFractionDigits : undefined;
    parts.push({ token: { operand: arg, ...(digits !== undefined ? { digits } : {}), ...(minDigits !== undefined ? { minDigits } : {}), ...(dateStyle !== undefined ? { dateStyle } : {}), ...(spec && 'text' in spec ? { textCase: spec.text.case } : {}) } });
    rest = rest.slice(close + 1);
  }
  parts.push({ text: rest });
  return tidy(parts);
}

/** A text slot's content as an operand: the slot's `literal` and `read` are operands already, an `expr` holds one. */
export function slotOperand(slot: { type: string } & Record<string, unknown>): Operand | undefined {
  if (slot.type === 'literal') return { type: 'literal', value: slot.value as string };
  if (slot.type === 'read') return slot as unknown as Operand;
  if (slot.type === 'expr') return slot.value as Operand;
  return undefined;
}
/** An operand as a text slot: `literal` and `read` stay what they are; anything else is an `expr`. */
export function operandSlot(operand: Operand): { type: string } & Record<string, unknown> {
  if (operand.type === 'literal' && typeof operand.value === 'string') return { type: 'literal', value: operand.value };
  if (operand.type === 'read') return operand as unknown as { type: string };
  return { type: 'expr', value: operand };
}

/** The rules "Wording for 0 and 1…" turns a line into: 0 reads "None", 1 reads the line with the number written out, otherwise the line as it was. */
export function wordingFor01(parts: readonly Part[], at: number): { cases: { when: Predicate; then: Operand }[]; otherwise: Operand } | undefined {
  const target = parts[at];
  if (!target || !('token' in target)) return undefined;
  const subject: Operand = target.token.operand.type === 'read' ? { ...target.token.operand, as: 'number' } : target.token.operand;
  const eq = (value: number): Predicate => ({ type: 'compare', op: 'eq', left: subject, right: { type: 'literal', value } });
  const one = parts.map((part, index) => index === at ? { text: '1' } : part);
  return {
    cases: [{ when: eq(0), then: { type: 'literal', value: 'None' } }, { when: eq(1), then: writeLine(one) }],
    otherwise: writeLine(parts),
  };
}
