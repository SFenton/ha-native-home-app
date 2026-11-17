import { describe, expect, it } from 'vitest';
import { faceState, isPersonMove, markPerson, QUICK_MS, STANDARD_MS } from '../src/preview2/grid-groups';

describe('the cause of a regroup', () => {
  it('names the face a tile draws: unavailable wins, then lit, else idle', () => {
    expect(faceState(true, true)).toBe('unavailable');
    expect(faceState(false, true)).toBe('active');
    expect(faceState(false, false)).toBe('idle');
  });
  it('counts a move as the person\'s only just after their action, never for the house or a reconnect', () => {
    expect(isPersonMove(1000)).toBe(false);
    markPerson(1000);
    expect(isPersonMove(1400)).toBe(true);
    expect(isPersonMove(1000 + 1500)).toBe(true);
    expect(isPersonMove(1000 + 1501)).toBe(false);
  });
  it('slides at MotionTokens.standard and fades at quick', () => { expect(STANDARD_MS).toBe(350); expect(QUICK_MS).toBe(200); });
});
