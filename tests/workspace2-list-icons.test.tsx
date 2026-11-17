// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { sameJson } from '../src/sameJson';
import LibraryPanel from '../src/workspace2/LibraryPanel';
import { createListIcons, listIcons } from '../src/workspace2/listIcons';
import { useLibrary } from '../src/workspace2/useLibrary';
import { useLibraryTrail } from '../src/workspace2/useLibraryTrail';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { ToastHost } from '../src/workspace2/toasts';
import { Project } from './support/workspace2-surfaces';
import { copyOf, voiceIssues } from './support/copy';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({ listIcons: {} })) }));
const home = homeDomains.document as unknown as CompositionDocument;
afterEach(cleanup);
beforeEach(() => { for (const key of Object.keys(listIcons.snapshot())) listIcons.clear(key as SelectionKey); });

function Harness({ ws, mode = 'edit' }: { ws: Workspace2; mode?: 'edit' | 'use' }) {
  const stored = useLibrary('docked', 1440), trailApi = useLibraryTrail();
  const [category, setCategory] = useState<'tabs' | 'pages'>('tabs');
  const live = useMemo(() => ({ ...ws, mode }) as Workspace2, [ws, mode]);
  return <ToastHost><LibraryPanel ws={live} document={home} tier="docked" category={category} open shown library={{ ...stored, category, open: true }} trailApi={trailApi} onCategory={setCategory as never} onKeepPanel={() => {}} onError={() => {}} onClose={() => {}}/></ToastHost>;
}
const rows = () => screen.getAllByRole('treeitem');
const row = (name: string) => rows().find(item => item.querySelector('.w2-tree-title')?.textContent === name)!;
const tab = home.navigation.tabs[0];
const tabKey = `tab:${tab.id}` as SelectionKey;

describe('the store', () => {
  it('sets, clears, prunes and saves the whole newest map, one save at a time', async () => {
    const written: Record<string, string>[] = [];
    const store = createListIcons({ read: async () => ({ 'node:old': 'house' }), write: async icons => { written.push({ ...icons }); } });
    await store.load();
    expect(store.get('node:old' as SelectionKey)).toBe('house');
    store.set('node:a' as SelectionKey, 'bed.double');
    store.set('node:a' as SelectionKey, 'bed.double');
    store.clear('node:old' as SelectionKey);
    await store.settled();
    // Each save writes the newest map, so a slow save never lands over a newer choice.
    expect(written.at(-1)).toEqual({ 'node:a': 'bed.double' });
    expect(written.length).toBeGreaterThan(0);
    store.prune(buildDocumentIndex(home));
    expect(store.snapshot()).toEqual({});
  });

  it('keeps a choice made before the file was read, and keeps a choice whose save failed, with a toast', async () => {
    const failed = vi.fn();
    const store = createListIcons({ read: async () => ({ 'node:a': 'house' }), write: async () => { throw new Error('offline'); }, onFailure: failed });
    store.set('node:a' as SelectionKey, 'sun.max');
    await store.load();
    expect(store.get('node:a' as SelectionKey)).toBe('sun.max');
    await store.settled();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(store.get('node:a' as SelectionKey)).toBe('sun.max');
  });
});

describe('Change List Icon… on a library row', () => {
  it('lists the command above Delete-less Tab rows, opens the popover, and a choice applies at once without touching the document', async () => {
    const before = structuredClone(home);
    const ws = Project.workspace(home);
    render(<Harness ws={ws}/>);
    fireEvent.click(within(row(tab.label)).getByRole('button', { name: `More for ${tab.label}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change List Icon…' }));
    const popover = await screen.findByTestId('list-icon-popover');
    expect(within(popover).getByText('List Icon')).toBeTruthy();
    expect(within(popover).getByRole('searchbox', { name: 'Find an icon' })).toBeTruthy();
    expect(popover.textContent).toContain('Only the Studio shows this icon. The app does not change.');
    expect((within(popover).getByRole('button', { name: 'Use Default' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(popover).getAllByRole('button').find(button => button.hasAttribute('data-symbol'))!);
    await waitFor(() => expect(screen.queryByTestId('list-icon-popover')).toBeNull());
    expect(listIcons.get(tabKey)).toBeTruthy();
    // The row carries the dot of a chosen icon; the document is as it was and the draft was never edited.
    expect(row(tab.label).querySelector('.w2-tree-icon')?.hasAttribute('data-chosen')).toBe(true);
    expect(sameJson(home, before)).toBe(true);
    expect(ws.studio.apply).not.toHaveBeenCalled();
  });

  it('shows the chosen icon before the thing\'s own, with the dot only on a chosen one, and Use Default takes it back', async () => {
    render(<Harness ws={Project.workspace(home)}/>);
    const plain = row(tab.label).querySelector('.w2-tree-icon')!;
    expect(plain.hasAttribute('data-chosen')).toBe(false);
    const own = plain.innerHTML;
    act(() => listIcons.set(tabKey, 'sun.max'));
    await waitFor(() => expect(row(tab.label).querySelector('.w2-tree-icon')?.hasAttribute('data-chosen')).toBe(true));
    expect(row(tab.label).querySelector('.w2-tree-icon')!.innerHTML).not.toBe(own);
    fireEvent.click(within(row(tab.label)).getByRole('button', { name: `More for ${tab.label}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change List Icon…' }));
    const popover = await screen.findByTestId('list-icon-popover');
    fireEvent.click(within(popover).getByRole('button', { name: 'Use Default' }));
    await waitFor(() => expect(listIcons.get(tabKey)).toBeUndefined());
    expect(row(tab.label).querySelector('.w2-tree-icon')?.hasAttribute('data-chosen')).toBe(false);
    expect(row(tab.label).querySelector('.w2-tree-icon')!.innerHTML).toBe(own);
  });

  it('works in Use, where More holds only this command', async () => {
    render(<Harness ws={Project.workspace(home)} mode="use"/>);
    fireEvent.click(within(row(tab.label)).getByRole('button', { name: `More for ${tab.label}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change List Icon…' }));
    expect(await screen.findByTestId('list-icon-popover')).toBeTruthy();
  });

  it('gives each cell a name and writes its words to a snapshot held to the voice rules', async () => {
    render(<Harness ws={Project.workspace(home)}/>);
    fireEvent.click(within(row(tab.label)).getByRole('button', { name: `More for ${tab.label}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change List Icon…' }));
    const popover = await screen.findByTestId('list-icon-popover');
    for (const cell of popover.querySelectorAll('[data-symbol]')) expect(cell.getAttribute('aria-label')).toBeTruthy();
    // The icon cells are names of pictures; the words around them are the copy.
    const words = popover.cloneNode(true) as HTMLElement;
    words.querySelectorAll('[data-symbol]').forEach(cell => cell.remove());
    await expect(copyOf(words)).toMatchFileSnapshot('./snapshots/copy/list-icon.txt');
    expect(voiceIssues(words)).toEqual([]);
  });
});
