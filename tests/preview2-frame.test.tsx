// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceFrame, fitZoom, STAGE_PADDING } from '../src/preview2/DeviceFrame';

afterEach(cleanup);

describe('fitZoom', () => {
  it('fits the model inside the canvas and clamps to 25 to 120 percent', () => {
    expect(fitZoom({ clientWidth: 900, clientHeight: 1100 }, 400, 800, 80, 240)).toBe(107);
    expect(fitZoom({ clientWidth: 3000, clientHeight: 3000 }, 400, 800)).toBe(120);
    expect(fitZoom({ clientWidth: 120, clientHeight: 300 }, 400, 800)).toBe(25);
  });
  it('gives no answer for an unmeasured canvas', () => {
    expect(fitZoom({ clientWidth: 0, clientHeight: 500 }, 400, 800)).toBeUndefined();
  });
});

describe('DeviceFrame', () => {
  it('sizes the stage to the scaled model and scales the model from its centre', () => {
    const { container } = render(<DeviceFrame width={400} height={800} zoom={.5} pan={false} modelClassName="x"><p>screen</p></DeviceFrame>);
    const stage = container.querySelector<HTMLElement>('.device-stage')!, model = container.querySelector<HTMLElement>('.device-model')!;
    expect(stage.style.width).toBe(`${400 * .5 + STAGE_PADDING.x}px`);
    expect(model.style.transform).toBe('scale(0.5)');
    expect(model.classList.contains('x')).toBe(true);
    expect(model.hasAttribute('data-pan')).toBe(false);
    expect(model.textContent).toBe('screen');
  });
  it('marks the model pannable in Interact mode and accepts stage props and extra padding', () => {
    const { container } = render(<DeviceFrame width={400} height={800} zoom={1} pan padding={{ x: 0, y: 0 }} stageClassName="is-3d" stageProps={{ 'aria-label': 'stage' }} transform="rotateX(2deg)"><i/></DeviceFrame>);
    const stage = container.querySelector<HTMLElement>('.device-stage')!;
    expect(stage.getAttribute('aria-label')).toBe('stage');
    expect(stage.classList.contains('is-3d')).toBe(true);
    expect(stage.style.width).toBe('400px');
    expect(container.querySelector('.device-model')!.hasAttribute('data-pan')).toBe(true);
    expect(container.querySelector<HTMLElement>('.device-model')!.style.transform).toBe('scale(1) rotateX(2deg)');
  });
});
