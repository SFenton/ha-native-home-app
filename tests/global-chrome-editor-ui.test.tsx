// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdvancedFold } from '../src/workspace2/AdvancedFold';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compilerIssues } from '../src/workspace2/checks';
import { PushStack } from '../src/workspace2/kit';
import { HeaderPanel } from '../src/workspace2/navigation/HeaderPanel';
import SurfaceSettings from '../src/workspace2/navigation/PageSettings';
import { RowsProvider } from '../src/workspace2/rows';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';

afterEach(cleanup);
beforeEach(resetAdvancedFold);

// MARK: - Fixture

/** The first-slice document with Quick Links and Profile alone in the one trailing group; buttons `chrome-inspect` (first page only) and `chrome-palette`. */
function fixture(): CompositionDocument {
  const document = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  const groups = document.navigation.chrome.groups;
  groups[0].items.push(...groups[1].items);
  groups[1].items = [{
    id: 'demo_quick', type: 'shell-header', visibility: 'always',
    quickLinksAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }, profileAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' },
  }];
  return document;
}

/** Renders the settings of one surface against a document the test can read back. */
function Surface({ kind, id, seen, initial }: { kind: 'page' | 'modal'; id: string; seen: (document: CompositionDocument) => void; initial: CompositionDocument }) {
  const [document, setDocument] = useState(initial);
  const at = (kind === 'page' ? document.pages : document.modals).findIndex(item => item.id === id);
  const ws = { studio: { setError: vi.fn() } } as unknown as Workspace2;
  return <RowsProvider value={{ document, onChange: next => { seen(next); setDocument(next); }, onError: vi.fn() }}>
    <PushStack rootTitle="Settings" root={<SurfaceSettings ws={ws} kind={kind} path={[kind === 'page' ? 'pages' : 'modals', at]} onGo={vi.fn()}/>}/>
  </RowsProvider>;
}

function Panel({ seen, initial, onGo = vi.fn() }: { seen: (document: CompositionDocument) => void; initial: CompositionDocument; onGo?: (key: `page:${string}`) => void }) {
  const [document, setDocument] = useState(initial);
  return <RowsProvider value={{ document, onChange: next => { seen(next); setDocument(next); }, onError: vi.fn() }}>
    <PushStack rootTitle="Tabs and header buttons" root={<HeaderPanel onGo={onGo}/>}/>
  </RowsProvider>;
}

const group = () => screen.queryByRole('region', { name: 'Hide on this page' });

// MARK: - Hide on this page

