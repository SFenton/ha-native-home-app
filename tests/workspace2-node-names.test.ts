import { describe, expect, it } from 'vitest';
import { rowContext } from '../src/workspace2/levels';
import { primitiveNames, typeName } from '../src/workspace2/util';

const vacuum = (kind: string) => ({ type: 'vacuum-control', props: { sourceId: 'demo', primitive: { kind } } });

describe('node display names', () => {
  it('names a vacuum control by the primitive it is, not by its type', () => {
    expect(typeName(vacuum('card'))).toBe('Vacuum tile');
    expect(typeName(vacuum('map'))).toBe('Map');
    expect(typeName(vacuum('command'))).toBe('Command');
    for (const kind of Object.keys(primitiveNames['vacuum-control'])) expect(typeName(vacuum(kind)), kind).not.toMatch(/^Vacuum control$/);
  });

  it('keeps the fourteen vacuum primitives as fourteen separate building blocks, each with its own name', () => {
    const names = Object.values(primitiveNames['vacuum-control']);
    expect(names).toHaveLength(14);
    expect(new Set(names).size).toBe(14);
  });

  it('names a climate control by its kind and falls back to the type in words', () => {
    expect(typeName({ type: 'climate-control', props: { kind: 'dial' } })).toBe('Dial Control');
    expect(typeName({ type: 'climate-control', props: { kind: 'nonsense' } })).toBe('Climate');
    expect(typeName({ type: 'vacuum-control', props: {} })).toBe('Vacuum control');
    expect(typeName({ type: 'status-chip' })).toBe('Status chip');
  });

  it('still names a type given as a string', () => {
    expect(typeName('tile-grid')).toBe('Tile grid');
    expect(typeName('sprinkler-control')).toBe('Sprinkler control');
  });

  it('puts the primitive name in a row context line', () => {
    expect(rowContext(vacuum('card'), 0, false, false)).toBe('Vacuum tile');
    expect(rowContext('tile-grid', 9, true, false)).toBe('Tile grid · 9 tiles');
  });
});
