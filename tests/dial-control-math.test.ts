import { describe, expect, it } from 'vitest';
import {
  adjustStopper, dialControlState, DIAL_CONTROL_MAX_STEPS, DIAL_CONTROL_MAX_TICKS, DIAL_CONTROL_SWEEP, drawnStoppers, lastStepIndex, moveStopper, nearestStopper,
  ringAngle, ringShare, snapToStep, stopBounds, tickValues, valueAtStep, type DialControlInput,
} from '../src/shared/composition/dial-control-math';

/**
 * The arithmetic of a dial control: clamp, gap, limits, no-cross and step. The shared evaluation corpus (`contract/corpus/evaluation/dialctl-*.json`) pins
 * the same module with hand-written numbers; these tests hold the rules themselves and the edges the corpus does not list.
 */
const thermostat = (rest: Partial<DialControlInput> = {}): DialControlInput => ({
  range: { min: 60, max: 80, step: 0.5 }, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 75 }], between: { rule: 'stop' }, ...rest,
});
const wide = { min: 0, max: 100, step: 1 };

describe('the ring', () => {
  it('is 270 degrees from 135 degrees', () => expect(DIAL_CONTROL_SWEEP).toEqual({ start: 135, length: 270 }));
  it('places the ends and the middle', () => {
    expect(ringAngle(thermostat().range, 60)).toBe(135);
    expect(ringAngle(thermostat().range, 70)).toBe(270);
    expect(ringAngle(thermostat().range, 80)).toBe(405);
    expect(ringShare(thermostat().range, 65)).toBe(0.25);
  });
  it('holds a value past the ends at the end', () => {
    expect(ringAngle(thermostat().range, 10)).toBe(135);
    expect(ringAngle(thermostat().range, 99)).toBe(405);
  });
  it('flips about the vertical axis when mirrored', () => expect(ringAngle(thermostat().range, 60, true)).toBe(45));
});

describe('the grid', () => {
  it('counts the last step of a range that does not end on one', () => {
    expect(lastStepIndex({ min: 0, max: 10, step: 3 })).toBe(3);
    expect(valueAtStep({ min: 0, max: 10, step: 3 }, 3)).toBe(9);
  });
  it('counts a step that is a decimal exactly', () => {
    expect(lastStepIndex({ min: 0, max: 1, step: 0.1 })).toBe(10);
    expect(lastStepIndex({ min: 0, max: 0.3, step: 0.1 })).toBe(3);
  });
  it('snaps to the nearest value with a half going up, and to either side on request', () => {
    const range = { min: 60, max: 80, step: 0.5 };
    expect(snapToStep(range, 70.2)).toBe(70);
    expect(snapToStep(range, 70.25)).toBe(70.5);
    expect(snapToStep(range, 70.3, 'down')).toBe(70);
    expect(snapToStep(range, 70.1, 'up')).toBe(70.5);
    expect(snapToStep(range, 70, 'up')).toBe(70);
    expect(snapToStep(range, 70, 'down')).toBe(70);
  });
  it('holds a value inside the ring before it snaps', () => {
    expect(snapToStep({ min: 0, max: 10, step: 3 }, 10)).toBe(9);
    expect(snapToStep({ min: 0, max: 10, step: 3 }, -4)).toBe(0);
  });
  it('removes binary noise and never answers -0', () => {
    expect(snapToStep({ min: 0, max: 1, step: 0.1 }, 0.29)).toBe(0.3);
    expect(Object.is(snapToStep({ min: -1, max: 1, step: 1 }, 0.0000000001 - 1), -0)).toBe(false);
  });
  it('states the limits the compiler holds', () => {
    expect(DIAL_CONTROL_MAX_STEPS).toBe(2000);
    expect(DIAL_CONTROL_MAX_TICKS).toBe(60);
  });
});

describe('ticks', () => {
  it('stand at min, then every `every`, up to max', () => {
    expect(tickValues({ min: 60, max: 80, step: 0.5 }, 5)).toEqual([60, 65, 70, 75, 80]);
    expect(tickValues({ min: 60, max: 80, step: 0.5 }, 7)).toEqual([60, 67, 74]);
  });
  it('are exact for a decimal distance', () => expect(tickValues({ min: 0, max: 1, step: 0.1 }, 0.1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]));
  it('number 60 on the longest ring the compiler allows', () => expect(tickValues({ min: 0, max: 59, step: 1 }, 1)).toHaveLength(60));
});

