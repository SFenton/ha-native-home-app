// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ColorPairField, { type ColorPairValue } from '../src/workspace2/pickers/ColorPairField';
import { LookGlyph, LookSummary, lookName } from '../src/workspace2/expr/LookControl';
import { pairOf, reloadSavedColors, solidOf } from '../src/workspace2/pickers/savedColors';
import { copyOf, voiceIssues } from './support/copy';

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); reloadSavedColors(); });

const purple: ColorPairValue = { type: 'solid-appearance', light: solidOf('#9C6DC3'), dark: solidOf('#C88CFA') };
const setup = (value: ColorPairValue, allowPair = true) => {
  const onChange = vi.fn();
  render(<ColorPairField label="Glyph" value={value} allowStandard={false} allowPair={allowPair} onChange={onChange}/>);
  return onChange;
};

describe('the light and dark pair of the color field (sh.solid-appearance@1)', () => {
  it('offers one color field and a switch while the color is one color', () => {
    setup(solidOf('#9C6DC3'));
    expect(screen.getByRole('button', { name: 'Glyph' })).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Glyph differs in dark mode' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Glyph in dark mode' })).toBeNull();
  });
  it('turns on to a pair that starts as the color in both appearances', () => {
    const onChange = setup(solidOf('#9C6DC3'));
    fireEvent.click(screen.getByRole('switch', { name: 'Glyph differs in dark mode' }));
    expect(onChange).toHaveBeenCalledWith(pairOf(solidOf('#9C6DC3')));
  });
  it('shows a field for each appearance, and a change in one leaves the other', () => {
    const onChange = setup(purple);
    expect(screen.getByRole('group', { name: 'Glyph' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Glyph in light mode' }).textContent).toContain('#9C6DC3');
    expect(screen.getByRole('button', { name: 'Glyph in dark mode' }).textContent).toContain('#C88CFA');
    fireEvent.click(screen.getByRole('button', { name: 'Glyph in dark mode' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
    expect(onChange).toHaveBeenCalledWith({ type: 'solid-appearance', light: solidOf('#9C6DC3'), dark: solidOf('#FF3B30') }, undefined);
  });
  it('turns off to the light color', () => {
    const onChange = setup(purple);
    expect((screen.getByRole('switch', { name: 'Glyph differs in dark mode' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Glyph differs in dark mode' }));
    expect(onChange).toHaveBeenCalledWith(solidOf('#9C6DC3'));
  });
  it('is the plain color field where the contract takes no pair', () => {
    setup(solidOf('#9C6DC3'), false);
    expect(screen.getByRole('button', { name: 'Glyph' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('names a pair in words and draws both colors on its swatch', () => {
    expect(lookName('glyph', purple as never)).toBe('#9C6DC3 in light mode, #C88CFA in dark mode');
    render(<><LookSummary look="glyph" value={purple as never}/><LookGlyph look="glyph" value={purple as never}/></>);
    expect(document.querySelectorAll('[data-pair]').length).toBe(2);
  });
  it('keeps to the voice rules', () => {
    const { container } = render(<ColorPairField label="Glyph" value={purple} allowStandard={false} allowPair onChange={() => undefined}/>);
    expect(voiceIssues(container)).toEqual([]);
    expect(copyOf(container)).toContain('Glyph differs in dark mode');
  });
});
