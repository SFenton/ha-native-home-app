import { describe, expect, it } from 'vitest';
import { beginTransition, endTransition, MOTION_MS, type Transition } from '../src/preview2/transition';

const at = (shown: string, leaving?: Transition['leaving']): Transition => ({ shown, leaving });

describe('the page transition state machine', () => {
  it('draws one page at rest and keeps the same object while the page is unchanged', () => {
    const rest = at('a');
    expect(beginTransition(rest, 'a', 'push', true)).toBe(rest);
    expect(rest.leaving).toBeUndefined();
  });

  it('keeps the old page under the new one for a push or a pop in Use', () => {
    expect(beginTransition(at('a'), 'b', 'push', true)).toEqual({ shown: 'b', leaving: { id: 'a', motion: 'push' } });
    expect(beginTransition(at('b'), 'a', 'pop', true)).toEqual({ shown: 'a', leaving: { id: 'b', motion: 'pop' } });
  });

  it('cuts a tab switch, an Edit change and a first page: no second page is ever drawn', () => {
    expect(beginTransition(at('a'), 'b', 'none', true)).toEqual({ shown: 'b', leaving: undefined });
    expect(beginTransition(at('a'), 'b', 'push', false)).toEqual({ shown: 'b', leaving: undefined });
    expect(beginTransition({}, 'a', 'push', true)).toEqual({ shown: 'a', leaving: undefined });
  });

  it('drops the leaving page when the move ends, leaving no double page', () => {
    const moving = beginTransition(at('a'), 'b', 'push', true);
    expect(endTransition(moving, 'a')).toEqual({ shown: 'b' });
    expect(endTransition(moving)).toEqual({ shown: 'b' });
    const done = endTransition(moving, 'a');
    expect(endTransition(done, 'a')).toBe(done);
  });

  it('ignores the end of an earlier move once a newer one has started', () => {
    const first = beginTransition(at('a'), 'b', 'push', true);
    const second = beginTransition(first, 'c', 'push', true);
    expect(second.leaving).toEqual({ id: 'b', motion: 'push' });
    expect(endTransition(second, 'a')).toBe(second);
    expect(endTransition(second, 'b')).toEqual({ shown: 'c' });
  });

  it('a pop straight after a push still ends with one page', () => {
    let now = beginTransition(at('a'), 'b', 'push', true);
    now = beginTransition(now, 'a', 'pop', true);
    expect(now).toEqual({ shown: 'a', leaving: { id: 'b', motion: 'pop' } });
    expect(endTransition(now, 'b')).toEqual({ shown: 'a' });
  });

  it('runs the slide for the app\'s 0.3 s', () => { expect(MOTION_MS).toBe(300); });
});
