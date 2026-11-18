// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FLATTEN_MS, FOLD_POSE, FOLD_REDUCED, FOLD_SWING, isSwing, settleDelay, SPRING, SPRING_STOPS, tokenFor, useFoldToken } from '../src/preview2/fold-motion';

/** The app's spring, `.smooth(duration: 0.3)`: a critically damped spring, x(t) = 1 - (1 + wt) e^(-wt), w = 2 pi / duration. */
const spring = (seconds: number, duration: number) => { const w = 2 * Math.PI / duration * seconds; return 1 - (1 + w) * Math.exp(-w); };

describe('the fold motion tokens', () => {
  it('samples the native standard spring as a CSS linear() curve over 450 ms', () => {
    expect(SPRING).toBe(`linear(${SPRING_STOPS.join(', ')})`);
    expect(SPRING_STOPS[0]).toBe(0);
    expect(SPRING_STOPS.at(-1)).toBe(1);
    SPRING_STOPS.forEach((stop, index) => { if (index) expect(stop).toBeGreaterThanOrEqual(SPRING_STOPS[index - 1]); });
    // Each stop is the spring's value at 1/18th of the 450 ms.
    SPRING_STOPS.forEach((stop, index) => expect(stop).toBeCloseTo(spring(index / 18 * 0.45, 0.3), 2));
  });

  it('reaches 99% of its travel at 317 ms (fold-pose) and 528 ms (fold-swing)', () => {
    expect(FOLD_POSE).toMatchObject({ name: 'fold-pose', ms: 450, settleMs: 317 });
    expect(spring(0.317, 0.3)).toBeCloseTo(0.99, 2);
    expect(spring(0.3, 0.3)).toBeLessThan(0.989);
    expect(FOLD_SWING).toMatchObject({ name: 'fold-swing', ms: 750, settleMs: 528 });
    expect(spring(0.528, 0.5)).toBeCloseTo(0.99, 2);
    expect(spring(0.5, 0.5)).toBeLessThan(0.989);
    expect(FOLD_REDUCED).toMatchObject({ name: 'fold-reduced', ms: 200, ease: 'ease-out' });
    expect(FLATTEN_MS).toBe(200);
  });

  it('swings when a move starts or ends closed with the turn kept, and tilts otherwise', () => {
    expect(isSwing({ turn: 0, fold: 'open' }, { turn: 0, fold: 'closed' })).toBe(true);
    expect(isSwing({ turn: 0, fold: 'closed' }, { turn: 0, fold: 'partly' })).toBe(true);
    expect(isSwing({ turn: 0, fold: 'partly' }, { turn: 0, fold: 'open' })).toBe(false);
    expect(isSwing({ turn: 0, fold: 'open' }, { turn: 90, fold: 'open' })).toBe(false);
    expect(isSwing({ turn: 0, fold: 'closed' }, { turn: 90, fold: 'closed' })).toBe(false);
    expect(tokenFor({ turn: 0, fold: 'open' }, { turn: 0, fold: 'closed' }, false)).toBe(FOLD_SWING);
    expect(tokenFor({ turn: 0, fold: 'open' }, { turn: 0, fold: 'partly' }, false)).toBe(FOLD_POSE);
    expect(tokenFor({ turn: 0, fold: 'open' }, { turn: 90, fold: 'open' }, false)).toBe(FOLD_POSE);
    expect(tokenFor({ turn: 0, fold: 'open' }, { turn: 0, fold: 'closed' }, true)).toBe(FOLD_REDUCED);
    expect(tokenFor(undefined, { turn: 0, fold: 'open' }, false)).toBe(FOLD_POSE);
  });

  it('holds the token of the latest move, and the reduced one while Reduce Motion is on', () => {
    const view = renderHook(({ fold, reduced }) => useFoldToken({ turn: 0, fold }, reduced), { initialProps: { fold: 'open' as const, reduced: false } as { fold: 'open' | 'partly' | 'closed'; reduced: boolean } });
    expect(view.result.current).toBe(FOLD_POSE);
    view.rerender({ fold: 'closed', reduced: false });
    expect(view.result.current).toBe(FOLD_SWING);
    view.rerender({ fold: 'partly', reduced: false });
    expect(view.result.current).toBe(FOLD_SWING);
    view.rerender({ fold: 'partly', reduced: true });
    expect(view.result.current).toBe(FOLD_REDUCED);
    view.rerender({ fold: 'open', reduced: false });
    expect(view.result.current).toBe(FOLD_POSE);
  });

  it('lets go of the display a move no longer shows a frame after its token has run', () => {
    expect(settleDelay(FOLD_SWING)).toBe(810);
    expect(settleDelay(FOLD_POSE)).toBe(510);
  });
});
