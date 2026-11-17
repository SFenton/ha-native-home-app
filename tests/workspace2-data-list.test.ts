import { describe, expect, it } from 'vitest';
import { isList, listStates, stateOfText } from '../src/workspace2/data/ListStates';
import { staleChoices } from '../src/workspace2/data/RefreshPage';

describe('the List inspector', () => {
  it('is one inspector for row-collection and the older collection node', () => {
    expect(isList('row-collection')).toBe(true);
    expect(isList('collection')).toBe(true);
    expect(isList('tile')).toBe(false);
    expect(isList(undefined)).toBe(false);
  });
  it('has the seven states, and every state text maps to one of them', () => {
    expect(listStates.map(state => state.value).sort()).toEqual(['empty', 'error', 'failed', 'loading', 'rows', 'stale', 'unavailable']);
    const values = new Set<string>(listStates.map(state => state.value));
    for (const state of Object.values(stateOfText)) expect(values.has(state)).toBe(true);
    expect(stateOfText.emptyMessage).toBe('empty');
  });
  it('offers 5 minutes among the lags a flow can tolerate', () => {
    expect(staleChoices.map(choice => choice.value)).toContain('300');
  });
});
