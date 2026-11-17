// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { createPage, createSheet, createTab } from '../src/workspace2/navigation/controller';
import { NavigationHost } from '../src/workspace2/navigation/NavigationDialogs';
import { addTab } from '../src/workspace2/navigation/edit';
import { buildOutline } from '../src/workspace2/outline';
import PagesPanel from '../src/workspace2/PagesPanel';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;

/** The few things the dialogs read from the workspace. */
function fakeWorkspace(document: CompositionDocument) {
  const applied: CompositionDocument[] = [];
  const ws = {
    document, surface: { kind: 'page', id: 'page-home' },
    studio: { apply: vi.fn((next: CompositionDocument) => { applied.push(next); }), setError: vi.fn() },
    setSurface: vi.fn(), select: vi.fn(),
  } as unknown as Workspace2;
  return { ws, applied };
}

describe('New Page', () => {
  it('creates the page and its navigation tile in one undo step, switches to it, and outlines it under its parent', async () => {
    const { ws, applied } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    let answer: string | undefined;
    act(() => { void createPage().then(id => { answer = id; }); });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New Page')).toBeTruthy();
    expect((within(dialog).getByLabelText('Link from') as HTMLSelectElement).value).toBe('page:page-home');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garage' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(answer).toBeDefined());
    expect(ws.studio.apply).toHaveBeenCalledTimes(1);
    expect(ws.setSurface).toHaveBeenCalledWith({ kind: 'page', id: answer });
    const next = applied[0];
    expect(next.pages.find(page => page.id === answer)?.title).toBe('Garage');
    expect(next.pages.find(page => page.id === 'page-home')?.components.at(-1)).toMatchObject({ type: 'navigation-tile', action: { type: 'push', pageId: answer } });
    const home = buildOutline(next).groups.flatMap(group => group.rows).find(row => row.surface.id === 'page-home')!;
    expect(home.children.some(row => row.surface.id === answer && row.title === 'Garage')).toBe(true);
  });

  it('links from "Nothing yet", with no tile, and stays on the page when the caller asks', async () => {
    const { ws, applied } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    act(() => { void createPage({ from: 'none', switchTo: false }); });
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Link from') as HTMLSelectElement).value).toBe('none');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Quiet' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(ws.setSurface).not.toHaveBeenCalled();
    expect(applied[0].pages.find(page => page.id === 'page-home')?.components).toHaveLength(base.pages.find(page => page.id === 'page-home')!.components.length);
  });

  it('resolves to nothing when cancelled', async () => {
    const { ws } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    let answer: string | undefined = 'unset';
    act(() => { void createPage().then(id => { answer = id; }); });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(answer).toBeUndefined());
    expect(ws.studio.apply).not.toHaveBeenCalled();
  });

  it('can point the action editor at the page in the same step, with no link field', async () => {
    const { ws, applied } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    act(() => { void createPage({ hideLink: true, switchTo: false, connect: (document, id) => ({ ...document, name: id }) }); });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Link from')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Elsewhere' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0].name).toBe(applied[0].pages.at(-1)!.id);
  });
});

describe('New Tab and New Sheet', () => {
  it('refuses the sixth tab and says why', async () => {
    let full = base;
    for (let at = 0; at < 2; at++) full = addTab(full, { label: `More ${at}`, icon: 'star' }).document;
    expect(full.navigation.tabs).toHaveLength(5);
    const { ws } = fakeWorkspace(full);
    render(<NavigationHost ws={ws}/>);
    act(() => { void createTab(); });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The tab bar holds 5.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    expect(ws.studio.apply).not.toHaveBeenCalled();
  });

  it('adds a tab with a new page while there is room', async () => {
    const { ws, applied } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    act(() => { void createTab(); });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Garden' } });
    expect((within(dialog).getByLabelText('Page') as HTMLSelectElement).value).toBe('new');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0].navigation.tabs.at(-1)).toMatchObject({ label: 'Garden' });
    expect(applied[0].pages.length).toBe(base.pages.length + 1);
  });

  it('adds a sheet and opens it presented', async () => {
    const { ws, applied } = fakeWorkspace(base);
    render(<NavigationHost ws={ws}/>);
    act(() => { void createSheet(); });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Quick Look' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Full' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    const sheet = applied[0].modals.at(-1)!;
    expect(sheet.title).toBe('Quick Look');
    expect(sheet.presentation.height.type).toBe('full');
    expect(ws.setSurface).toHaveBeenCalledWith({ kind: 'modal', id: sheet.id });
  });
});

describe('the Pages overlay', () => {
  it('lists the groups and ends with Page, Sheet and Tab', () => {
    render(<PagesPanel document={base} current={{ kind: 'page', id: 'page-home' }} onPick={vi.fn()}/>);
    const scope = screen.getByRole('group', { name: 'List' });
    expect(within(scope).getAllByRole('button').map(button => button.textContent)).toEqual(['Tabs', 'Pages', 'Sheets', 'Modals']);
    expect(within(scope).getByRole('button', { name: 'Tabs' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: /^(Home|Security|Climate)$/ }).length).toBeGreaterThan(0);
    fireEvent.click(within(scope).getByRole('button', { name: 'Sheets' }));
    expect(within(scope).getByRole('button', { name: 'Sheets' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: /Opened From|Not Linked/ })).toBeTruthy();
    const footer = screen.getByRole('contentinfo', { name: 'Add' });
    expect(within(footer).getAllByRole('button').map(button => button.textContent)).toEqual(['Page', 'Sheet', 'Tab']);
  });

  it('opens the creation dialogs from the footer, closing itself first', async () => {
    const dismiss = vi.fn(), { ws } = fakeWorkspace(base);
    render(<><NavigationHost ws={ws}/><PagesPanel document={base} current={undefined} onPick={vi.fn()} actions={{ onDismiss: dismiss }}/></>);
    fireEvent.click(within(screen.getByRole('contentinfo', { name: 'Add' })).getByRole('button', { name: 'Sheet' }));
    expect(dismiss).toHaveBeenCalled();
    expect(within(await screen.findByRole('dialog')).getByText('New Sheet')).toBeTruthy();
  });
});
