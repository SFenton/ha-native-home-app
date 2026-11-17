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
import { documentWithTabs } from './support/layout-fixture';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

const home = documentWithTabs();
const root = `page:${home.navigation.initialPageId}`;


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

const start = async (selection?: SelectionKey) => {
  const seen: { current?: Seen } = {};
  render(<Harness seen={seen} selection={selection}/>);
  await screen.findByTestId('level-sheet');
  return seen as { current: Seen };
};
const rowNames = () => within(screen.getByTestId('level-list')).queryAllByRole('listitem').map(item => item.querySelector('.w2-level-title')?.textContent);
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const blocksOf = (document: CompositionDocument) => (buildDocumentIndex(document).get('node:area-tabs' as SelectionKey)!.node as unknown as { blocks: { id: string; tabs: unknown }[] }).blocks;

describe('the phone sheet lists the areas of a tab container', () => {
  it('names them in draw order, with the two add buttons and the container settings in the footer', async () => {
    await start('node:area-tabs' as SelectionKey);
    await press(/^Area tabs/);
        expect(rowNames()).toEqual(['Shared', 'Lights', 'Rooms', 'Info']);
    expect(screen.getByRole('button', { name: 'Shared Area' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tab Area' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Here' })).toBeNull();
  });

  it('Shared Area adds an empty shared area at the end in one undo step', async () => {
    const seen = await start('node:area-tabs' as SelectionKey);
    await press(/^Area tabs/);
        const before = seen.current.applied.length;
    await press('Shared Area');
    expect(seen.current.applied.length).toBe(before + 1);
    expect(blocksOf(seen.current.document).at(-1)!.tabs).toBe('all');
  });

  it('inside an area the footer is Add Here and Area Settings', async () => {
    await start('node:area-tabs' as SelectionKey);
    await press(/^Area tabs/);
        await act(async () => { fireEvent.click(within(screen.getByTestId('level-list')).getAllByRole('button')[0]); });
    expect(screen.getByRole('button', { name: 'Add Here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Area Settings' })).toBeTruthy();
    expect(rowNames()).toEqual(['Shared across every tab']);
  });
});
