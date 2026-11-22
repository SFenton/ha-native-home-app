// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import LibraryPanel from '../src/workspace2/LibraryPanel';
import { useLibrary } from '../src/workspace2/useLibrary';
import { useLibraryTrail } from '../src/workspace2/useLibraryTrail';
import type { Category } from '../src/workspace2/layout';
import { NavigationHost } from '../src/workspace2/navigation/NavigationDialogs';
import PagesPanel from '../src/workspace2/PagesPanel';
import { Project } from './support/workspace2-surfaces';
import type { PreviewSurface } from '../src/preview2/Preview2';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));
beforeEach(() => localStorage.clear());
afterEach(cleanup);

type J = Record<string, any>;
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
const levelOf = (document: J, id: string, title: string): J => {
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  return { ...surface, id, title, toolbar: { type: 'replace', groups: [] }, components: [{ ...surface.components[0], id: `${id}_text` }] };
};
/** The first-slice document with levels under Palette (A, which opens B) and one no sheet reaches (C). Sample Detail is a page two tabs and a sheet open. */
function withLevels(): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.levels = [levelOf(document, 'demo_level_a', 'Demo Level A'), levelOf(document, 'demo_level_b', 'Demo Level B'), levelOf(document, 'demo_level_c', 'Demo Level C')];
  document.levels[0].components.push(tile('demo_in_a', push('demo_level_b')));
  document.modals[0].components.push(tile('demo_open_a', push('demo_level_a')));
  return document as CompositionDocument;
}

/** The sheets list with the real tree, a document the dialogs and the menus edit, and the simulator showing `shown`. */
function Harness({ category = 'sheets', shown = { kind: 'modal', id: 'modal-swatch' } as PreviewSurface, start = withLevels(), setSurface = vi.fn() }: { category?: Category; shown?: PreviewSurface; start?: CompositionDocument; setSurface?: (surface: PreviewSurface) => void }) {
  const [document, setDocument] = useState(start);
  const stored = useLibrary('docked', 1440), trailApi = useLibraryTrail();
  const library = useMemo(() => ({ ...stored, category, open: true }), [stored, category]);
  const ws = useMemo(() => Project.workspace(document, undefined, { extra: { surface: shown, setSurface } }, setDocument), [document, shown, setSurface]);
  return <><NavigationHost ws={ws}/>
    <LibraryPanel ws={ws} document={document} tier="docked" category={category} open shown library={library} trailApi={trailApi} onCategory={() => {}} onKeepPanel={() => {}} onError={() => {}} onClose={() => {}}/>
    <output data-testid="doc">{JSON.stringify({ pages: document.pages.map(page => page.id), levels: document.levels?.map(level => level.id) ?? null, titles: document.levels?.map(level => level.title) ?? [] })}</output>
  </>;
}
const state = () => JSON.parse(screen.getByTestId('doc').textContent!) as { pages: string[]; levels: string[] | null; titles: string[] };
const rows = () => screen.getAllByRole('treeitem');
/** The titles of the sheet and level rows: an open sheet also lists its own tiles, which these tests do not look at. */
const surfaceTitles = () => rows().filter(row => /^(modal|level):/.test(row.getAttribute('data-row') ?? '')).map(row => row.querySelector('.w2-tree-title')?.textContent);
const rowOf = (name: string) => rows().find(row => row.getAttribute('data-row') === name || row.querySelector('.w2-tree-title')?.textContent === name)!;
const menuOf = (title: string) => { fireEvent.click(within(rowOf(title)).getByRole('button', { name: `More for ${title}` })); return screen.findByRole('menu'); };
/** Opens the sheet's row, which lists its levels and its own rows; a closed sheet lists neither. */
const open = (name = 'Palette') => fireEvent.click(screen.getByRole('button', { name: `Show what is in ${name}` }));
const items = async (title: string) => within(await menuOf(title)).getAllByRole('menuitem').map(item => item.textContent);

/** Sample Detail opened only by a sheet, itself opened by a page of the first tab. */
const sheetOnly = (): CompositionDocument => {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  const strip = (nodes: J[]): J[] => nodes.filter(node => !JSON.stringify(node).includes('"pageId":"page-echo"'));
  for (const page of document.pages) page.components = strip(page.components);
  document.modals[0].components = strip(document.modals[0].components);
  document.navigation.chrome.groups[0].items = document.navigation.chrome.groups[0].items.filter((item: J) => item.id !== 'chrome-inspect');
  document.pages[0].components.push(tile('demo_present', { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }));
  document.modals[0].components.push(tile('demo_open_echo', push('page-echo')));
  return document as CompositionDocument;
};

