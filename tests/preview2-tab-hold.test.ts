import { describe, expect, it } from 'vitest';
import { holdStep, idleHold, lensPosition, nearestCentre, overBar, type HoldEvent, type HoldState } from '../src/preview2/tab-hold';

const run = (events: HoldEvent[], from: HoldState = idleHold) => events.reduce<{ state: HoldState; commit?: number }>((now, event) => holdStep(now.state, event), { state: from });
const press = (index: number): HoldEvent => ({ type: 'press', index, at: { x: 0, y: 100 } });

describe('the tab hold state machine', () => {
  it('arms on press, holds when the timer runs out, and commits the tab under the lens on a release over the bar', () => {
    expect(run([press(2)]).state).toMatchObject({ phase: 'armed', index: 2 });
    expect(run([press(2), { type: 'timer' }]).state).toMatchObject({ phase: 'held', index: 2 });
    const done = run([press(2), { type: 'timer' }, { type: 'move', index: 3, at: { x: 0, y: 150 } }, { type: 'release', index: 3, inside: true }]);
    expect(done.commit).toBe(3);
    expect(done.state.phase).toBe('idle');
  });
  it('is held at once when the pointer travels 6 px, and not for less', () => {
    expect(run([press(1), { type: 'move', index: 1, at: { x: 0, y: 105 } }]).state.phase).toBe('armed');
    expect(run([press(1), { type: 'move', index: 2, at: { x: 0, y: 106 } }]).state).toMatchObject({ phase: 'held', index: 2 });
  });
  it('commits the last tab under the pointer on a release outside the bar: native does not cancel', () => {
    const out = run([press(1), { type: 'timer' }, { type: 'move', index: 2, at: { x: 0, y: 160 } }, { type: 'release', index: 0, inside: false }]);
    expect(out.commit).toBe(2);
  });
  it('commits nothing for a tap that never held (the click does it), a cancel or Escape', () => {
    expect(run([press(1), { type: 'release', index: 1, inside: true }]).commit).toBeUndefined();
    const cancelled = run([press(1), { type: 'timer' }, { type: 'cancel' }, { type: 'release', index: 1, inside: true }]);
    expect(cancelled.commit).toBeUndefined();
    expect(cancelled.state.phase).toBe('idle');
  });
  it('selects nothing while held: the only commit is on release, and a second press mid-hold is ignored', () => {
    const held = run([press(0), { type: 'timer' }]);
    expect(held.commit).toBeUndefined();
    expect(run([press(4)], held.state).state.index).toBe(0);
  });
});

describe('picking the tab by geometry', () => {
  const centres = [100, 150, 200, 250];
  it('takes the nearest centre', () => {
    expect([0, 124, 126, 400].map(coord => nearestCentre(centres, coord))).toEqual([0, 0, 1, 3]);
  });
  it('moves the lens continuously between the first and last centre and clamps at them', () => {
    expect(lensPosition(centres, 50)).toBe(0);
    expect(lensPosition(centres, 125)).toBe(0.5);
    expect(lensPosition(centres, 225)).toBe(2.5);
    expect(lensPosition(centres, 999)).toBe(3);
    expect(lensPosition([100], 10)).toBe(0);
  });
  it('counts a point within the slop of the bar as over it', () => {
    const box = { left: 10, right: 60, top: 100, bottom: 300 };
    expect([overBar({ x: 30, y: 200 }, box, 12), overBar({ x: 70, y: 200 }, box, 12), overBar({ x: 73, y: 200 }, box, 12), overBar({ x: 30, y: 95 }, box, 12)]).toEqual([true, true, false, true]);
  });
});
