// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { CompositionDocument } from '../src/shared/composition/schema';
import LibraryPanel from '../src/workspace2/LibraryPanel';
import LibraryRail from '../src/workspace2/LibraryRail';
import { LIBRARY_KEY, useLibrary } from '../src/workspace2/useLibrary';
import { useLibraryTrail } from '../src/workspace2/useLibraryTrail';
import type { Category } from '../src/workspace2/layout';
import { copyOf, voiceIssues } from './support/copy';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));

const home = homeDomains.document as unknown as CompositionDocument;
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the library rail', () => {
  it('is a vertical toolbar named Library with the eight categories in order, named by their visible words', () => {
    render(<LibraryRail category="pages" open onPress={() => {}}/>);
    const bar = screen.getByRole('toolbar', { name: 'Library' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['Tabs', 'Pages', 'Sheets', 'Modals', 'Components', 'Controls', 'Flows', 'Data']);
  });

  it('presses the active category only while its panel is open, and reports a press', () => {
    const press = vi.fn();
    const { rerender } = render(<LibraryRail category="modals" open onPress={press}/>);
    expect(screen.getByRole('button', { name: 'Modals' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-pressed')).toBe('false');
    rerender(<LibraryRail category="modals" open={false} onPress={press}/>);
    expect(screen.getByRole('button', { name: 'Modals' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Controls' }));
    expect(press).toHaveBeenCalledWith('controls');
  });

  it('moves between the buttons with the arrow keys and keeps one tab stop', () => {
    render(<LibraryRail category="tabs" open onPress={() => {}}/>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: 'End' });
    expect(document.activeElement).toBe(buttons[7]);
    fireEvent.keyDown(buttons[7], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[6]);
  });
});

describe('the remembered state', () => {
  it('opens the docked library by default from 1200 px and the narrower ones closed', () => {
    expect(renderHook(() => useLibrary('docked', 1440)).result.current.open).toBe(true);
    expect(renderHook(() => useLibrary('docked', 1180)).result.current.open).toBe(false);
    expect(renderHook(() => useLibrary('flyout', 820)).result.current.open).toBe(false);
  });

  it('a press on the active button closes the panel, a press on another switches category and opens it', () => {
    const { result } = renderHook(() => useLibrary('docked', 1440));
    expect(result.current.category).toBe('tabs');
    act(() => result.current.press('tabs'));
    expect(result.current.open).toBe(false);
    act(() => result.current.press('components'));
    expect(result.current.open).toBe(true);
    expect(result.current.category).toBe('components');
    act(() => result.current.press('controls'));
    expect(result.current.open).toBe(true);
    expect(result.current.category).toBe('controls');
  });

  it('remembers open or closed per tier in localStorage and reads it back', () => {
    const docked = renderHook(() => useLibrary('docked', 1440));
    act(() => docked.result.current.setOpen(false));
    const flyout = renderHook(() => useLibrary('flyout', 820));
    act(() => flyout.result.current.setOpen(true));
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!)).toMatchObject({ docked: false, flyout: true });
    expect(renderHook(() => useLibrary('docked', 1440)).result.current.open).toBe(false);
    expect(renderHook(() => useLibrary('flyout', 820)).result.current.open).toBe(true);
  });

  it('remembers which groups a person opened or closed, and falls back to the default for the rest', () => {
    const first = renderHook(() => useLibrary('docked', 1440));
    expect(first.result.current.groupOpen('loose', true)).toBe(true);
    act(() => first.result.current.setGroup('loose', false));
    expect(first.result.current.groupOpen('loose', true)).toBe(false);
    expect(first.result.current.groupOpen('tile', true)).toBe(true);
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!).groups).toEqual({ loose: false });
    expect(renderHook(() => useLibrary('docked', 1440)).result.current.groupOpen('loose', true)).toBe(false);
  });

  it('keeps a stored pages or modals category valid', () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ category: 'modals' }));
    expect(renderHook(() => useLibrary('docked', 1440)).result.current.category).toBe('modals');
  });

  it('ignores a damaged stored value', () => {
    localStorage.setItem(LIBRARY_KEY, '{not json');
    expect(renderHook(() => useLibrary('docked', 1440)).result.current.open).toBe(true);
  });

  it('never opens on a phone', () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ docked: true, flyout: true }));
    expect(renderHook(() => useLibrary('phone', 390)).result.current.open).toBe(false);
  });
});