describe('state', () => {
  it('is editable with a value, unavailable with none, read-only when a gap or a limit cannot be read', () => {
    expect(dialControlState(thermostat())).toBe('editable');
    expect(dialControlState(thermostat({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: null }] }))).toBe('unavailable');
    expect(dialControlState(thermostat({ between: { rule: 'stop', gap: null } }))).toBe('read-only');
    expect(dialControlState(thermostat({ between: { rule: 'stop', gap: Number.NaN } }))).toBe('read-only');
    expect(dialControlState(thermostat({ between: { rule: 'stop', gap: -0.5 } }))).toBe('read-only');
    expect(dialControlState(thermostat({ stoppers: [{ id: 'low', value: 68, limit: { min: null } }, { id: 'high', value: 75 }] }))).toBe('read-only');
  });
  it('ignores a gap under `free`, which has none', () => expect(dialControlState(thermostat({ between: { rule: 'free', gap: null } }))).toBe('editable'));
  it('draws a stopper with a value that is a number', () => {
    expect(drawnStoppers(thermostat({ stoppers: [{ id: 'low', value: Number.NaN }, { id: 'high', value: 75 }] })).map(stopper => stopper.id)).toEqual(['high']);
  });
});

describe('no cross', () => {
  it('stops the low handle at the high one and the high handle at the low one, with no gap', () => {
    expect(moveStopper(thermostat(), 'low', 80)).toEqual({ value: 75, stopped: true });
    expect(moveStopper(thermostat(), 'high', 60)).toEqual({ value: 68, stopped: true });
  });
  it('lets the handles meet', () => {
    const close = thermostat({ stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 70 }] });
    expect(moveStopper(close, 'high', 68)).toEqual({ value: 68, stopped: false });
    expect(moveStopper(close, 'high', 64)).toEqual({ value: 68, stopped: true });
  });
  it('draws no stop mark for the thermostat\'s own stop', () => {
    expect(stopBounds(thermostat(), 'low')).toEqual({ lower: 60, upper: 75, lowerMark: null, upperMark: null });
  });
  it('lets free stoppers pass', () => {
    const free = thermostat({ between: { rule: 'free' } });
    expect(moveStopper(free, 'low', 79)).toEqual({ value: 79, stopped: false });
    expect(moveStopper(free, 'high', 61)).toEqual({ value: 61, stopped: false });
  });
  it('treats the first stopper as the lower, whatever its id', () => {
    const odd = thermostat({ stoppers: [{ id: 'z', value: 68 }, { id: 'a', value: 75 }] });
    expect(stopBounds(odd, 'z')?.upper).toBe(75);
    expect(stopBounds(odd, 'a')?.lower).toBe(68);
  });
  it('holds nothing against a stopper that is not drawn', () => {
    const alone = thermostat({ stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: null }] });
    expect(stopBounds(alone, 'low')).toEqual({ lower: 60, upper: 80, lowerMark: null, upperMark: null });
    expect(stopBounds(alone, 'high')).toBeNull();
  });
});