describe('the Sheets list with levels', () => {
  it('draws a sheet\'s levels indented beneath it with the Level tag and "Needs a newer app", and the ones no sheet reaches under Not Linked', () => {
    render(<Harness/>);
    open();
    const sheet = rowOf('Palette');
    expect(sheet.getAttribute('aria-level')).toBe('1');
    const level = rowOf('Demo Level A');
    expect(level.getAttribute('aria-level')).toBe('2');
    expect(within(level).getByText('Level')).toBeTruthy();
    expect(within(level).getByText('Needs a newer app')).toBeTruthy();
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level A', 'Demo Level B', 'Demo Level C']);
    expect(rowOf('Demo Level C').getAttribute('aria-level')).toBe('1');
    expect(within(rowOf('Demo Level C')).getByText('No Way In')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Not Linked/ })).toBeTruthy();
    expect(screen.getByText('3 levels', { exact: false }).textContent).toContain('1 sheet · 3 levels');
  });

  it('shows the level in the simulator, inside the sheet its row hangs from, when the level is chosen; one no sheet reaches is shown alone', () => {
    const setSurface = vi.fn();
    render(<Harness setSurface={setSurface}/>);
    open();
    fireEvent.click(rowOf('Demo Level B'));
    expect(setSurface).toHaveBeenCalledWith({ kind: 'level', id: 'demo_level_b', sheetId: 'modal-swatch' });
    cleanup();
    setSurface.mockClear();
    render(<Harness setSurface={setSurface}/>);
    fireEvent.click(rowOf('Demo Level C'));
    expect(setSurface).toHaveBeenCalledWith({ kind: 'level', id: 'demo_level_c' });
  });

  it('a closed sheet lists neither its levels nor its rows; Not Linked levels stay', () => {
    render(<Harness/>);
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level C']);
    open();
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level A', 'Demo Level B', 'Demo Level C']);
    fireEvent.click(screen.getByRole('button', { name: 'Hide what is in Palette' }));
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level C']);
  });

  it('a level row with a note: the title alone on line 1, then the tags and the note', () => {
    render(<Harness/>);
    open();
    const level = rowOf('Demo Level A');
    const text = level.querySelector('.w2-tree-text')!;
    expect(text.children[0].className).toBe('w2-tree-title');
    expect(text.children[0].textContent).toBe('Demo Level A');
    expect(text.children[1].className).toBe('w2-tree-sub');
    expect(text.children[1].textContent).toBe('LevelNeeds a newer app');
    expect(level.querySelector('.w2-tree-head')).toBeNull();
  });

  it('a refusal stays, with the warning mark, until the next action in the library', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness category="pages" start={withLevels()} shown={{ kind: 'page', id: 'page-orbit' }}/>);
      fireEvent.click(within(await menuOf('Sample Detail')).getByRole('menuitem', { name: 'Move to Sheets' }));
      const line = await screen.findByTestId('library-refusal');
      expect(line.querySelector('svg')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(6000); });
      expect(screen.getByTestId('library-refusal')).toBe(line);
      fireEvent.pointerDown(screen.getByRole('searchbox'));
      expect(screen.queryByTestId('library-refusal')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('searches the levels: a sheet stays for a level that matches, with that level alone', () => {
    render(<Harness/>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'level b' } });
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level B']);
  });

  it('a level\'s menu is Rename, Move to Pages and Delete, and a sheet\'s is the sheet\'s own', async () => {
    render(<Harness/>);
    open();
    expect(await items('Demo Level A')).toEqual(['Rename', 'Move to Pages', 'Delete']);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(await items('Palette')).toEqual(['Rename', 'Duplicate', 'Sheet Settings', 'Change List Icon…', 'Delete']);
  });

  it('Move to Pages takes the level out of the list and makes it a page, in one change', async () => {
    render(<Harness/>);
    open();
    const menu = await menuOf('Demo Level B');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Pages' }));
    await waitFor(() => expect(state().levels).toEqual(['demo_level_a', 'demo_level_c']));
    expect(state().pages).toEqual(['page-orbit', 'page-lattice', 'page-echo', 'demo_level_b']);
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level A', 'Demo Level C']);
  });

  it('Move to Pages on a level that opens another level is refused in the list, and writes nothing', async () => {
    render(<Harness/>);
    open();
    fireEvent.click(within(await menuOf('Demo Level A')).getByRole('menuitem', { name: 'Move to Pages' }));
    expect((await screen.findByTestId('library-refusal')).textContent).toBe('Demo Level A opens Demo Level B, a level, so it stays in Sheets. Move Demo Level B to Pages first.');
    expect(state().levels).toEqual(['demo_level_a', 'demo_level_b', 'demo_level_c']);
  });

  it('Rename opens its dialog and writes the new name', async () => {
    render(<Harness/>);
    open();
    const menu = await menuOf('Demo Level A');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Wiring' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(state().titles[0]).toBe('Wiring'));
    expect(rowOf('Wiring')).toBeTruthy();
  });

  it('Delete asks, saying how many tiles open it, and removes the level and its tile', async () => {
    render(<Harness/>);
    open();
    const menu = await menuOf('Demo Level A');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('1 tile opens this level. Its action is removed.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(state().levels).toEqual(['demo_level_b', 'demo_level_c']));
  });

  it('+ Level is disabled until a sheet is on show, then adds a level to that sheet through the New Level dialog', async () => {
    const { unmount } = render(<Harness shown={{ kind: 'page', id: 'page-orbit' }}/>);
    expect((screen.getByRole('button', { name: 'Level' }) as HTMLButtonElement).disabled).toBe(true);
    // The reason is text beside the button, not a tooltip a phone never shows.
    expect(screen.getByText('Choose a sheet first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Level' }).getAttribute('aria-describedby')).toContain('w2-lib-level-reason');
    unmount();
    render(<Harness/>);
    const add = screen.getByRole('button', { name: 'Level' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(screen.getByText('A level opens inside its sheet, with Back and Close. Move it to Pages and it opens as a page, with the tabs and header buttons.')).toBeTruthy();
    fireEvent.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'New Level' });
    expect(dialog.textContent).toContain('A level of Palette.');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Details' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(state().titles).toContain('Details'));
    // Adding a level opens its sheet, so the new row is seen where it went.
    await waitFor(() => expect(surfaceTitles()).toEqual(['Palette', 'Demo Level A', 'Demo Level B', 'Details', 'Demo Level C']));
  });

  it('the Modals list carries a modal\'s levels and its own + Level', () => {
    const start: J = withLevels();
    start.modals[0].presentation.fullScreen = true;
    render(<Harness category="modals" start={start as CompositionDocument}/>);
    open();
    expect(surfaceTitles()).toEqual(['Palette', 'Demo Level A', 'Demo Level B']);
    expect((screen.getByRole('button', { name: 'Level' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('A level opens inside its modal, with Back and Close. Move it to Pages and it opens as a page, with the tabs and header buttons.')).toBeTruthy();
  });
});

describe('the Pages list', () => {
  it('has no "From a Sheet" group once levels are declared: a page a sheet opens is under the flow of the page that opens the sheet', () => {
    const declared: J = sheetOnly();
    declared.levels = [];
    render(<Harness category="pages" start={declared as CompositionDocument} shown={{ kind: 'page', id: 'page-orbit' }}/>);
    expect(screen.queryByText('From a Sheet')).toBeNull();
    expect(screen.getByRole('button', { name: /^From Canvas/ })).toBeTruthy();
    expect(rows().map(row => row.querySelector('.w2-tree-title')?.textContent)).toEqual(['Sample Detail']);
  });

  it('without a levels key the page a sheet opens stays inside the sheet: From a Sheet', () => {
    render(<Harness category="pages" start={sheetOnly()} shown={{ kind: 'page', id: 'page-orbit' }}/>);
    expect(screen.getByRole('button', { name: /^From a Sheet/ })).toBeTruthy();
  });

  it('Move to Sheets is in a page\'s menu, and a refusal says why, in the list', async () => {
    render(<Harness category="pages" start={withLevels()} shown={{ kind: 'page', id: 'page-orbit' }}/>);
    const menu = await menuOf('Sample Detail');
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Rename', 'Duplicate', 'Page Settings', 'Move to Sheets', 'Change List Icon…', 'Delete']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Sheets' }));
    expect((await screen.findAllByText(/is opened from Canvas, a page/))[0].textContent).toBe('Sample Detail is opened from Canvas, a page. Only a sheet can open a level. Remove that link first.');
    expect(state().levels).toEqual(['demo_level_a', 'demo_level_b', 'demo_level_c']);
  });

  it('Move to Sheets makes a page nothing opens a level of the document, and takes it off the list', async () => {
    render(<Harness category="pages" start={sheetOnly()} shown={{ kind: 'page', id: 'page-orbit' }}/>);
    // The document has no `levels` key: the first level is asked about, in the Studio's question dialog.
    fireEvent.click(within(await menuOf('Sample Detail')).getByRole('menuitem', { name: 'Move to Sheets' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Move Sample Detail to Sheets?')).toBeTruthy();
    expect(question.textContent).toContain('This will be the first level. After it, a page opened from any sheet closes that sheet first; today it opens inside the sheet.');
    expect(within(question).getAllByRole('button').map(button => button.textContent)).toEqual(['Cancel', 'Move to Sheets']);
    // Nothing is removed, so the change's button is the ordinary primary one, not the danger style.
    expect(within(question).getByRole('button', { name: 'Move to Sheets' }).className).toBe('w2-primary');
    // Cancel changes nothing and leaves no line.
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(state().levels).toBeNull();
    expect(screen.queryByTestId('library-refusal')).toBeNull();
    fireEvent.click(within(await menuOf('Sample Detail')).getByRole('menuitem', { name: 'Move to Sheets' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move to Sheets' }));
    await waitFor(() => expect(state().levels).toEqual(['page-echo']));
    expect(state().pages).toEqual(['page-orbit', 'page-lattice']);
    // The second level is not asked about.
  });

  it('+ Level on a document without levels says what the first level changes, in the New Level dialog', async () => {
    const start: J = withLevels();
    delete start.levels;
    start.modals[0].components = start.modals[0].components.filter((node: J) => !JSON.stringify(node).includes('demo_level'));
    render(<Harness start={start as CompositionDocument}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Level' }));
    const dialog = await screen.findByRole('dialog', { name: 'New Level' });
    expect(within(dialog).getByText('This will be the first level. After it, a page opened from any sheet closes that sheet first; today it opens inside the sheet.')).toBeTruthy();
  });

  it('+ Level on a document that already declares levels does not say it', async () => {
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Level' }));
    const dialog = await screen.findByRole('dialog', { name: 'New Level' });
    expect(within(dialog).queryByText(/This will be the first level/)).toBeNull();
  });
});

describe('the phone\'s Pages sheet', () => {
  it('lists a sheet\'s levels beneath it, with the Level tag and the note, and + Level for the sheet on show', async () => {
    const document = withLevels();
    const changed = vi.fn();
    render(<><NavigationHost ws={Project.workspace(document)}/><PagesPanel document={document} current={{ kind: 'modal', id: 'modal-swatch' }} onPick={() => {}} actions={{ onChange: changed }}/></>);
    expect(screen.getByRole('button', { name: 'Sheets' }).getAttribute('aria-pressed')).toBe('true');
    const names = screen.getAllByRole('button', { name: /^More for / }).map(button => button.getAttribute('aria-label'));
    expect(names).toEqual(['More for Palette', 'More for Demo Level A', 'More for Demo Level B', 'More for Demo Level C']);
    expect(screen.getAllByText('Needs a newer app')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'More for Demo Level B' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move to Pages' }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].pages.map((page: J) => page.id)).toContain('demo_level_b');
    expect(screen.queryByText('Choose a sheet first')).toBeNull();
    const level = screen.getByRole('button', { name: 'Level' }) as HTMLButtonElement;
    expect(level.disabled).toBe(false);
    fireEvent.click(level);
    expect(await screen.findByRole('dialog', { name: 'New Level' })).toBeTruthy();
  });

  it('keeps the Pages sheet open and says why Move to Pages is refused', async () => {
    const dismissed = vi.fn();
    render(<PagesPanel document={withLevels()} current={{ kind: 'modal', id: 'modal-swatch' }} onPick={() => {}} actions={{ onChange: () => {}, onDismiss: dismissed }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'More for Demo Level A' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move to Pages' }));
    expect((await screen.findByRole('status')).textContent).toBe('Demo Level A opens Demo Level B, a level, so it stays in Sheets. Move Demo Level B to Pages first.');
    expect(dismissed).not.toHaveBeenCalled();
  });

  it('the first Move to Sheets on a document without levels asks first; a yes moves and closes the sheet, a Cancel does neither', async () => {
    const start: J = sheetOnly();
    const changed = vi.fn(), dismissed = vi.fn();
    const ws = Project.workspace(start as CompositionDocument, undefined, undefined, changed);
    render(<><NavigationHost ws={ws}/><PagesPanel document={start as CompositionDocument} current={{ kind: 'page', id: 'page-orbit' }} onPick={() => {}} actions={{ onChange: changed, onDismiss: dismissed }}/></>);
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    const choose = async () => { fireEvent.click(screen.getByRole('button', { name: 'More for Sample Detail' })); fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move to Sheets' })); return screen.findByRole('alertdialog'); };
    let question = await choose();
    expect(question.textContent).toContain('Move Sample Detail to Sheets?');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(changed).not.toHaveBeenCalled();
    expect(dismissed).not.toHaveBeenCalled();
    question = await choose();
    fireEvent.click(within(question).getByRole('button', { name: 'Move to Sheets' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(changed.mock.calls[0][0].levels.map((level: J) => level.id)).toEqual(['page-echo']);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('says why a move is refused, under the list', async () => {
    const dismissed = vi.fn();
    const document = withLevels();
    render(<PagesPanel document={document} current={{ kind: 'page', id: 'page-orbit' }} onPick={() => {}} actions={{ onChange: () => {}, onDismiss: dismissed }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'More for Sample Detail' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move to Sheets' }));
    expect((await screen.findByRole('status')).textContent).toBe('Sample Detail is opened from Canvas, a page. Only a sheet can open a level. Remove that link first.');
    expect(dismissed).not.toHaveBeenCalled();
    // The line stays until the person's next action.
    fireEvent.pointerDown(screen.getByRole('searchbox'));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {});
  });
});