/** The panel with its rail beside it, as the workspace draws them, kept in step by the real hook. */
function Harness({ tier, onClose = () => {}, mode = 'edit', setMode = () => {} }: { tier: 'flyout' | 'docked'; onClose?: () => void; mode?: 'edit' | 'use'; setMode?: (mode: 'edit' | 'use') => void }) {
  const ws = Project.workspace(home, undefined, { extra: { mode, setMode } });
  const [category, setCategory] = useState<Category>('pages');
  const [open, setOpen] = useState(true);
  const stored = useLibrary(tier, 1440), trailApi = useLibraryTrail();
  const library = { ...stored, category, open };
  return <div className="w2-lib">
    <LibraryRail category={category} open={open} onPress={next => { setCategory(next); setOpen(true); }}/>
    <LibraryPanel ws={ws} document={home} tier={tier} category={category} open={open} shown={open} library={library} trailApi={trailApi} onCategory={setCategory} onKeepPanel={() => {}} onError={() => {}} onClose={() => { setOpen(false); onClose(); }}/>
  </div>;
}

describe('the flyout panel', () => {
  it('is a complementary region named after its category with a pop-up button that shows the category and Close', () => {
    render(<Harness tier="flyout"/>);
    const panel = screen.getByRole('complementary', { name: 'Pages' });
    const picker = within(panel).getByRole('button', { name: 'Library: Pages' });
    expect(picker.getAttribute('aria-haspopup')).toBe('menu');
    expect(picker.textContent).toBe('Pages');
    expect(within(panel).queryByRole('tablist')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('lists the eight categories in its menu with a check on the open one, and switches', async () => {
    render(<Harness tier="flyout"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Library: Pages' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual(['Tabs', 'Pages', 'Sheets', 'Modals', 'Components', 'Controls', 'Flows', 'Data']);
    expect(items[1].querySelector('.w2-lib-check')).toBeTruthy();
    expect(items.filter(item => item.querySelector('.w2-lib-check'))).toHaveLength(1);
    fireEvent.click(items[4]);
    expect(screen.getByRole('complementary', { name: 'Components' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Library: Components' })).toBeTruthy();
  });

  it('moves focus to the pop-up button when it opens, and Close gives focus back to the rail button', async () => {
    render(<Harness tier="flyout"/>);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Library: Pages' })));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(screen.getByRole('toolbar', { name: 'Library' }).querySelector('[data-category=pages]'));
  });

  it('closes on Escape and returns focus to the rail button', () => {
    const closed = vi.fn();
    render(<Harness tier="flyout" onClose={closed}/>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Library: Pages' }), { key: 'Escape' });
    expect(closed).toHaveBeenCalledOnce();
    expect(document.activeElement?.getAttribute('data-category')).toBe('pages');
  });

  it('is not a focus trap: tabbing past it is the browser\'s business, and it has no modal role', () => {
    render(<Harness tier="flyout"/>);
    const panel = screen.getByRole('complementary', { name: 'Pages' });
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.closest('[role=dialog]')).toBeNull();
  });
});

describe('the docked panel and the categories', () => {
  it('shows the category name with a Close button and no pop-up button', () => {
    render(<Harness tier="docked"/>);
    const panel = screen.getByRole('complementary', { name: 'Pages' });
    expect(within(panel).getByRole('heading', { name: 'Pages' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /^Library:/ })).toBeNull();
  });

  it('each list has the add buttons the spec names: Tab and Edit Tabs, Page, Sheet, Modal', () => {
    render(<Harness tier="docked"/>);
    const buttons = () => within(screen.getByRole('contentinfo', { name: 'Add' })).getAllByRole('button').map(button => button.textContent);
    expect(buttons()).toEqual(['Page']);
    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }));
    expect(buttons()).toEqual(['Tab', 'Edit Tabs']);
    fireEvent.click(screen.getByRole('button', { name: 'Sheets' }));
    expect(buttons()).toEqual(['Sheet']);
    fireEvent.click(screen.getByRole('button', { name: 'Modals' }));
    expect(buttons()).toEqual(['Modal']);
  });

  it('Sheets groups its sheets by how they open, and a group header toggles and remembers', () => {
    render(<Harness tier="docked"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Sheets' }));
    const header = screen.getByRole('button', { name: /^Opened From a Tile/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!).groups).toMatchObject({ tile: false });
  });

  it('Modals is empty when no sheet covers the screen, and says what a modal is', () => {
    render(<Harness tier="docked"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Modals' }));
    expect(screen.getByText('No modals yet. A modal covers the whole screen.')).toBeTruthy();
    expect(screen.getByText('0 modals')).toBeTruthy();
  });

  it('Components and Controls are palettes of cells with the one-line hint', () => {
    render(<Harness tier="docked"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    const grid = screen.getByRole('list', { name: 'Layout' });
    expect(within(grid).getAllByRole('button').map(button => button.textContent)).toContain('Section');
    expect(screen.getByText('Drag onto the page, or click to add after the selection.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Controls' }));
    expect(within(screen.getByRole('list', { name: 'Controls' })).getAllByRole('button').map(button => button.textContent)).toEqual(['Toggle', 'Command', 'Choice', 'Button', 'Settings link']);
  });
});

describe('Components and Controls in Use', () => {
  const lines = { components: 'Switch to Edit to add components.', controls: 'Switch to Edit to add controls.' } as const;
  const hint = 'Drag onto the page, or click to add after the selection.';

  it.each([['Components', 'components'], ['Controls', 'controls']] as const)('%s shows its line and a Switch to Edit button, no hint, and describes each dimmed cell by the notice', (label, key) => {
    render(<Harness tier="docked" mode="use"/>);
    fireEvent.click(screen.getByRole('button', { name: label }));
    const notice = screen.getByTestId('library-notice');
    expect(within(notice).getByText(lines[key])).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Switch to Edit' })).toBeTruthy();
    expect(screen.queryByText(hint)).toBeNull();
    const cells = within(screen.getByRole('list', { name: label === 'Components' ? 'Layout' : label })).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) { expect(cell.getAttribute('aria-disabled')).toBe('true'); expect(cell.getAttribute('aria-describedby')).toBe(notice.id); }
  });

  it('does nothing when a dimmed cell is clicked', () => {
    render(<Harness tier="docked" mode="use"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Layout' })).getAllByRole('button')[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Switch to Edit switches the mode and leaves focus on the first cell', async () => {
    const changed = vi.fn();
    function Switching() { const [mode, setMode] = useState<'edit' | 'use'>('use'); return <Harness tier="docked" mode={mode} setMode={next => { changed(next); setMode(next); }}/>; }
    render(<Switching/>);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Edit' }));
    expect(changed).toHaveBeenCalledWith('edit');
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('list', { name: 'Layout' })).getAllByRole('button')[0]));
    expect(screen.queryByTestId('library-notice')).toBeNull();
  });

  it('in Edit the hint shows and the notice does not', () => {
    render(<Harness tier="docked"/>);
    for (const label of ['Components', 'Controls']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByText(hint)).toBeTruthy();
      expect(screen.queryByTestId('library-notice')).toBeNull();
      for (const cell of within(screen.getByRole('list', { name: label === 'Components' ? 'Layout' : label })).getAllByRole('button')) expect(cell.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('writes the Use words to a snapshot and holds them to the voice rules', async () => {
    const { container } = render(<Harness tier="docked" mode="use"/>);
    const seen: [string, string[]][] = [];
    for (const [name, label] of [['components', 'Components'], ['controls', 'Controls']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const panel = container.querySelector('[data-testid=library-panel]')!;
      await expect(copyOf(panel)).toMatchFileSnapshot(`./snapshots/copy/library-${name}-use.txt`);
      seen.push([name, voiceIssues(panel)]);
    }
    expect(seen.filter(([, issues]) => issues.length)).toEqual([]);
  });
});

describe('copy', () => {
  it('writes the words of each category to a snapshot and holds them to the voice rules', async () => {
    const { container } = render(<Harness tier="docked"/>);
    const seen: [string, string[]][] = [];
    for (const [name, label] of [['tabs', 'Tabs'], ['pages', 'Pages'], ['sheets', 'Sheets'], ['modals', 'Modals'], ['components', 'Components'], ['controls', 'Controls']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const panel = container.querySelector('[data-testid=library-panel]')!;
      await expect(copyOf(panel)).toMatchFileSnapshot(`./snapshots/copy/library-${name}.txt`);
      seen.push([name, voiceIssues(panel)]);
    }
    expect(seen.filter(([, issues]) => issues.length)).toEqual([]);
  });
});
