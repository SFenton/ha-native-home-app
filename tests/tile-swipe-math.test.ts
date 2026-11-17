import { describe, expect, it } from 'vitest';
import { adjust, bubbleCenter, bubbleText, bubbleTop, bubbleWidth, crossesDetent, formatSwipe, fraction, releasePlans, snap, valueAtX } from '../src/preview2/tile-swipe';
import { defaultDetent, detentOf, isMultipleOf, swipeSteps } from '../src/shared/composition/tile-swipe';

const percent = { min: 0, max: 100, step: 1 };
const setpoint = { min: 60, max: 85, step: 0.5 };

describe('the maths of a tile swipe', () => {
  it('reads the value at x, absolute, at the three computed tile widths', () => {
    for (const width of [150, 179, 192]) {
      expect(valueAtX(0, width, percent)).toBe(0);
      expect(valueAtX(width, width, percent)).toBe(100);
      expect(valueAtX(width / 2, width, percent)).toBe(50);
    }
    expect(valueAtX(179 * 0.4, 179, percent)).toBe(40);
    expect(valueAtX(150 * 0.123, 150, percent)).toBe(12);
  });
  it('clamps a finger past both edges', () => {
    expect(valueAtX(-40, 150, percent)).toBe(0);
    expect(valueAtX(400, 150, percent)).toBe(100);
    expect(valueAtX(10, 0, percent)).toBe(0);
  });
  it('snaps to the step: 1 and 0.5, with no float noise', () => {
    expect(snap(12.6, percent)).toBe(13);
    expect(snap(72.26, setpoint)).toBe(72.5);
    expect(snap(72.24, setpoint)).toBe(72);
    expect(valueAtX(75, 150, setpoint)).toBe(72.5);
    expect(snap(33, { min: 0, max: 100, step: 10 })).toBe(30);
    expect(snap(0.3, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });
  it('mirrors right to left: the minimum stays on the leading edge', () => {
    expect(valueAtX(0, 150, percent, true)).toBe(100);
    expect(valueAtX(150, 150, percent, true)).toBe(0);
    expect(valueAtX(37.5, 150, percent, true)).toBe(75);
  });
  it('ticks when the snapped value crosses a detent line, either way, ends included', () => {
    const range = percent;
    expect(crossesDetent(5, 15, range, 10)).toBe(true);
    expect(crossesDetent(15, 5, range, 10)).toBe(true);
    expect(crossesDetent(11, 19, range, 10)).toBe(false);
    expect(crossesDetent(95, 100, range, 10)).toBe(true);
    expect(crossesDetent(5, 0, range, 10)).toBe(true);
    expect(crossesDetent(0, 0, range, 10)).toBe(false);
    expect(crossesDetent(0, 5, range, 10)).toBe(false);
    expect(crossesDetent(10, 9, range, 10)).toBe(true);
    // A fast flick across many lines is one tick for the sample.
    expect(crossesDetent(2, 98, range, 10)).toBe(true);
  });
  it('has no tick on the first sample', () => {
    expect(crossesDetent(undefined, 50, percent, 10)).toBe(false);
  });
  it('steps a detent at a time and stops at the ends', () => {
    expect(adjust(45, 1, percent, 10)).toBe(55);
    expect(adjust(45, -1, percent, 10)).toBe(35);
    expect(adjust(95, 1, percent, 10)).toBe(100);
    expect(adjust(3, -1, percent, 10)).toBe(0);
    expect(adjust(72, 1, setpoint, 1)).toBe(73);
  });
  it('plans nothing for a release at the shown value', () => {
    expect(releasePlans(40, 40)).toBe(false);
    expect(releasePlans(40, 41)).toBe(true);
    expect(releasePlans(undefined, 41)).toBe(true);
    expect(releasePlans(72.5, 72.5)).toBe(false);
  });
  it('writes the bubble: "Off" at 0 on the light tile, the format elsewhere', () => {
    expect(bubbleText('light', 0, undefined)).toBe('Off');
    expect(bubbleText('light', 45, undefined)).toBe('45%');
    expect(bubbleText('light', 0, undefined, { off: 'Dark', level: '{value} pct' })).toBe('Dark');
    expect(bubbleText('light', 45, undefined, { off: 'Dark', level: '{value} pct' })).toBe('45 pct');
    expect(bubbleText('state', 72.5, '{value}°')).toBe('72.5°');
    expect(formatSwipe(undefined, 3)).toBe('3');
    expect(formatSwipe('{value}%', 0.1 + 0.2)).toBe('0.3%');
  });
  it('centres the bubble on the band edge, flush at both ends on a 150 point tile', () => {
    const bubble = bubbleWidth('50%', 150);
    expect(bubble).toBe(60);
    expect(bubbleCenter(0, 150, bubble)).toBe(30);
    expect(bubbleCenter(0.5, 150, bubble)).toBe(75);
    expect(bubbleCenter(1, 150, bubble)).toBe(120);
    expect(bubbleCenter(0, 150, bubble, true)).toBe(120);
    expect(bubbleCenter(fraction(100, percent), 150, bubble)).toBe(120);
  });
  it('sizes the bubble from its text, never wider than the tile, larger at accessibility sizes', () => {
    expect(bubbleWidth('9%', 150)).toBe(60);
    expect(bubbleWidth('Open 100%', 150)).toBeGreaterThan(60);
    expect(bubbleWidth('A very long bubble text that cannot fit', 150)).toBe(150);
    expect(bubbleWidth('9%', 150, true)).toBe(84);
  });
  it('moves the bubble down only as far as needed when little room lies above the tile', () => {
    expect(bubbleTop(200)).toBe(-24);
    expect(bubbleTop(44)).toBe(-24);
    expect(bubbleTop(30)).toBe(-10);
    expect(bubbleTop(20)).toBe(0);
    expect(bubbleTop(200, true)).toBe(-30);
  });
  it('counts the range: steps, the default detent and its multiples', () => {
    expect(swipeSteps(percent)).toBe(100);
    expect(swipeSteps(setpoint)).toBe(50);
    expect(defaultDetent(percent)).toBe(10);
    expect(defaultDetent(setpoint)).toBe(2.5);
    expect(defaultDetent({ min: 0, max: 100, step: 3 })).toBe(12);
    expect(detentOf({ range: percent, detent: 20 })).toBe(20);
    expect(isMultipleOf(1, 0.5)).toBe(true);
    expect(isMultipleOf(0.3, 0.1)).toBe(true);
    expect(isMultipleOf(7, 5)).toBe(false);
  });
});
