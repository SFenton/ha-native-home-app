// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planAction } from '../src/preview2/actions';
import { AlertOverlay } from '../src/preview2/AlertOverlay';
import { alertOf } from '../src/preview2/alert';
import type { CompositionAction } from '../src/shared/composition/schema';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const ask = { type: 'additional', style: 'alert', title: 'Turn Off Guest Room?', message: 'It stays off.', confirmLabel: 'Turn Off', cancelLabel: 'Cancel', destructive: true } as const;
const call = { type: 'call-service', domain: 'light', service: 'turn_off', target: { entity_id: { type: 'literal', value: 'light.demo_guest_room' } }, confirmation: ask } as unknown as CompositionAction;
const input = { document: { dataSources: [], localState: [] }, house: houseFrom({ states: [{ entityId: 'light.demo_guest_room', name: 'Guest Room', state: 'on' }] }), overlay: emptyOverlay };

describe('the simulator alert', () => {
  it('reads the words, the fixed Cancel and the red button from the confirmation', () => {
    expect(alertOf(ask)).toEqual({ title: 'Turn Off Guest Room?', message: 'It stays off.', confirmLabel: 'Turn Off', cancelLabel: 'Cancel', destructive: true });
    expect(alertOf({ type: 'policy' })).toBeUndefined();
    expect(alertOf(undefined)).toBeUndefined();
  });

  it('draws Cancel leading and the confirm button trailing, red when destructive', () => {
    render(<AlertOverlay alert={alertOf(ask)} live={false} onCancel={() => {}} onConfirm={() => {}}/>);
    const buttons = [...document.querySelectorAll('.sh-alert-button')];
    expect(buttons.map(button => button.textContent)).toEqual(['Cancel', 'Turn Off']);
    expect(buttons[1].hasAttribute('data-destructive')).toBe(true);
    expect(screen.getByText('It stays off.')).toBeTruthy();
  });

  it('is hidden from assistive technology as a preview and an alertdialog in Use, with focus on Cancel and Escape as Cancel', () => {
    const cancel = vi.fn();
    const { rerender } = render(<AlertOverlay alert={alertOf(ask)} live={false} onCancel={cancel} onConfirm={() => {}}/>);
    expect(screen.getByTestId('sim-alert').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<AlertOverlay alert={alertOf(ask)} live onCancel={cancel} onConfirm={() => {}}/>);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('sh-alert-title');
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(cancel).toHaveBeenCalled();
  });

  it('fades out for 150 ms after the alert goes, then leaves', () => {
    vi.useFakeTimers();
    const { rerender } = render(<AlertOverlay alert={alertOf(ask)} live={false} onCancel={() => {}} onConfirm={() => {}}/>);
    rerender(<AlertOverlay alert={undefined} live={false} onCancel={() => {}} onConfirm={() => {}}/>);
    expect(screen.getByTestId('sim-alert').hasAttribute('data-leaving')).toBe(true);
    act(() => { vi.advanceTimersByTime(160); });
    expect(screen.queryByTestId('sim-alert')).toBeNull();
  });

  it('leaves at once with Reduce Motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const { rerender } = render(<AlertOverlay alert={alertOf(ask)} live={false} onCancel={() => {}} onConfirm={() => {}}/>);
    rerender(<AlertOverlay alert={undefined} live={false} onCancel={() => {}} onConfirm={() => {}}/>);
    expect(screen.queryByTestId('sim-alert')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('planning an action that asks first', () => {
  it('plans the alert and nothing else until the person confirms', () => {
    const plan = planAction(call, input);
    expect(plan.confirm?.title).toBe('Turn Off Guest Room?');
    expect(plan.simulated).toBeUndefined();
    expect(plan.overlay).toBeUndefined();
    const confirmed = planAction(call, { ...input, confirmed: true });
    expect(confirmed.confirm).toBeUndefined();
    expect(confirmed.simulated).toBe('Guest Room: turn off');
  });

  it('shows no alert for a policy confirmation: the app decides', () => {
    const policy = { ...call, confirmation: { type: 'policy' } } as unknown as CompositionAction;
    const plan = planAction(policy, input);
    expect(plan.confirm).toBeUndefined();
    expect(plan.simulated).toBe('Guest Room: turn off');
  });
});
