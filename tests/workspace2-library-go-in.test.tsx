// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import type { NavSurface } from '../src/preview2/navigation';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import LibraryPanel from '../src/workspace2/LibraryPanel';
import Crumbs from '../src/workspace2/Crumbs';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import PagesPanel from '../src/workspace2/PagesPanel';
import { useLibrary } from '../src/workspace2/useLibrary';
import { categoryOfSurface, emptyTrail, enterLevel, followSelection, inLevelTrail, leaveLevel, setTrail, trailOf, validTrail, useLibraryTrail } from '../src/workspace2/useLibraryTrail';
import { levelCrumbs } from '../src/workspace2/levels';
import { surfaceAfterMove } from '../src/workspace2/selection';
import type { Category } from '../src/workspace2/layout';
import { Project } from './support/workspace2-surfaces';
import { copyOf, voiceIssues } from './support/copy';
import { demoDocument } from './preview2-gc-fixture';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));

/** The demo document: the sheet `demo_sheet` opens level A, which opens level B; `demo_level_alone` is opened by nothing. */
const doc: CompositionDocument = demoDocument();
const index = buildDocumentIndex(doc);
const key = (value: string) => value as SelectionKey;
beforeEach(() => localStorage.clear());
afterEach(cleanup);

/**
 * The panel on Sheets over a workspace whose simulator is real enough to follow: `setSurface` moves `surface`, and the panel is drawn again with it. `calls` records what the panel asked of the
 * workspace.
 */
function Harness({ calls, start, category = 'sheets' }: { calls: ReturnType<typeof fresh>; start?: NavSurface; category?: Category }) {
  const stored = useLibrary('docked', 1440), trailApi = useLibraryTrail();
  const [surface, setSurface] = useState<NavSurface>(start ?? { kind: 'page', id: doc.navigation.initialPageId });
  const [selection, setSelection] = useState<string>();
  calls.move = setSurface;
  calls.pick = setSelection;
  const ws = useMemo(() => Project.workspace(doc, undefined, { extra: {
    surface, selection, setSurface: (next: NavSurface) => { calls.surface.push(next); setSurface(next); },
    selectAnywhere: (selected: string) => { calls.selectAnywhere.push(selected); },
    select: (selected: unknown) => { calls.select.push(selected); },
  } }), [surface, selection, calls]);
  return <LibraryPanel ws={ws} document={doc} tier="docked" category={category} open shown library={{ ...stored, category, open: true }} trailApi={trailApi} onCategory={() => {}} onKeepPanel={selected => calls.keep.push(selected)} onError={() => {}} onClose={() => {}}/>;
}
const fresh = () => ({ surface: [] as NavSurface[], selectAnywhere: [] as string[], select: [] as unknown[], keep: [] as string[], move: undefined as ((surface: NavSurface) => void) | undefined, pick: undefined as ((key: string | undefined) => void) | undefined });
const rows = () => screen.getAllByRole('treeitem');
const row = (name: string) => rows().find(item => item.querySelector('.w2-tree-title')?.textContent === name)!;
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const path = () => [...screen.getByRole('navigation', { name: 'Path' }).querySelectorAll('.w2-crumb')].map(item => item.textContent);
/** Opens Demo Sheet and goes into one of its levels with a click on the row. */
const intoLevel = (name: string) => { fireEvent.click(row('Demo Sheet')); fireEvent.click(row(name)); };

