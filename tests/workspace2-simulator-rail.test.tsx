// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewWindows } from '../src/preview2';
import SimulatorRail from '../src/workspace2/SimulatorRail';
import { defaultTextStep } from '../src/workspace2/simulator';

afterEach(cleanup);
const named = (name: string) => previewWindows.find(item => item.name === name)!;
const rail = (name: string, textStep = defaultTextStep) => {
  const onWindow = vi.fn(), onTextStep = vi.fn();
  render(<SimulatorRail window={named(name)} onWindow={onWindow} textStep={textStep} onTextStep={onTextStep}/>);
  return { onWindow, onTextStep };
};

describe('SimulatorRail', () => {
  it('dims Rotate Left and Right on the iPhone and shows no posture controls', () => {
    rail('iPhone');
    expect((screen.getByRole('button', { name: 'Rotate Left' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rotate Right' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Folded' })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Simulator' })).toBeTruthy();
  });

  it('shows the Duo postures, offers Partly Folded on the opened Duo either way up, and moves the window', () => {
    const { onWindow } = rail('Duo open, upright');
    expect((screen.getByRole('button', { name: 'Partly Folded' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Unfolded' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Folded' }));
    // The turn is kept: the upright Duo (turn 90) closes into the landscape body.
    expect(onWindow.mock.calls[0][0].name).toBe('Duo folded, sideways');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Right' }));
    expect(onWindow.mock.calls[1][0].pose).toEqual({ turn: 180, fold: 'open' });
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    expect(onWindow.mock.calls[2][0].pose).toEqual({ turn: 0, fold: 'open' });
  });

  it('enables every control on a folded Duo: it turns, and Partly Folded opens it straight to the book', () => {
    const { onWindow } = rail('Duo folded');
    for (const name of ['Rotate Left', 'Rotate Right', 'Partly Folded', 'Folded', 'Unfolded']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(false);
    expect(screen.getByRole('button', { name: 'Folded' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Partly Folded' }));
    expect(onWindow.mock.calls[0][0].pose).toEqual({ turn: 0, fold: 'partly' });
  });

  it('steps text size and dims at either end', () => {
    const { onTextStep } = rail('iPad upright');
    fireEvent.click(screen.getByRole('button', { name: 'Larger Text' }));
    expect(onTextStep).toHaveBeenLastCalledWith(defaultTextStep + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Smaller Text' }));
    expect(onTextStep).toHaveBeenLastCalledWith(defaultTextStep - 1);
    cleanup();
    rail('iPad upright', 0);
    expect((screen.getByRole('button', { name: 'Smaller Text' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
