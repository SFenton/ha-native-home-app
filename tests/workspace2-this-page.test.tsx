// @vitest-environment jsdom
import { useMemo, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import AddHost from '../src/workspace2/add/AddHost';
import { ToastHost } from '../src/workspace2/toasts';
import DragLayer from '../src/workspace2/dnd/DragLayer';
import LevelSheet from '../src/workspace2/phone/LevelSheet';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { Project } from './support/workspace2-surfaces';
import { replaceAt } from '../src/composition-editor';
import { offeredTypes } from '../src/workspace2/add/AddPicker';
import { endOf } from '../src/workspace2/add/insert';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

const home = homeDomains.document as unknown as CompositionDocument;
const root = `page:${home.navigation.initialPageId}`;

/** How many tile types a container takes. */
const offeredFor = (document: CompositionDocument, owner: SelectionKey) => offeredTypes(document, endOf(document, owner)!, []).length;

/** What the harness saw: the document now, how often it was changed (one change is one undo step), the selection, and whether the sheet is open. */
interface Seen { document: CompositionDocument; applied: CompositionDocument[]; selection?: SelectionKey; selected: (SelectionKey | undefined)[]; open: boolean; ws: Workspace2 }

/** A workspace that keeps its document and selection, around the real This Page sheet, the add host and the drag layer. */
function Harness({ seen, selection: first, surface, initial = home }: { seen: { current?: Seen }; selection?: SelectionKey; surface?: { kind: 'page' | 'modal'; id: string }; initial?: CompositionDocument }) {
  const [document, setDocument] = useState(initial);
  const [selection, setSelection] = useState<SelectionKey | undefined>(first);
  const [open, setOpen] = useState(true);
  const applied = useRef<CompositionDocument[]>([]), selected = useRef<(SelectionKey | undefined)[]>([]);
  const apply = useMemo(() => (next: CompositionDocument) => { applied.current.push(next); setDocument(next); }, []);
  const select = useMemo(() => (key: SelectionKey | undefined) => { selected.current.push(key); setSelection(key); }, []);
  const ws = useMemo(() => Project.workspace(document, undefined, {
    extra: { index: buildDocumentIndex(document), selection, select, mode: 'edit', surface: surface ?? { kind: 'page', id: home.navigation.initialPageId }, studio: { apply, revert: () => false } },
  }, apply), [document, selection, select, apply, surface]);
  seen.current = { document, applied: applied.current, selection, selected: selected.current, open, ws };
  return <ToastHost><AddHost ws={ws} narrow stage={null} onError={() => {}}><DragLayer ws={ws} stage={null} narrow onError={() => {}}>
    <LevelSheet ws={ws} open={open} onOpenChange={setOpen} onError={() => {}}/>
  </DragLayer></AddHost></ToastHost>;
}

const start = async (selection?: SelectionKey, initial?: CompositionDocument) => {
  const seen: { current?: Seen } = {};
  render(<Harness seen={seen} selection={selection} initial={initial}/>);
  await screen.findByTestId('level-sheet');
  return seen as { current: Seen };
};
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const path = () => within(screen.getByRole('navigation', { name: 'Path' }));
const rowNames = () => within(screen.getByTestId('level-list')).queryAllByRole('listitem').map(item => item.querySelector('.w2-level-title')?.textContent);
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
/** Goes down to the tile grid under "Guests Staying Over": four levels from the page. */
const toGrid = async () => { await press(/^Conditional content/); await press(/^Guests Staying Over/); await press(/^Guests /); };

describe('This Page, one level at a time: the header', () => {
  it('at the root: the title is "This Page", the subtitle the page\'s name, and there is no Back', async () => {
    await start();
    expect(heading()).toBe('This Page');
    expect(path().getByText('Home')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
    expect(rowNames()).toEqual(['Status', 'Weather', 'Conditional content', 'Cameras']);
  });

  it('one level down: the title is the level, the subtitle where it sits, and Back names the parent', async () => {
    await start();
    await press(/^Conditional content/);
    expect(heading()).toBe('Conditional content');
    expect(path().getAllByRole('button').map(button => button.textContent)).toEqual(['Home']);
    expect(rowNames()).toEqual(['Guests Staying Over']);
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeTruthy();
  });

  it('three levels down: the whole path above it, as buttons, and the level\'s own name is not in it', async () => {
    await start();
    await toGrid();
    expect(heading()).toBe('Guests');
    expect(path().getAllByRole('button').map(button => button.textContent)).toEqual(['Home', 'Conditional content', 'Guests Staying Over']);
    expect(screen.getByRole('navigation', { name: 'Path' }).textContent).toBe('Home›Conditional content›Guests Staying Over');
    expect(screen.getByRole('button', { name: 'Back to Guests Staying Over' })).toBeTruthy();
    expect(rowNames()).toEqual(['Demo Guests 1', 'Demo Guests 2']);
  });

  it('Back goes up one level and a crumb jumps to its level', async () => {
    await start();
    await toGrid();
    await press('Back to Guests Staying Over');
    expect(heading()).toBe('Guests Staying Over');
    await press(/^Guests /);
    await act(async () => { fireEvent.click(path().getByRole('button', { name: 'Conditional content' })); });
    expect(heading()).toBe('Conditional content');
    await toGridFromHere();
    await act(async () => { fireEvent.click(path().getByRole('button', { name: 'Home' })); });
    expect(heading()).toBe('This Page');
    expect(rowNames()).toHaveLength(4);
  });
  const toGridFromHere = async () => { await press(/^Guests Staying Over/); await press(/^Guests /); };
});

describe('This Page: the rows', () => {
  it('a container row goes in and a leaf row selects, closes the sheet and leaves the properties to the caller', async () => {
    const seen = await start();
    await toGrid();
    await press(/^Demo Guests 1/);
    expect(seen.current.selection).toBe('node:hc-home-guest-0');
    expect(seen.current.open).toBe(false);
    expect(screen.queryByTestId('level-sheet')).toBeNull();
  });

  it('going into a container selects it and the sheet stays open on its level (the owner\'s G9 change)', async () => {
    const seen = await start();
    await press(/^Conditional content/);
    expect(seen.current.selection).toBe('node:hc-home-guests-visible');
    expect(seen.current.open).toBe(true);
    expect(heading()).toBe('Conditional content');
    await press(/^Guests Staying Over/);
    expect(seen.current.selection).toBe('node:hc-home-guests');
    expect(seen.current.open).toBe(true);
    expect(seen.current.selected).toEqual(['node:hc-home-guests-visible', 'node:hc-home-guests']);
  });

  it('Back and a crumb step out a level and leave the sheet open', async () => {
    const seen = await start();
    await press(/^Conditional content/);
    await press(/^Guests Staying Over/);
    await press(/^Back to/);
    expect(heading()).toBe('Conditional content');
    await press('Home');
    expect(heading()).toBe('This Page');
    expect(seen.current.open).toBe(true);
  });

  it('opens at the selected node\'s level with that row marked, and the marked row is aria-current', async () => {
    await start('node:hc-home-guest-1');
    expect(heading()).toBe('Guests');
    const current = screen.getByRole('button', { name: /^Demo Guests 2/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: /^Demo Guests 1/ }).getAttribute('aria-current')).toBeNull();
    expect(current.closest('li')!.hasAttribute('data-current')).toBe(true);
  });

  it('Done ends the selection with the sheet', async () => {
    const seen = await start('node:hc-home-guest-1');
    await press('Done');
    expect(seen.current.open).toBe(false);
    expect(seen.current.selection).toBeUndefined();
  });

  it('an empty level says so and still has its footer', async () => {
    const seen = await start();
    await toGrid();
    for (const name of ['Demo Guests 1', 'Demo Guests 2']) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: `More for ${name}` })); });
      await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' })); });
    }
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Here' })).toBeTruthy();
    expect(seen.current.applied).toHaveLength(2);
  });

  it('the level goes up to the nearest one that is left when it is deleted from under the sheet', async () => {
    const seen = await start();
    await toGrid();
    const without = structuredClone(home) as CompositionDocument;
    (without.pages[0].components[2] as unknown as { children: unknown[] }).children = [];
    await act(async () => { seen.current.ws.studio.apply(without); });
    await waitFor(() => expect(heading()).toBe('Conditional content'));
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
  });
});