describe('gap', () => {
  const gapped = (gap: number | null, low = 30, high = 70): DialControlInput => ({ range: wide, stoppers: [{ id: 'low', value: low }, { id: 'high', value: high }], between: { rule: 'stop', gap } });
  it('holds each handle `gap` short of the other and marks the stop', () => {
    expect(stopBounds(gapped(5), 'low')).toEqual({ lower: 0, upper: 65, lowerMark: null, upperMark: 65 });
    expect(stopBounds(gapped(5), 'high')).toEqual({ lower: 35, upper: 100, lowerMark: 35, upperMark: null });
    expect(moveStopper(gapped(5), 'low', 90)).toEqual({ value: 65, stopped: true });
    expect(moveStopper(gapped(5), 'high', 0)).toEqual({ value: 35, stopped: true });
  });
  it('takes a gap that was read, and reads one that is absent as 0', () => {
    expect(moveStopper(gapped(12.5), 'low', 100)).toEqual({ value: 57, stopped: true });
    expect(moveStopper({ ...gapped(0), between: { rule: 'stop' } }, 'low', 100)).toEqual({ value: 70, stopped: true });
  });
  it('is always away, never forced: values closer than the gap may stay or move away', () => {
    const close = gapped(5, 68, 70);
    expect(stopBounds(close, 'low')).toEqual({ lower: 0, upper: 68, lowerMark: null, upperMark: 68 });
    expect(stopBounds(close, 'high')).toEqual({ lower: 70, upper: 100, lowerMark: 70, upperMark: null });
    expect(moveStopper(close, 'low', 69)).toEqual({ value: 68, stopped: true });
    expect(moveStopper(close, 'low', 40)).toEqual({ value: 40, stopped: false });
    expect(moveStopper(close, 'high', 90)).toEqual({ value: 90, stopped: false });
    expect(moveStopper(close, 'high', 69)).toEqual({ value: 70, stopped: true });
  });
  it('is not forced even when the other side crossed', () => {
    const crossed = gapped(5, 72, 70);
    expect(stopBounds(crossed, 'low')?.upper).toBe(72);
    expect(stopBounds(crossed, 'high')?.lower).toBe(70);
  });
  it('is read-only when the gap cannot be read', () => {
    expect(stopBounds(gapped(null), 'low')).toBeNull();
    expect(moveStopper(gapped(null), 'low', 40)).toBeNull();
    expect(adjustStopper(gapped(null), 'low', 1)).toBeNull();
    expect(nearestStopper(gapped(null), 40)).toBeNull();
  });
  it('gives the grid value inside a stop that falls between two', () => {
    const coarse: DialControlInput = { range: { min: 0, max: 100, step: 5 }, stoppers: [{ id: 'low', value: 10 }, { id: 'high', value: 50 }], between: { rule: 'stop', gap: 3 } };
    expect(moveStopper(coarse, 'low', 100)).toEqual({ value: 45, stopped: true });
    expect(moveStopper(coarse, 'high', 0)).toEqual({ value: 15, stopped: true });
  });
});

describe('limits', () => {
  const limited = (limit: { min?: number | null; max?: number | null }, value = 50): DialControlInput => ({ range: wide, stoppers: [{ id: 'target', value, limit }] });
  it('hold a stopper at its lowest and its highest, with a stop mark', () => {
    expect(stopBounds(limited({ min: 10, max: 80 }), 'target')).toEqual({ lower: 10, upper: 80, lowerMark: 10, upperMark: 80 });
    expect(moveStopper(limited({ min: 10, max: 80 }), 'target', 95)).toEqual({ value: 80, stopped: true });
    expect(moveStopper(limited({ min: 10, max: 80 }), 'target', 2)).toEqual({ value: 10, stopped: true });
  });
  it('draw no mark at the ring\'s own end', () => {
    expect(stopBounds(limited({ min: 0, max: 100 }), 'target')).toEqual({ lower: 0, upper: 100, lowerMark: null, upperMark: null });
  });
  it('work with one stopper and with no between', () => expect(moveStopper(limited({ max: 60 }), 'target', 70)).toEqual({ value: 60, stopped: true }));
  it('give way to the tighter bound, a gap or a limit', () => {
    const two = (max: number): DialControlInput => ({ range: wide, stoppers: [{ id: 'low', value: 30, limit: { max } }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } });
    expect(stopBounds(two(60), 'low')?.upper).toBe(60);
    expect(stopBounds(two(70), 'low')?.upper).toBe(65);
  });
  it('mark a limit and a gap that meet', () => {
    const meet: DialControlInput = { range: wide, stoppers: [{ id: 'low', value: 30, limit: { max: 65 } }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } };
    expect(stopBounds(meet, 'low')?.upperMark).toBe(65);
  });
  it('mark a limit even when the other stopper\'s stop has no mark (gap 0)', () => {
    const zero: DialControlInput = { range: wide, stoppers: [{ id: 'low', value: 30, limit: { max: 60 } }, { id: 'high', value: 70 }], between: { rule: 'stop' } };
    expect(stopBounds(zero, 'low')).toEqual({ lower: 0, upper: 60, lowerMark: null, upperMark: 60 });
  });
  it('let a value reported past its limit stay or come back, never go further', () => {
    const past = limited({ max: 80 }, 90);
    expect(moveStopper(past, 'target', 95)).toEqual({ value: 90, stopped: true });
    expect(moveStopper(past, 'target', 70)).toEqual({ value: 70, stopped: false });
  });
  it('make the whole dial read-only when one cannot be read, whichever stopper has it', () => {
    const input: DialControlInput = { range: wide, stoppers: [{ id: 'low', value: 30 }, { id: 'high', value: 70, limit: { max: null } }], between: { rule: 'free' } };
    expect(moveStopper(input, 'low', 40)).toBeNull();
  });
  it('keep the stopper where it is when no grid value lies inside them', () => {
    const none: DialControlInput = { range: { min: 0, max: 100, step: 10 }, stoppers: [{ id: 'target', value: 25, limit: { min: 21, max: 29 } }] };
    expect(moveStopper(none, 'target', 50)).toEqual({ value: 25, stopped: true });
  });
  it('keep the stopper where it is when the pair is out of order', () => {
    const swapped: DialControlInput = { range: wide, stoppers: [{ id: 'target', value: 50, limit: { min: 70, max: 20 } }] };
    expect(moveStopper(swapped, 'target', 55)?.value).toBeTypeOf('number');
  });
});

