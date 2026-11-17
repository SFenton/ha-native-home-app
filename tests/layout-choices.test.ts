import { describe, expect, it } from 'vitest';
import { choicesFromOptions, MAX_CHOICES } from '../src/workspace2/layout/ChoicesGroup';

describe('Fill From an Entity', () => {
  it('makes one choice for each option with a select_option call', () => {
    const { choices, cut } = choicesFromOptions('select.example', 'src', ['Eco', 'Turbo']);
    expect(cut).toBe(0);
    expect(choices.map(choice => choice.label)).toEqual(['Eco', 'Turbo']);
    expect(choices[0].action).toMatchObject({ domain: 'select', service: 'select_option' });
    expect(choices[0].selectedWhen).toMatchObject({ type: 'state', sourceId: 'src', in: ['Eco'] });
  });
  it('keeps the first 12 and reports the rest', () => {
    const many = Array.from({ length: 15 }, (_, at) => `Mode ${at}`);
    const { choices, cut } = choicesFromOptions('input_select.demo', 'src', many);
    expect(choices).toHaveLength(MAX_CHOICES);
    expect(cut).toBe(3);
  });
  it('keeps ids unique when options share words', () => {
    const { choices } = choicesFromOptions('select.example', 'src', ['On', 'on', 'ON!']);
    expect(new Set(choices.map(choice => choice.id)).size).toBe(3);
  });
});
