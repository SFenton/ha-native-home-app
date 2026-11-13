// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DndContext, useDndContext } from '@dnd-kit/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ComponentLibrary } from '../src/Sidebar';
import { ActionEditor, ConditionEditor } from '../src/ActionEditor';
import { Dialog } from '../src/ui';
import { DataPanel, VariablesPanel } from '../src/ProjectPanels';
import * as api from '../src/api';
import type { Edit } from '../src/editor';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('mobile editing controls', () => {
  it('configures a registered search source and clears incompatible fields when changing kind', async () => {
    let latest = createSampleDocument();
    latest.variables.foodQuery = '';
    const read = vi.spyOn(api, 'request').mockResolvedValue([{ id: 'recipes-search', name: 'Recipes', kind: 'http', searchable: true }]);
    function Harness() {
      const [document, setDocument] = useState(latest);
      latest = document;
      const apply = (edit: Edit) => setDocument(previous => { const next = structuredClone(previous); edit(next); return validateDocument(next); });
      return <DataPanel document={document} apply={apply} onFetch={vi.fn()} dataModes={{}} dataErrors={{}} liveEnabled={false} onLive={vi.fn()} onNativeImport={vi.fn()}/>;
    }
    render(<Harness/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Source kind' }), { target: { value: 'endpoint' } });
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load registered endpoints' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Available registered endpoints' }), { target: { value: 'recipes-search' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Search query variable' }), { target: { value: 'foodQuery' } });
    expect(latest.dataSources[0]).toMatchObject({ kind: 'endpoint', endpoint: 'recipes-search', queryVariable: 'foodQuery' });
    expect(read).toHaveBeenCalledWith('/api/read-endpoints', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Source kind' }), { target: { value: 'static' } });
    expect(latest.dataSources[0].endpoint).toBeUndefined();
    expect(latest.dataSources[0].queryVariable).toBeUndefined();
  });

  it('shows registration lookup failures without implying that an endpoint is available', async () => {
    const document = createSampleDocument();
    document.dataSources = [{ id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes-search', refreshSeconds: 30, sample: [] }];
    vi.spyOn(api, 'request').mockRejectedValue(new Error('Sign in to list registered endpoints.'));
    render(<DataPanel document={document} apply={vi.fn()} onFetch={vi.fn()} dataModes={{}} dataErrors={{}} liveEnabled={false} onLive={vi.fn()} onNativeImport={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Load registered endpoints' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Sign in');
    expect(screen.queryByRole('combobox', { name: 'Available registered endpoints' })).toBeNull();
  });

  it('protects search-source references and only allows query fetching from an active preview search', () => {
    const document = createSampleDocument();
    document.variables.searchQuery = '';
    document.dataSources = [{ id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'searchQuery', refreshSeconds: 30, sample: [] }];
    document.pages = [{ ...document.pages[0], components: [{ id: 'search-rows', type: 'list', title: 'Recipes', props: {}, binding: { sourceId: 'search' } }], toolbar: [], search: { id: 'search-bar', label: 'Recipes', placeholder: 'Find recipes', mode: 'endpoint', sourceId: 'search' } }];
    document.modals = []; document.liveActivities = []; document.navigation.tabs = [];
    expect(validateDocument(document)).toEqual(document);
    const failures: string[] = [], fetch = vi.fn();
    const apply = (edit: Edit) => { try { edit(structuredClone(document)); } catch (reason) { failures.push(String(reason)); } };
    render(<DataPanel document={document} apply={apply} onFetch={fetch} dataModes={{}} dataErrors={{}} liveEnabled onLive={vi.fn()} onNativeImport={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch preview data' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('spinbutton', { name: 'Poll interval (seconds)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete data source' }));
    expect(failures).toEqual([expect.stringContaining('used by a search bar')]);
    expect(document.dataSources).toHaveLength(1);
  });

  it.each(['filter', 'floating', 'row'] as const)('protects variables referenced by %s interactions', kind => {
    const document = createSampleDocument();
    document.variables.searchQuery = '';
    const page = document.pages[0];
    document.dataSources.push({ id: 'search-rows-source', name: 'Search rows', kind: 'static', sample: [], refreshSeconds: 30 });
    page.components.push({ id: 'search-rows', type: 'list', title: 'Search rows', props: {}, binding: { sourceId: 'search-rows-source' } });
    if (kind === 'filter') page.search = { id: 'search-bar', label: 'Search', placeholder: 'Find rows', mode: 'filter', queryVariable: 'searchQuery', targetComponentIds: ['search-rows'], paths: ['title'] };
    if (kind === 'floating') page.floatingButtons = [{ id: 'clear-search', label: 'Clear search', icon: 'X', action: { type: 'set', variable: 'searchQuery', value: '' } }];
    if (kind === 'row') page.components.at(-1)!.rowActions = { keyPath: 'uid', leading: [], trailing: [{ id: 'clear-search', label: 'Clear search', icon: 'X', action: { type: 'set', variable: 'searchQuery', value: '' } }] };
    expect(validateDocument(document)).toEqual(document);
    const failures: string[] = [];
    const apply = (edit: Edit) => { try { edit(structuredClone(document)); } catch (reason) { failures.push(String(reason)); } };
    render(<VariablesPanel document={document} apply={apply} variables={{}} entities={{}} onVariables={vi.fn()} onEntities={vi.fn()} onReset={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete variable searchQuery' }));
    expect(failures).toEqual([expect.stringContaining('"searchQuery" is in use')]);
    expect(document.variables.searchQuery).toBe('');
  });

  it('provides visible palette Actions with the same tap and nested-insert destinations', () => {
    const add = vi.fn();
    const inside = vi.fn();
    render(<DndContext><ComponentLibrary selection="group" onAdd={add} onAddInside={inside}/></DndContext>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search components' }), { target: { value: 'Text' } });
    const actions = screen.getByRole('button', { name: 'Actions for Text' });
    expect(actions.textContent).toContain('Actions');
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add inside selected group' }));
    expect(inside).toHaveBeenCalledWith('text');
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add after selected component' }));
    expect(add).toHaveBeenCalledWith('text');
    const item = actions.closest('.palette-item')!;
    fireEvent.click(within(item as HTMLElement).getByRole('button', { name: /^Text / }));
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('keeps simultaneous catalogs independent and disables nesting when no group is selected', () => {
    let context: ReturnType<typeof useDndContext> | undefined;
    function Probe() { context = useDndContext(); return null; }
    render(<DndContext><Probe/><section aria-label="Project catalog"><ComponentLibrary onAdd={vi.fn()}/></section><section aria-label="Quick catalog"><ComponentLibrary onAdd={vi.fn()}/></section></DndContext>);
    const project = screen.getByRole('region', { name: 'Project catalog' });
    const quick = screen.getByRole('region', { name: 'Quick catalog' });
    fireEvent.change(within(quick).getByRole('textbox'), { target: { value: 'Text' } });
    expect((within(project).getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(within(project).getByRole('button', { name: 'Drag Heading to canvas' })).toBeTruthy();
    expect(within(quick).queryByRole('button', { name: 'Drag Heading to canvas' })).toBeNull();
    expect([...context!.draggableNodes.values()].filter(node => node?.data.current?.type === 'text')).toHaveLength(2);
    fireEvent.click(within(quick).getByRole('button', { name: 'Actions for Text' }));
    expect((screen.getByRole('menuitem', { name: 'Add inside selected group' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses distinct datalists for simultaneously mounted action and condition forms', () => {
    const document = createSampleDocument();
    render(<><ActionEditor document={document} action={{ type: 'toggle', variable: 'first' }} onChange={vi.fn()}/><ActionEditor document={document} action={{ type: 'toggle', variable: 'second' }} onChange={vi.fn()}/><ConditionEditor document={document} condition={{ source: 'variable', key: 'first', operator: 'truthy' }} onChange={vi.fn()}/><ConditionEditor document={document} condition={{ source: 'variable', key: 'second', operator: 'truthy' }} onChange={vi.fn()}/></>);
    const lists = [...globalThis.document.querySelectorAll<HTMLInputElement>('input[list]')].map(input => input.getAttribute('list')!);
    expect(new Set(lists).size).toBe(4);
    for (const id of lists) expect(globalThis.document.getElementById(id)?.tagName).toBe('DATALIST');
  });

  it('restores dialog focus to a visible editor control when the invoker becomes inert', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [hidden, setHidden] = useState(false);
      return <><button data-editor-focus-fallback="">Preview</button><div hidden={hidden} inert={hidden}><button onClick={() => setOpen(true)}>Open form</button></div>{open && <Dialog title="Edit values" onClose={() => setOpen(false)}><input aria-label="Draft value"/><button onClick={() => setHidden(true)}>Simulate pane resize</button></Dialog>}</>;
    }
    render(<Harness/>);
    act(() => screen.getByRole('button', { name: 'Open form' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Open form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulate pane resize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }));
  });

  it('does not close a dialog when clicking its own padding and stops Escape propagation', () => {
    const close = vi.fn();
    render(<Dialog title="Edit values" onClose={close}><input aria-label="Value"/></Dialog>);
    const dialog = screen.getByRole('dialog');
    dialog.getBoundingClientRect = () => ({ top: 10, left: 10, bottom: 200, right: 200, x: 10, y: 10, width: 190, height: 190, toJSON: () => ({}) });
    fireEvent.click(dialog, { clientX: 15, clientY: 15 });
    expect(close).not.toHaveBeenCalled();
    const escape = vi.fn();
    window.addEventListener('keydown', escape);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Value' }), { key: 'Escape' });
    window.removeEventListener('keydown', escape);
    expect(escape).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 5, clientY: 5 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('starts a dialog at its heading and synchronizes a native close with its owner', () => {
    const close = vi.fn();
    render(<Dialog title="Edit values" onClose={close}><input aria-label="Value"/></Dialog>);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Edit values' }));
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    dialog.close();
    fireEvent(dialog, new Event('close'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('ignores a queued cleanup close after Strict Mode has reopened the dialog', async () => {
    const close = vi.fn();
    const nativeClose = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.removeAttribute('open');
      queueMicrotask(() => this.dispatchEvent(new Event('close')));
    });
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open form</button>{open && <Dialog title="Edit values" onClose={() => { close(); setOpen(false); }}><input aria-label="Draft value"/></Dialog>}</>;
    }
    try {
      render(<StrictMode><Harness/></StrictMode>);
      const invoker = screen.getByRole('button', { name: 'Open form' });
      invoker.focus();
      await act(async () => { fireEvent.click(invoker); });
      expect(close).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      expect(screen.getByRole('textbox', { name: 'Draft value' })).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Edit values' }));
      await act(async () => { dialog.close(); });
      expect(close).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(invoker);
    } finally {
      nativeClose.mockRestore();
    }
  });
});