describe('moves', () => {
  it('answer nothing for a stopper that is not there or has no value', () => {
    expect(moveStopper(thermostat(), 'middle', 70)).toBeNull();
    expect(moveStopper(thermostat({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }), 'low', 70)).toBeNull();
  });
  it('keep a stopper where it is for a raw value that is not a number', () => {
    expect(moveStopper(thermostat(), 'low', Number.NaN)).toEqual({ value: 68, stopped: true });
  });
  it('snap, and report no stop for the ring\'s own end', () => {
    expect(moveStopper(thermostat(), 'low', 70.3)).toEqual({ value: 70.5, stopped: false });
    expect(moveStopper(thermostat(), 'low', 50)).toEqual({ value: 60, stopped: false });
  });
});

describe('adjust', () => {
  it('moves one step either way', () => {
    expect(adjustStopper(thermostat(), 'low', 1)).toBe(68.5);
    expect(adjustStopper(thermostat(), 'low', -1)).toBe(67.5);
  });
  it('stays at a stop and at the ring\'s end', () => {
    expect(adjustStopper(thermostat({ stoppers: [{ id: 'low', value: 75 }, { id: 'high', value: 75 }] }), 'low', 1)).toBe(75);
    expect(adjustStopper(thermostat({ stoppers: [{ id: 'low', value: 60 }, { id: 'high', value: 75 }] }), 'low', -1)).toBe(60);
    expect(adjustStopper(thermostat({ stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 80 }] }), 'high', 1)).toBe(80);
  });
  it('goes to the grid value on that side from a value off the grid', () => {
    const off = thermostat({ stoppers: [{ id: 'low', value: 68.3 }, { id: 'high', value: 75 }] });
    expect(adjustStopper(off, 'low', 1)).toBe(68.5);
    expect(adjustStopper(off, 'low', -1)).toBe(68);
  });
  it('answers nothing for a stopper that is not drawn', () => expect(adjustStopper(thermostat({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }), 'low', 1)).toBeNull());
  it('never moves the other stopper (no push)', () => {
    const input = thermostat({ stoppers: [{ id: 'low', value: 74.5 }, { id: 'high', value: 75 }] });
    expect(adjustStopper(input, 'low', 1)).toBe(75);
    expect(adjustStopper(input, 'low', 1)).not.toBeGreaterThan(75);
  });
});

describe('the nearest stopper for a tap', () => {
  it('is the nearer one', () => {
    expect(nearestStopper(thermostat(), 70)).toBe('low');
    expect(nearestStopper(thermostat(), 73)).toBe('high');
  });
  it('goes to the first on a tie, except stacked stoppers and a tap above', () => {
    expect(nearestStopper(thermostat(), 71.5)).toBe('low');
    const stacked = thermostat({ stoppers: [{ id: 'low', value: 70 }, { id: 'high', value: 70 }] });
    expect(nearestStopper(stacked, 65)).toBe('low');
    expect(nearestStopper(stacked, 70)).toBe('low');
    expect(nearestStopper(stacked, 75)).toBe('high');
  });
  it('skips a stopper that is not drawn, and answers nothing when not editable', () => {
    expect(nearestStopper(thermostat({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }), 60)).toBe('high');
    expect(nearestStopper(thermostat({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: null }] }), 60)).toBeNull();
    expect(nearestStopper(thermostat(), Number.NaN)).toBeNull();
  });
});
