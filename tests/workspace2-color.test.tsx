// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { securityExample } from '../src/shared/composition/security-example';
import { buildDocumentIndex } from '../src/preview2/model';
import ColorField, { type ColorValue } from '../src/workspace2/pickers/ColorField';
import { SAVED_COLORS_KEY, SAVED_COLORS_LIMIT, colorName, hexOf, reloadSavedColors, saveColor, solidOf } from '../src/workspace2/pickers/savedColors';
import { ObjectRows, RowsProvider } from '../src/workspace2/rows';
import { copyOf, visibleStrings, voiceIssues } from './support/copy';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); reloadSavedColors(); });

const amber: ColorValue = solidOf('#E8A33D');
const open = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));
const setup = (value: ColorValue = amber, allowStandard = true) => {
  const onChange = vi.fn();
  render(<ColorField label="Fill" value={value} allowStandard={allowStandard} onChange={onChange}/>);
  return onChange;
};

describe('pick 6A: the color field', () => {
  it('names a color by its preset, else its hex value, else Standard', () => {
    expect(colorName('#ff3b30')).toBe('Red');
    expect(colorName('#E8A33D')).toBe('#E8A33D');
    expect(hexOf({ red: 232, green: 163, blue: 61 })).toBe('#E8A33D');
    setup(amber);
    expect(screen.getByRole('button', { name: 'Fill' }).textContent).toContain('#E8A33D');
    cleanup();
    setup(solidOf('#FF3B30'));
    expect(screen.getByRole('button', { name: 'Fill' }).textContent).toContain('Red');
    cleanup();
    setup({ type: 'standard' });
    expect(screen.getByRole('button', { name: 'Fill' }).textContent).toContain('Standard');
  });

  it('opens twelve presets in a radio group and applies one at once', () => {
    const onChange = setup();
    open('Fill');
    const presets = within(screen.getByRole('radiogroup', { name: 'Colors' })).getAllByRole('radio');
    expect(presets.map(radio => radio.getAttribute('aria-label'))).toEqual(['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Light Blue', 'Indigo', 'Purple', 'Pink', 'Brown', 'Gray', 'White']);
    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }));
    expect(onChange).toHaveBeenCalledWith({ type: 'solid-rgb', red: 0x30, green: 0xB0, blue: 0xC7 });
    expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks the current color in the grid', () => {
    setup(solidOf('#34C759'));
    open('Fill');
    expect(screen.getByRole('radio', { name: 'Green' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('false');
  });

  it('saves a color, copies it from the list, and removes it without touching what used it', () => {
    const onChange = setup();
    open('Fill');
    fireEvent.click(screen.getByRole('button', { name: 'Save Color' }));
    expect(JSON.parse(localStorage.getItem(SAVED_COLORS_KEY)!)).toEqual(['#E8A33D']);
    expect(within(screen.getByRole('radiogroup', { name: 'Saved Colors' })).getByRole('radio', { name: '#E8A33D' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Color' })).toBeNull();
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Remove From Saved' }));
    expect(JSON.parse(localStorage.getItem(SAVED_COLORS_KEY)!)).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    act(() => { saveColor('#112233'); });
    fireEvent.click(screen.getByRole('radio', { name: '#112233' }));
    expect(onChange).toHaveBeenCalledWith({ type: 'solid-rgb', red: 0x11, green: 0x22, blue: 0x33 });
  });

  it('keeps at most 24 saved colors', () => {
    for (let at = 0; at < SAVED_COLORS_LIMIT + 3; at += 1) saveColor(`#${(at + 1).toString(16).padStart(2, '0')}0000`);
    expect(JSON.parse(localStorage.getItem(SAVED_COLORS_KEY)!)).toHaveLength(SAVED_COLORS_LIMIT);
    expect(saveColor('#ABCDEF')).toBe(false);
    setup();
    open('Fill');
    expect((screen.getByRole('button', { name: 'Save current color' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save Color' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('survives a reload: the list is read back from storage', () => {
    saveColor('#AA00BB');
    localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(['#AA00BB', 'nonsense', '#aa00bb', '#CC11DD']));
    reloadSavedColors();
    setup();
    open('Fill');
    expect(within(screen.getByRole('radiogroup', { name: 'Saved Colors' })).getAllByRole('radio').map(radio => radio.getAttribute('aria-label'))).toEqual(['#AA00BB', '#CC11DD']);
  });

  it('applies the system picker while it is dragged, at most once a frame, and again when it closes', async () => {
    const onChange = setup();
    open('Fill');
    const well = screen.getByLabelText('Custom Color…') as HTMLInputElement;
    expect(well.type).toBe('color');
    expect(screen.getByText('Opens the system color picker')).toBeTruthy();
    onChange.mockClear();
    for (const value of ['#101010', '#202020', '#303030']) { well.value = value; fireEvent.input(well); }
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenLastCalledWith(solidOf('#303030'), true);
    well.value = '#404040';
    act(() => { fireEvent.change(well); });
    expect(onChange).toHaveBeenLastCalledWith(solidOf('#404040'), true);
  });

  it('offers Standard only where the field may be standard', () => {
    const onChange = setup({ type: 'standard' }, true);
    open('Fill');
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(onChange).toHaveBeenCalledWith({ type: 'standard' });
    cleanup();
    setup(amber, false);
    open('Fill');
    expect(screen.queryByRole('button', { name: 'Standard' })).toBeNull();
  });
});

describe('pick 6A: the color panel copy', () => {
  it('reads as the snapshot and keeps to the voice rules', async () => {
    setup();
    open('Fill');
    const popup = document.querySelector('.w2-color-pop') as HTMLElement;
    await expect(`${copyOf(document.body)}`).toMatchFileSnapshot('./snapshots/copy/color-field.txt');
    expect(voiceIssues(popup)).toEqual([]);
  });
});

describe('pick 6A: every solid-rgb field draws the color field', () => {
  const documents: [string, CompositionDocument][] = [['home-domains', homeDomains.document as unknown as CompositionDocument], ['security example', securityExample()]];
  for (const [name, document] of documents) {
    it(`draws a ColorField and no Red, Green or Blue row for the nodes of ${name} that hold a free color`, () => {
      const index = buildDocumentIndex(document);
      const seen = new Set<string>(); let fields = 0;
      for (const entry of index.entries.values()) {
        if (entry.kind !== 'node' || !entry.node || seen.has(entry.node.type)) continue;
        const { children: _children, ...own } = entry.node as unknown as Record<string, unknown>;
        if (!JSON.stringify(own).includes('solid-rgb')) continue;
        seen.add(entry.node.type);
        const { container, unmount } = render(<RowsProvider value={{ document, onChange: () => {}, onError: () => {}, openAll: true }}>
          <ObjectRows path={entry.path} owner={entry.node.type} skip={at => at.at(-1) === 'children'}/></RowsProvider>);
        const words = visibleStrings(container);
        expect(words.filter(word => ['Red', 'Green', 'Blue'].includes(word)), `${entry.node.type} still has color channels`).toEqual([]);
        fields += container.querySelectorAll('.w2-swatch-small').length;
        unmount();
      }
      expect(seen.size).toBeGreaterThan(0);
      expect(fields).toBeGreaterThan(0);
    });
  }
});
