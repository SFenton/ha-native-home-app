import { describe, expect, it } from 'vitest';
import type { Operand } from '../src/shared/composition/expression';
import { MAX_TOKENS, hasBraces, operandSlot, parseLine, slotOperand, stripBraces, tokenCount, tooMany, wordingFor01, writeLine, type Part } from '../src/workspace2/expr/tokens';

const read = (name: string, as: 'string' | 'number' = 'string'): Operand => ({ type: 'read', from: { type: 'source', sourceId: name, path: ['state'] }, as, missing: 'unavailable' });

describe('the token line', () => {
  it('no token is a literal', () => {
    expect(writeLine([{ text: 'Hello' }])).toEqual({ type: 'literal', value: 'Hello' });
    expect(writeLine([])).toEqual({ type: 'literal', value: '' });
  });
  it('one bare text token is a read', () => {
    const operand = read('a');
    expect(writeLine([{ token: { operand } }])).toEqual(operand);
  });
  it('anything else is a format whose arguments are a, b, …', () => {
    const made = writeLine([{ token: { operand: read('a', 'number'), digits: 1 } }, { text: '°F · ' }, { token: { operand: read('b') } }]);
    expect(made).toEqual({ type: 'format', pattern: '{a}°F · {b}', args: { a: read('a', 'number'), b: read('b') }, formats: { a: { number: { maximumFractionDigits: 1 } } } });
  });
  it('a date style is a format spec', () => {
    const made = writeLine([{ token: { operand: { type: 'clock', part: 'today' }, dateStyle: 'long-date' } }]);
    expect(made).toMatchObject({ type: 'format', formats: { a: { date: { style: 'long-date' } } } });
    const back = parseLine(made);
    expect(back).toEqual([{ token: { operand: { type: 'clock', part: 'today' }, dateStyle: 'long-date' } }]);
  });
  it('keeping trailing zeros is a minimum number of decimals, and capitalizing is a title-case text format', () => {
    const fixed = writeLine([{ token: { operand: read('a', 'number'), digits: 1, minDigits: 1 } }, { text: '°F' }]);
    expect(fixed).toMatchObject({ formats: { a: { number: { maximumFractionDigits: 1, minimumFractionDigits: 1 } } } });
    expect(parseLine(fixed)![0]).toEqual({ token: { operand: read('a', 'number'), digits: 1, minDigits: 1 } });
    const title = writeLine([{ token: { operand: read('m'), textCase: 'title' } }]);
    expect(title).toMatchObject({ type: 'format', pattern: '{a}', formats: { a: { text: { case: 'title' } } } });
    expect(parseLine(title)).toEqual([{ token: { operand: read('m'), textCase: 'title' } }]);
    const everyWord = writeLine([{ token: { operand: read('m'), textCase: 'words' } }]);
    expect(everyWord).toMatchObject({ type: 'format', pattern: '{a}', formats: { a: { text: { case: 'words' } } } });
    expect(parseLine(everyWord)).toEqual([{ token: { operand: read('m'), textCase: 'words' } }]);
    // Without a minimum or a title case the same token is as it was.
    expect(writeLine([{ token: { operand: read('m') } }])).toEqual(read('m'));
    expect(JSON.stringify(writeLine(parseLine(fixed)!))).toBe(JSON.stringify(fixed));
  });
  it('parsing then writing is the identity', () => {
    const samples: Operand[] = [
      { type: 'literal', value: 'Away' },
      read('a'),
      { type: 'format', pattern: 'Now {a}', args: { a: read('a') } },
      { type: 'format', pattern: '{a} of {b}', args: { a: read('a', 'number'), b: read('b', 'number') }, formats: { a: { number: { maximumFractionDigits: 0 } } } },
    ];
    for (const sample of samples) {
      const parts = parseLine(sample);
      expect(parts, JSON.stringify(sample)).toBeDefined();
      expect(JSON.stringify(writeLine(parts!))).toBe(JSON.stringify(sample));
    }
  });
  it('cannot show what is not a line: a rule, math', () => {
    expect(parseLine({ type: 'choose', cases: [], otherwise: { type: 'literal', value: '' } } as unknown as Operand)).toBeUndefined();
  });
  it('refuses braces and a 17th value', () => {
    expect(stripBraces('a{b}c')).toBe('abc');
    expect(hasBraces('a{')).toBe(true);
    expect(hasBraces('plain')).toBe(false);
    const many: Part[] = Array.from({ length: MAX_TOKENS + 1 }, () => ({ token: { operand: read('a') } }));
    expect(tokenCount(many)).toBe(17);
    expect(tooMany(many)).toBe(true);
    expect(tooMany(many.slice(0, MAX_TOKENS))).toBe(false);
  });
  it('slots: literal and read stay, anything else is an expr', () => {
    expect(operandSlot({ type: 'literal', value: 'x' })).toEqual({ type: 'literal', value: 'x' });
    expect(operandSlot(read('a')).type).toBe('read');
    expect(operandSlot({ type: 'format', pattern: '{a}', args: { a: read('a') } }).type).toBe('expr');
    expect(slotOperand({ type: 'expr', value: read('a') })).toEqual(read('a'));
  });
});

describe('Wording for 0 and 1…', () => {
  it('gives the three rules', () => {
    const parts: Part[] = [{ token: { operand: read('a') } }, { text: ' On' }];
    const made = wordingFor01(parts, 0)!;
    expect(made.cases).toHaveLength(2);
    expect(made.cases[0].then).toEqual({ type: 'literal', value: 'None' });
    expect(made.cases[1].then).toEqual({ type: 'literal', value: '1 On' });
    expect(made.otherwise).toMatchObject({ type: 'format', pattern: '{a} On' });
    expect(wordingFor01([{ text: 'x' }], 0)).toBeUndefined();
  });
});
