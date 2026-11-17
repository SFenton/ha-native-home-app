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
  it('dims Rotate on the iPhone and shows no posture controls', () => {
    rail('iPhone');
    expect((screen.getByRole('button', { name: 'Rotate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Folded' })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Simulator' })).toBeTruthy();
  });

  it('shows the Duo postures, offers Partly Folded on the opened Duo either way up, and moves the window', () => {
    const { onWindow } = rail('Duo open, upright');
    expect((screen.getByRole('button', { name: 'Partly Folded' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Unfolded' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Folded' }));
    expect(onWindow.mock.calls[0][0].name).toBe('Duo folded');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(onWindow.mock.calls[1][0].name).toBe('Duo open, sideways');
  });

  it('keeps every control in its place on a folded Duo, dimming Rotate and Partly Folded', () => {
    rail('Duo folded');
    expect((screen.getByRole('button', { name: 'Rotate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Partly Folded' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Folded' }) as HTMLButtonElement).disabled).toBe(false);
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