describe('the trail inside a level of a sheet', () => {
  it('is the level itself, which survives validation and leaves to the top-level list', () => {
    const inside = enterLevel(emptyTrail, 'sheets', index, key('level:demo_level_a'));
    expect(trailOf(inside, 'sheets')).toEqual(['level:demo_level_a']);
    expect(inLevelTrail(trailOf(inside, 'sheets'))).toBe(true);
    expect(validTrail(index, ['level:demo_level_a'])).toEqual(['level:demo_level_a']);
    expect(trailOf(leaveLevel(inside, 'sheets'), 'sheets')).toEqual([]);
  });

  it('goes up one container at a time, and a level that is gone empties the trail', () => {
    const tile = key('node:demo_level_a_to_demo_level_b');
    const container = [...index.entries.values()].find(entry => entry.surface === 'level:demo_level_a' && entry.kind === 'node')!;
    const deep = setTrail(emptyTrail, 'sheets', ['level:demo_level_a', container.key]);
    expect(trailOf(leaveLevel(deep, 'sheets'), 'sheets')).toEqual(['level:demo_level_a']);
    expect(validTrail(index, ['level:demo_level_a', key('node:gone')])).toEqual(['level:demo_level_a']);
    expect(validTrail(index, ['level:gone'])).toEqual([]);
    expect(index.get(tile)?.surface).toBe('level:demo_level_a');
  });

  it('names the list that owns a level: its sheet\'s, else Sheets', () => {
    expect(categoryOfSurface(doc, key('level:demo_level_a'))).toBe('sheets');
    expect(categoryOfSurface(doc, key('level:demo_level_alone'))).toBe('sheets');
    const full = { ...doc, modals: doc.modals.map(modal => modal.id === 'demo_sheet' ? { ...modal, presentation: { ...modal.presentation, fullScreen: true } } : modal) } as CompositionDocument;
    expect(categoryOfSurface(full, key('level:demo_level_a'))).toBe('modals');
    expect(categoryOfSurface(full, key('level:demo_level_a'), { kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' })).toBe('modals');
  });

  it('follows a node of a level to the level, and opens the row of the sheet it hangs from', () => {
    const found = followSelection(doc, index, key('node:demo_level_a_to_demo_level_b'));
    expect(found).toEqual({ category: 'sheets', trail: ['level:demo_level_a'], surface: 'modal:demo_sheet' });
    expect(followSelection(doc, index, key('node:demo_alone_unknown'))).toBeUndefined();
  });

  it('writes the path a level is reached through: the sheet, then the levels between', () => {
    expect(levelCrumbs(doc, undefined, 'demo_level_a').map(crumb => crumb.title)).toEqual(['Demo Sheet']);
    expect(levelCrumbs(doc, undefined, 'demo_level_b').map(crumb => [crumb.key, crumb.title])).toEqual([['modal:demo_sheet', 'Demo Sheet'], ['level:demo_level_a', 'Demo Level A']]);
    expect(levelCrumbs(doc, { kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet' }, 'demo_level_b')).toHaveLength(2);
    expect(levelCrumbs(doc, undefined, 'demo_level_alone')).toEqual([]);
  });
});

describe('a level row in the Sheets list', () => {
  it('is named for its sheet, one indent under it, with the triangle and the count of a container', () => {
    render(<Harness calls={fresh()}/>);
    fireEvent.click(row('Demo Sheet'));
    const level = row('Demo Level A');
    expect(level.getAttribute('aria-label')).toBe('Demo Level A, level of Demo Sheet');
    expect(level.getAttribute('aria-level')).toBe('2');
    expect(level.getAttribute('aria-expanded')).toBe('false');
    expect(level.querySelector('.w2-tree-count')?.textContent).toBe('2');
    expect(within(level).getByRole('button', { name: 'Show what is in Demo Level A' })).toBeTruthy();
  });

  it('opens in place with its triangle or Right Arrow, one indent deeper, and shows nothing in the simulator', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    fireEvent.click(row('Demo Sheet'));
    calls.surface.length = 0;
    fireEvent.click(within(row('Demo Level A')).getByRole('button', { name: 'Show what is in Demo Level A' }));
    expect(row('Demo Level A').getAttribute('aria-expanded')).toBe('true');
    const inside = rows().filter(item => item.getAttribute('aria-level') === '3').map(item => item.querySelector('.w2-tree-title')?.textContent);
    expect(inside.length).toBe(2);
    expect(calls.surface).toEqual([]);
    row('Demo Level B').focus();
    fireEvent.keyDown(row('Demo Level B'), { key: 'ArrowRight' });
    expect(row('Demo Level B').getAttribute('aria-expanded')).toBe('true');
  });

  it('goes in on a click or Enter: the simulator shows it inside its sheet with nothing selected', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    fireEvent.click(row('Demo Sheet'));
    fireEvent.keyDown(row('Demo Level A'), { key: 'Enter' });
    expect(calls.surface.at(-1)).toEqual({ kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' });
    expect(calls.select.at(-1)).toBeUndefined();
    expect(heading()).toBe('Demo Level A');
  });
});

describe('inside a level', () => {
  it('the header is Back to the sheet, the level\'s name and the path "Sheets › Demo Sheet"', () => {
    render(<Harness calls={fresh()}/>);
    intoLevel('Demo Level A');
    expect(heading()).toBe('Demo Level A');
    expect(screen.getByRole('button', { name: 'Back to Demo Sheet' })).toBeTruthy();
    expect(path()).toEqual(['Sheets', 'Demo Sheet']);
    expect(screen.getByRole('status').textContent).toBe('Showing Demo Level A, a level of Demo Sheet.');
  });

  it('lists the level\'s rows from the edge, and its footer is Add Here and Level Settings', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    intoLevel('Demo Level A');
    expect(rows().map(item => item.getAttribute('aria-level'))).toEqual(rows().map(() => '1'));
    expect(screen.getByRole('button', { name: 'Add Here' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Level Settings' }));
    expect(calls.selectAnywhere.at(-1)).toBe('level:demo_level_a');
    expect(calls.keep.at(-1)).toBe('level:demo_level_a');
  });

  it('a level opened from another level reads "Sheets › Demo Sheet › Demo Level A", and Back goes to that level', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    fireEvent.click(row('Demo Sheet'));
    fireEvent.click(row('Demo Level B'));
    expect(heading()).toBe('Demo Level B');
    expect(path()).toEqual(['Sheets', 'Demo Sheet', 'Demo Level A']);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Demo Level A' }));
    expect(heading()).toBe('Demo Level A');
    expect(calls.surface.at(-1)).toEqual({ kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' });
    expect(path()).toEqual(['Sheets', 'Demo Sheet']);
  });

  it('Back, or the sheet\'s crumb, returns to the Sheets list with the sheet open and shown, and the level\'s row marked and focused', async () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    intoLevel('Demo Level A');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Demo Sheet' }));
    expect(calls.surface.at(-1)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(heading()).toBe('Sheets');
    expect(row('Demo Sheet').getAttribute('aria-expanded')).toBe('true');
    expect(row('Demo Level A').hasAttribute('data-selected')).toBe(true);
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined))); });
    expect(document.activeElement).toBe(row('Demo Level A'));
    // The sheet's crumb does the same, and so does the one for Sheets.
    fireEvent.click(row('Demo Level A'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button', { name: 'Demo Sheet' }));
    expect(heading()).toBe('Sheets');
    fireEvent.click(row('Demo Level A'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button', { name: 'Sheets' }));
    expect(heading()).toBe('Sheets');
  });

  it('the mark after Back goes when a tile is picked in the simulator, or on any press or key', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    intoLevel('Demo Level A');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Demo Sheet' }));
    expect(row('Demo Level A').hasAttribute('data-selected')).toBe(true);
    act(() => calls.pick!('node:demo_level_a_to_demo_level_b'));
    expect(screen.queryAllByRole('treeitem').some(item => item.querySelector('.w2-tree-title')?.textContent === 'Demo Level A' && item.hasAttribute('data-selected'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^Back to/ }));
    fireEvent.click(row('Demo Level A'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Demo Sheet' }));
    expect(row('Demo Level A').hasAttribute('data-selected')).toBe(true);
    fireEvent.keyDown(screen.getByTestId('library-tree'), { key: 'ArrowDown' });
    expect(row('Demo Level A').hasAttribute('data-selected')).toBe(false);
  });

  it('going in by Enter or a click puts focus on Back, in the header', async () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    fireEvent.click(row('Demo Sheet'));
    row('Demo Level A').focus();
    fireEvent.keyDown(row('Demo Level A'), { key: 'Enter' });
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined))); });
    expect(heading()).toBe('Demo Level A');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to Demo Sheet' }));
    expect(screen.getByRole('banner').contains(document.activeElement)).toBe(true);
  });

  const frame = () => act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined))); });

  it('a level revealed while focus is nowhere (+ Level) takes focus on Back', async () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => calls.move!({ kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' }));
    await frame();
    expect(heading()).toBe('Demo Level A');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to Demo Sheet' }));
  });

  it('focus that moves outside the library between the reveal and the deferred step stays where it went (a Show button focuses the simulator)', async () => {
    const calls = fresh();
    render(<><button type="button">Simulator surface</button><Harness calls={calls}/></>);
    act(() => calls.move!({ kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' }));
    const outside = screen.getByRole('button', { name: 'Simulator surface' });
    outside.focus();
    await frame();
    expect(heading()).toBe('Demo Level A');
    expect(document.activeElement).toBe(outside);
  });

  it('a level no sheet opens has the path "Sheets", and Back goes to the list', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    fireEvent.click(row('Demo Level Alone'));
    expect(calls.surface.at(-1)).toEqual({ kind: 'level', id: 'demo_level_alone' });
    expect(heading()).toBe('Demo Level Alone');
    expect(path()).toEqual(['Sheets']);
    expect(screen.getByRole('status').textContent).toBe('Showing Demo Level Alone.');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sheets' }));
    expect(heading()).toBe('Sheets');
  });

  it('follows the simulator into a level and out of it (Use, a Show button, Undo), and opens on the list that was asked for', () => {
    const calls = fresh();
    render(<Harness calls={calls}/>);
    expect(heading()).toBe('Sheets');
    act(() => calls.move!({ kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet' }));
    expect(heading()).toBe('Demo Level B');
    expect(path()).toEqual(['Sheets', 'Demo Sheet', 'Demo Level A']);
    act(() => calls.move!({ kind: 'modal', id: 'demo_sheet' }));
    expect(heading()).toBe('Sheets');
    expect(row('Demo Sheet').getAttribute('aria-expanded')).toBe('true');
    cleanup();
    // Opened with a level already on show: the list the rail item asked for, not the level.
    render(<Harness calls={fresh()} start={{ kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet' }}/>);
    expect(heading()).toBe('Sheets');
  });

  it('keeps the level\'s own row in Find, and a search inside the level names it', () => {
    render(<Harness calls={fresh()}/>);
    intoLevel('Demo Level A');
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Find in Demo Level A');
  });
});

describe('after a move to Pages or to Sheets', () => {
  const asPage = (document: CompositionDocument, id: string): CompositionDocument => {
    const level = document.levels!.find(item => item.id === id)!;
    return { ...document, levels: document.levels!.filter(item => item.id !== id), pages: [...document.pages, { ...level, navigation: { type: 'stack' }, layout: { ...level.layout } } as never] };
  };
  it('keeps the surface on show: a level moved to Pages is shown as a page', () => {
    const next = asPage(doc, 'demo_level_b');
    expect(surfaceAfterMove(next, { kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet' })).toEqual({ kind: 'page', id: 'demo_level_b' });
    expect(surfaceAfterMove(next, { kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' })).toBeUndefined();
  });

  it('a page moved to Sheets is shown as a level, inside the sheet that opens it', () => {
    const next = { ...doc, pages: doc.pages.filter(item => item.id !== 'demo_plain'), levels: [...doc.levels!, { ...doc.levels![0], id: 'demo_plain', title: 'Demo Plain' }] } as CompositionDocument;
    expect(surfaceAfterMove(next, { kind: 'page', id: 'demo_plain' })).toMatchObject({ kind: 'level', id: 'demo_plain' });
    expect(surfaceAfterMove(doc, { kind: 'page', id: 'demo_plain' })).toBeUndefined();
    expect(surfaceAfterMove(next, { kind: 'modal', id: 'demo_sheet' })).toBeUndefined();
    expect(surfaceAfterMove(next, undefined)).toBeUndefined();
  });
});

describe('the path\'s fold', () => {
  it('names the "…" button "More of the path"', () => {
    const wide = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
    const titles = ['Sheets', 'Advanced Controls', 'Protection Settings', 'Demo Level A'];
    render(<Crumbs path={titles.map((title, at) => ({ key: key(`node:c${at}`), title }))} atRoot={false} onJump={() => {}}/>);
    expect(screen.getByRole('button', { name: 'More of the path' }).textContent).toBe('…');
    expect(screen.queryByRole('button', { name: 'Hidden levels' })).toBeNull();
    wide.mockRestore();
  });
});

describe('the phone\'s Pages sheet', () => {
  it('a level\'s row shows the level inside its sheet, and is the current row while it is on show', () => {
    const picked: unknown[] = [], levels: unknown[] = [];
    const { rerender } = render(<PagesPanel document={doc} current={{ kind: 'modal', id: 'demo_sheet' }} onPick={next => picked.push(next)} onPickLevel={(id, sheet) => levels.push([id, sheet])}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Sheets' }));
    fireEvent.click(screen.getByText('Demo Level A').closest('button')!);
    expect(levels).toEqual([['demo_level_a', 'demo_sheet']]);
    expect(picked).toEqual([]);
    fireEvent.click(screen.getByText('Demo Level Alone').closest('button')!);
    expect(levels.at(-1)).toEqual(['demo_level_alone', undefined]);
    rerender(<PagesPanel document={doc} current={{ kind: 'modal', id: 'demo_sheet' }} currentLevel="demo_level_a" onPick={() => {}} onPickLevel={() => {}}/>);
    expect(screen.getByText('Demo Level A').closest('button')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Demo Sheet').closest('button')!.getAttribute('aria-current')).toBeNull();
  });
});

describe('Level Settings and the inspector\'s path', () => {
  const settings = (target: 'level' | 'node') => {
    const entry = index.get(key(target === 'level' ? 'level:demo_level_a' : 'node:demo_level_a_to_demo_level_b'))!;
    const ws = Project.workspace(doc, { kind: target, key: entry.key, path: entry.path } as never, { extra: { surface: { kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' } } });
    return render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
  };

  it('a level has the name and the list icon of a sheet, under a header that says it is a level of its sheet', async () => {
    const { container } = settings('level');
    expect(container.querySelector('h2')?.textContent).toBe('Demo Level A');
    expect(container.querySelector('.w2-props-titles p')?.textContent).toBe('Level settings · Demo Sheet');
    for (const word of ['Title', 'Icon', 'Header buttons']) expect(container.textContent).toContain(word);
    expect(container.querySelector('[data-field-path="levels/0/title"]')).not.toBeNull();
    // Nothing of a page or a sheet's presentation: no tabs, hides, wide window or height.
    for (const word of ['Hide on this page', 'Opens', 'Height', 'Full screen', 'Width on iPad']) expect(container.textContent).not.toContain(word);
    expect(container.textContent).toContain('Opened from');
    // A level inherits its sheet's header buttons, so its first choice says so; a page's and a sheet's stay "Same as app".
    expect(container.textContent).toContain('Same as sheet');
    expect(container.textContent).not.toContain('Same as app');
    await expect(copyOf(container)).toMatchFileSnapshot('./snapshots/copy/properties-level-settings.txt');
    expect(voiceIssues(container)).toEqual([]);
  });

  it('a page\'s and a sheet\'s Header buttons still read "Same as app"', () => {
    for (const entry of [index.get(key('modal:demo_sheet'))!, index.get(key(`page:${doc.navigation.initialPageId}`))!]) {
      const ws = Project.workspace(doc, { kind: entry.kind, key: entry.key, path: entry.path } as never);
      const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
      expect(container.textContent).toContain('Same as app');
      expect(container.textContent).not.toContain('Same as sheet');
      unmount();
    }
  });

  it('a node of a level names where it is, through the sheet, and carries the whole line as its title', () => {
    const { container } = settings('node');
    const line = container.querySelector('.w2-props-titles p')!;
    expect(line.textContent).toBe('Room overview tile · Demo Sheet › Demo Level A');
    expect(line.getAttribute('title')).toBe(line.textContent);
  });
});

describe('copy', () => {
  it('writes the words inside a level to a snapshot and holds them to the voice rules', async () => {
    const { container } = render(<Harness calls={fresh()}/>);
    intoLevel('Demo Level A');
    await expect(copyOf(container)).toMatchFileSnapshot('./snapshots/copy/library-level-of-sheet.txt');
    expect(voiceIssues(container)).toEqual([]);
  });
});