describe('This Page: the footer', () => {
  it('Add Here opens the Add picker for this level, and the picker offers only what this container can hold', async () => {
    // A section laid out as a list of settings rows takes rows and controls, not tiles.
    const rows = replaceAt(home, ['pages', 0, 'components', 3, 'props', 'style'], 'module-list') as CompositionDocument;
    await start(undefined, rows);
    await press(/^Cameras/);
    await press('Add Here');
    const picker = await screen.findByTestId('add-picker');
    expect(within(picker).getByRole('heading', { name: 'Add to Cameras' })).toBeTruthy();
    const offered = [...picker.querySelectorAll('[data-type]')].map(item => item.getAttribute('data-type'));
    expect(offered.length).toBeGreaterThan(0);
    const holds = offeredTypes(rows, endOf(rows, 'node:hc-home-cameras')!, []).map(type => type.key);
    // "Tile" is the picker's one entry for the tile kinds this container takes; everything else is a type it holds.
    expect(offered.filter(type => type !== 'tile').every(type => (holds as string[]).includes(type!))).toBe(true);
    expect(offered).not.toContain('tile-grid');
    expect(offered).not.toContain('section');
    expect(holds).not.toContain('action-tile');
    // The sheet gave way to the picker, so the selection it clears does not strand it open.
    expect(screen.queryByTestId('level-sheet')).toBeNull();
  });

  it('Add Here is dimmed where a container has nothing it can take', async () => {
    await start();
    await press(/^Status/);
    const button = screen.getByRole('button', { name: 'Add Here' }) as HTMLButtonElement;
    // Dimmed exactly when the picker would have nothing to offer here.
    expect(button.disabled).toBe(offeredFor(home, 'node:hc-status-rail') === 0);
    await press('Back to Home');
    expect((screen.getByRole('button', { name: 'Add Here' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add Here at a grid offers tiles, and the settings button selects the container itself', async () => {
    const seen = await start();
    await toGrid();
    await press('Add Here');
    const picker = await screen.findByTestId('add-picker');
    expect(within(picker).getByRole('heading', { name: 'Add to Guests' })).toBeTruthy();
    cleanup();
    const again = await start();
    await press(/^Conditional content/);
    await press(/^Guests Staying Over/);
    await press('Section Settings');
    expect(again.current.selection).toBe('node:hc-home-guests');
    expect(again.current.open).toBe(false);
    void seen;
  });

  it('the root offers Page Settings and selects the page', async () => {
    const seen = await start();
    await press('Page Settings');
    expect(seen.current.selection).toBe(root);
  });

  it('a level that is a type of container names its settings for the type: "Tile Grid Settings"', async () => {
    await start();
    await toGrid();
    expect(screen.getByRole('button', { name: 'Tile Grid Settings' })).toBeTruthy();
  });
});

describe('This Page: move and reorder', () => {
  it('Move To… pushes the Move To page inside the sheet, moves the node, and the list follows', async () => {
    const seen = await start();
    await toGrid();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'More for Demo Guests 1' })); });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Move To…' })); });
    const group = await screen.findByRole('region', { name: 'Home · Page' });
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: /The page itself/ })); });
    await waitFor(() => expect(rowNames()).toEqual(['Demo Guests 2']));
    expect(seen.current.applied).toHaveLength(1);
    const moved = buildDocumentIndex(seen.current.document).get('node:hc-home-guest-0')!;
    expect(moved.parent).toBe(root);
  });

  it('a keyboard move on the grip moves one place within the level and is one undo step', async () => {
    const seen = await start();
    await toGrid();
    const grip = screen.getByRole('button', { name: 'Move Demo Guests 1' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ' });
    await act(async () => { fireEvent.keyDown(grip, { key: 'ArrowDown' }); });
    await act(async () => { fireEvent.keyDown(grip, { key: ' ' }); });
    await waitFor(() => expect(rowNames()).toEqual(['Demo Guests 2', 'Demo Guests 1']));
    expect(seen.current.applied).toHaveLength(1);
    // The node stays selected, so its row is the marked one, and the sheet is still open.
    expect(seen.current.selection).toBe('node:hc-home-guest-0');
    expect(seen.current.open).toBe(true);
  });

  it('Escape puts a keyboard move down where it was, with nothing changed', async () => {
    const seen = await start();
    await toGrid();
    const grip = screen.getByRole('button', { name: 'Move Demo Guests 1' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ' });
    await act(async () => { fireEvent.keyDown(grip, { key: 'ArrowDown' }); });
    await act(async () => { fireEvent.keyDown(grip, { key: 'Escape' }); });
    expect(rowNames()).toEqual(['Demo Guests 1', 'Demo Guests 2']);
    expect(seen.current.applied).toHaveLength(0);
  });

  it('the arrows stay inside the level: a node at the end has nowhere further to go', async () => {
    const seen = await start();
    await toGrid();
    const grip = screen.getByRole('button', { name: 'Move Demo Guests 2' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ' });
    await act(async () => { fireEvent.keyDown(grip, { key: 'ArrowDown' }); fireEvent.keyDown(grip, { key: 'ArrowDown' }); });
    await act(async () => { fireEvent.keyDown(grip, { key: ' ' }); });
    expect(seen.current.applied).toHaveLength(0);
    expect(rowNames()).toEqual(['Demo Guests 1', 'Demo Guests 2']);
  });
});

describe('This Page: accessibility', () => {
  it('names every control and marks the path as a navigation', async () => {
    await start();
    await toGrid();
    expect(screen.getByRole('navigation', { name: 'Path' })).toBeTruthy();
    for (const name of ['Back to Guests Staying Over', 'Done', 'Add Here', 'Tile Grid Settings', 'More for Demo Guests 1', 'Move Demo Guests 1']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'This Page' })).toBeTruthy();
  });
});