describe('Hide on this page', () => {
  it('Same as app: a switch for Tabs, each header button and Quick Links and Profile, under Header buttons, with its footer', () => {
    render(<Surface kind="page" id="page-echo" seen={() => {}} initial={fixture()}/>);
    const box = within(group()!);
    expect(box.getAllByRole('switch').map(item => item.closest('label')?.textContent)).toEqual(['Tabs', 'Quick Links and Profile', 'Inspect (button)', 'Palette (button)']);
    expect(box.getByText('Hidden on this page only. Other pages follow the app.')).toBeTruthy();
    expect(box.getByText('Needs a newer app. Publishing it waits for an app update.')).toBeTruthy();
    const header = screen.getByRole('group', { name: 'Header buttons' });
    expect(header.compareDocumentPosition(group()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('writes hides when a switch is turned on, and removes the key when it is turned off', () => {
    let last = fixture();
    render(<Surface kind="page" id="page-echo" seen={next => { last = next; }} initial={fixture()}/>);
    fireEvent.click(within(group()!).getByRole('switch', { name: 'Tabs' }));
    fireEvent.click(within(group()!).getByRole('switch', { name: 'Quick Links and Profile' }));
    expect(last.pages[2].hides).toEqual({ tabs: true, items: ['demo_quick'] });
    expect(compilerIssues(last)).toEqual([]);
    fireEvent.click(within(group()!).getByRole('switch', { name: 'Tabs' }));
    fireEvent.click(within(group()!).getByRole('switch', { name: 'Quick Links and Profile' }));
    expect('hides' in last.pages[2]).toBe(false);
  });

  it('a row the app shows on First page only is off, disabled and captioned', () => {
    render(<Surface kind="page" id="page-echo" seen={() => {}} initial={fixture()}/>);
    const row = within(group()!).getByRole('switch', { name: 'Inspect (button)' }) as HTMLInputElement;
    expect(row.checked).toBe(false);
    expect(row.disabled).toBe(true);
    const caption = within(group()!).getByText('First page only');
    expect(caption.id).not.toBe('');
    expect(row.getAttribute('aria-describedby')).toBe(caption.id);
    expect(row.hasAttribute('aria-describedby') && (within(group()!).getByRole('switch', { name: 'Palette (button)' }) as HTMLInputElement).hasAttribute('aria-describedby')).toBe(false);
    expect((within(group()!).getByRole('switch', { name: 'Palette (button)' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('with Custom only the Tabs switch remains, and the hidden items go', () => {
    let last = fixture();
    const initial = fixture();
    initial.pages[2] = { ...initial.pages[2], hides: { tabs: true, items: ['chrome-palette'] } };
    render(<Surface kind="page" id="page-echo" seen={next => { last = next; }} initial={initial}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(within(group()!).getAllByRole('switch').map(item => item.closest('label')?.textContent)).toEqual(['Tabs']);
    expect(last.pages[2].hides).toEqual({ tabs: true });
    expect(compilerIssues(last)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Same as app' }));
    expect(within(group()!).getAllByRole('switch')).toHaveLength(4);
  });

  it('a sheet has no such group', () => {
    render(<Surface kind="modal" id="modal-swatch" seen={() => {}} initial={fixture()}/>);
    expect(group()).toBeNull();
    expect(screen.queryByText('Hide on this page')).toBeNull();
    expect(screen.queryByText('In a wide window')).toBeNull();
  });
});

// MARK: - In a wide window

describe('In a wide window', () => {
  it('Opens: Automatic, Full width, Beside, in the group with Open pages beside this one, with each footer', () => {
    let last = fixture();
    render(<Surface kind="page" id="page-echo" seen={next => { last = next; }} initial={fixture()}/>);
    const box = within(screen.getByRole('region', { name: 'In a wide window' }));
    expect(box.getByRole('switch', { name: 'Open pages beside this one' })).toBeTruthy();
    const opens = box.getByRole('group', { name: 'Opens' });
    expect(within(opens).getAllByRole('button').map(item => item.textContent)).toEqual(['Automatic', 'Full width', 'Beside']);
    expect(within(opens).getByRole('button', { name: 'Automatic' }).getAttribute('aria-pressed')).toBe('true');
    expect(box.getByText(/^Beside the page it came from when that page opens pages beside it/)).toBeTruthy();
    fireEvent.click(within(opens).getByRole('button', { name: 'Full width' }));
    expect(box.getByText('Always the whole window. Back returns to the page it came from.')).toBeTruthy();
    expect(last.pages[2].wideOpen).toBe('full');
    fireEvent.click(within(opens).getByRole('button', { name: 'Beside' }));
    expect(box.getByText('Always beside the page it came from. That page takes the left half.')).toBeTruthy();
    expect(last.pages[2].wideOpen).toBe('beside');
    expect(compilerIssues(last)).toEqual([]);
    expect(box.getByText('Needs a newer app. Publishing it waits for an app update.')).toBeTruthy();
  });

  it('a page that said "Start a new column set here" reads Full width, and the row is gone', () => {
    const initial = fixture();
    initial.pages[2] = { ...initial.pages[2], navigation: { type: 'navigation-columns', placeholder: 'Pick one', standalone: true } };
    render(<Surface kind="page" id="page-echo" seen={() => {}} initial={initial}/>);
    expect(within(screen.getByRole('group', { name: 'Opens' })).getByRole('button', { name: 'Full width' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('Start with one pane')).toBeTruthy();
    expect(screen.queryByText('Start a new column set here')).toBeNull();
  });
});

// MARK: - The app panel

describe('Tabs and header buttons', () => {
  it('Show on pages: Every page or First page only for Tabs, each button and Quick Links and Profile; footer and result line', () => {
    render(<Panel seen={() => {}} initial={fixture()}/>);
    const box = within(screen.getByRole('region', { name: 'Show on pages' }));
    for (const name of ['Tabs', 'Quick Links and Profile', 'Inspect (button)', 'Palette (button)']) expect(box.getByText(name)).toBeTruthy();
    expect(box.getByText('Every page: a page shows this however it is opened, at any depth. Sheets and modals never show it. A page can hide it for itself.')).toBeTruthy();
    expect(document.querySelector('[data-result-line]')?.textContent).toBe('3 shown on every page · 1 on the first page only');
    expect(screen.queryByRole('button', { name: /^Hidden on/ })).toBeNull();
  });

  it('writes Tabs on the first page only, and removes the field for Every page', () => {
    let last = fixture();
    render(<Panel seen={next => { last = next; }} initial={fixture()}/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tabs' }), { target: { value: 'first' } });
    expect(last.navigation.tabsVisibility).toBe('root-only');
    fireEvent.change(screen.getByRole('combobox', { name: 'Tabs' }), { target: { value: 'every' } });
    expect('tabsVisibility' in last.navigation).toBe(false);
  });

  it('writes a button\'s Show, and Quick Links and Profile\'s', () => {
    let last = fixture();
    render(<Panel seen={next => { last = next; }} initial={fixture()}/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Quick Links and Profile' }), { target: { value: 'first' } });
    expect(last.navigation.chrome.groups[1].items[0]).toMatchObject({ id: 'demo_quick', visibility: 'root-only' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Inspect (button)' }), { target: { value: 'every' } });
    expect(last.navigation.chrome.groups[0].items.find(item => item.id === 'chrome-inspect')).toMatchObject({ visibility: 'always' });
    expect(compilerIssues(last)).toEqual([]);
  });

  it('the count of pages that hide opens the list, and a row goes to its page', () => {
    const initial = fixture();
    initial.pages[0] = { ...initial.pages[0], hides: { tabs: true, items: ['demo_quick'] } };
    initial.pages[1] = { ...initial.pages[1], hides: { tabs: true } };
    const onGo = vi.fn();
    render(<Panel seen={() => {}} initial={initial} onGo={onGo}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Hidden on 2 pages' }));
    const list = screen.getByRole('list', { name: 'Hidden on 2 pages' });
    expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['CanvasHides 2', 'ShelfHides 1']);
    fireEvent.click(within(list).getByRole('button', { name: /Shelf/ }));
    expect(onGo).toHaveBeenCalledWith('page:page-lattice');
  });
});
