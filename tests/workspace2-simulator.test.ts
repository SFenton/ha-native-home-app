import { describe, expect, it } from 'vitest';
import { previewWindows } from '../src/preview2';
import { canPosture, canRotate, defaultTextStep, deviceOf, devices, postureOf, railUnderPreview, rotated, stepText, textScales, windowOfDevice, withPosture } from '../src/workspace2/simulator';

const named = (name: string) => previewWindows.find(item => item.name === name)!;

describe('the simulator controls', () => {
  it('lists three devices by name, each opening in its first pose', () => {
    expect(devices.map(item => item.name)).toEqual(['iPhone', 'iPhone Duo', 'iPad']);
    expect(windowOfDevice('iPhone Duo').name).toBe('Duo open, upright');
    expect(windowOfDevice('iPad').name).toBe('iPad upright');
    for (const window of previewWindows) expect(devices.map(item => item.name)).toContain(deviceOf(window));
  });

  it('turns the Duo and the iPad, and nothing else', () => {
    expect(canRotate(named('iPhone'))).toBe(false);
    expect(canRotate(named('Duo folded'))).toBe(false);
    expect(rotated(named('iPhone')).name).toBe('iPhone');
    expect(rotated(named('Duo open, upright')).name).toBe('Duo open, sideways');
    expect(rotated(named('Duo open, sideways')).name).toBe('Duo open, upright');
    expect(rotated(named('iPad upright')).name).toBe('iPad sideways');
    expect(rotated(rotated(named('iPad upright'))).name).toBe('iPad upright');
  });

  it('keeps a half-open Duo half open when it turns, and a flat one flat', () => {
    const book = withPosture(named('Duo open, sideways'), 'partly');
    expect(postureOf(book)).toBe('partly');
    const upright = rotated(book);
    expect(upright.name).toBe('Duo open, upright');
    expect(postureOf(upright)).toBe('partly');
    expect(upright.hinge?.axis).toBe('horizontal');
    expect(rotated(upright).hinge?.axis).toBe('vertical');
    expect(postureOf(rotated(named('Duo open, upright')))).toBe('unfolded');
    expect(rotated(named('Duo open, upright')).hinge).toBeUndefined();
  });

  it('gives only the Duo a posture, and partly folded only when it is open', () => {
    expect(postureOf(named('iPhone'))).toBeUndefined();
    expect(postureOf(named('iPad sideways'))).toBeUndefined();
    expect(postureOf(named('Duo folded'))).toBe('folded');
    expect(postureOf(named('Duo open, upright'))).toBe('unfolded');
    expect(canPosture(named('Duo open, upright'), 'partly')).toBe(true);
    expect(canPosture(named('Duo folded'), 'partly')).toBe(false);
    expect(canPosture(named('Duo open, sideways'), 'partly')).toBe(true);
    const hinged = withPosture(named('Duo open, upright'), 'partly');
    expect(hinged.name).toBe('Duo open, upright');
    expect(hinged.hinge).toEqual({ axis: 'horizontal', start: 455.3, length: 40.4 });
    expect(named('Duo open, upright').hinge).toBeUndefined();
    expect(withPosture(named('iPhone'), 'folded').name).toBe('iPhone');
  });

  it('folds, half folds and unfolds the Duo', () => {
    expect(withPosture(named('Duo open, sideways'), 'folded').name).toBe('Duo folded');
    const book = withPosture(named('Duo open, sideways'), 'partly');
    expect(book.hinge?.axis).toBe('vertical');
    expect(withPosture(book, 'unfolded').hinge).toBeUndefined();
    expect(withPosture(named('Duo folded'), 'unfolded').name).toBe('Duo open, upright');
    expect(withPosture(named('Duo open, sideways'), 'unfolded').name).toBe('Duo open, sideways');
  });

  it('steps text size inside its scale, from the default', () => {
    expect(textScales[defaultTextStep]).toBe(1);
    expect(stepText(0, -1)).toBe(0);
    expect(stepText(textScales.length - 1, 1)).toBe(textScales.length - 1);
    expect(stepText(defaultTextStep, 1)).toBe(defaultTextStep + 1);
    expect([...textScales].sort((a, b) => a - b)).toEqual([...textScales]);
  });

  it('puts the controls under the preview only on a phone showing a device that is not the iPhone', () => {
    expect(railUnderPreview(true, named('iPhone'))).toBe(false);
    expect(railUnderPreview(true, named('Duo folded'))).toBe(true);
    expect(railUnderPreview(true, named('iPad upright'))).toBe(true);
    expect(railUnderPreview(false, named('Duo folded'))).toBe(false);
  });
});
