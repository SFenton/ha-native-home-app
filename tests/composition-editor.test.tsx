// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../src/api';
import {
  changeFieldVariant, componentLocations, compositionEditorSchema, compositionErrors, compositionSourceText, defaultField, fieldVariants,
  importCompositionText, moveCompositionNode, removeCompositionItem, reorderCompositionItem,
} from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES } from '../src/shared/composition/json';
import { createCompositionDocument, createCompositionPage, type CompositionDraft, type UploadedCompositionAsset } from '../src/shared/composition/workspace';
import NativeCompositionWorkspace from '../src/NativeCompositionWorkspace';
import { useCompositionStudio } from '../src/useCompositionStudio';
import type { CompositionNode } from '../src/shared/composition/schema';

vi.mock('../src/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/api')>(), request: vi.fn(),
}));
function envelope(): CompositionDraft {
  const document = createCompositionDocument('synthetic-document');
  return {
    envelopeVersion: '2.0', publisherId: 'synthetic-publisher', revision: 1, updatedAt: '2026-11-13T10:00:00Z',
    document, capabilities: compileCompositionDocument(document).capabilities, assetManifestSha256: 'a'.repeat(64),
  };
}
const text = (id: string): CompositionNode => ({
  id, title: id, type: 'text', layout: { span: 1 },
  props: { value: { type: 'literal', value: id }, style: 'body', unavailableText: 'Unavailable' },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockResolvedValue(envelope());
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe('composition authoring model', () => {
  it('creates contract-backed nodes and supports ordered cross-surface reparenting without copying trees', () => {
    const document = createCompositionDocument('synthetic-document');
    const schema = Object.values(compositionEditorSchema.definitions ?? {}).find(schema =>
      fieldVariants(schema).some(item => item.properties?.type?.const === 'tile-grid'));
    expect(schema).toBeDefined();
    const gridSchema = fieldVariants(schema!).find(item => item.properties?.type?.const === 'tile-grid')!;
    const generated = defaultField(gridSchema, document);
    expect(generated).toMatchObject({ type: 'tile-grid', children: [], layout: { span: 1 } });
    expect(changeFieldVariant(gridSchema, text('stable-node'), document, '')).toMatchObject({ type: 'tile-grid', id: 'stable-node', title: 'stable-node' });
    document.pages[0].components = [
      { id: 'grid', title: 'Grid', type: 'tile-grid', layout: { span: 1 }, props: {
        minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' },
        equalRowHeights: false, shortRow: 'share', fold: 'page',
      }, children: [text('first'), { ...text('second'), layout: { span: 2 } }] },
    ];
    document.pages.push(createCompositionPage('detail'));
    const reordered = reorderCompositionItem(document, ['pages', 0, 'components', 0, 'children'], 1, -1);
    expect(componentLocations(reordered).map(item => item.node.id)).toEqual(['grid', 'second', 'first']);
    const moved = moveCompositionNode(reordered, 'second', { kind: 'surface', id: 'detail' });
    expect(moved.pages[1].components).toEqual([{ ...text('second'), layout: { span: 1 } }]);
    expect(componentLocations(moved).filter(item => item.node.id === 'second')).toHaveLength(1);
    expect(componentLocations(document).find(item => item.node.id === 'second')?.parent).toBe('grid');
    expect(() => moveCompositionNode(document, 'grid', { kind: 'grid', id: 'grid' })).toThrow('descendants');
    compileCompositionDocument(moved);
  });

  it('blocks deletion of referenced pages, tabs, models and assets rather than corrupting relationships', () => {
    const document = createCompositionDocument('synthetic-document');
    document.pages.push(createCompositionPage('detail'));
    document.navigation.tabs.push({ id: 'tab-detail', label: 'Detail', icon: document.pages[1].icon, pageId: 'detail', arguments: {} });
    expect(() => removeCompositionItem(document, ['pages'], 1)).toThrow('/document/navigation/tabs/0/pageId');
    document.navigation.initialTabId = 'tab-detail'; document.navigation.initialPageId = 'detail';
    expect(() => removeCompositionItem(document, ['navigation', 'tabs'], 0)).toThrow('initialTabId');
    document.dataSources.push({ id: 'source', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'switch.demo_item' } } });
    document.pages[0].components.push({
      id: 'action', title: 'Action', type: 'action-tile', icon: document.pages[0].icon, layout: { span: 1 },
      binding: { sourceId: 'source', projection: 'power-tile@1' },
      props: { family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
      action: { type: 'domain', sourceId: 'source', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } },
    });
    expect(() => removeCompositionItem(document, ['dataSources'], 0)).toThrow('binding/sourceId');
    expect(document.pages).toHaveLength(2);
    expect(document.dataSources).toHaveLength(1);
  });

  it('preserves source identity across supported kind changes and starts new modal definitions valid', () => {
    const document = createCompositionDocument('synthetic-document');
    const sourceSchema = compositionEditorSchema.properties!.dataSources.items;
    expect(Array.isArray(sourceSchema)).toBe(false);
    if (!sourceSchema || Array.isArray(sourceSchema)) throw new Error('Missing source schema');
    const model = fieldVariants(sourceSchema).find(variant => variant.properties?.kind?.const === 'model')!;
    expect(changeFieldVariant(model, { id: 'existing-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'switch.demo_item' } }, document, ''))
      .toMatchObject({ id: 'existing-source', kind: 'model' });
    const modalSchema = compositionEditorSchema.properties!.modals.items;
    if (!modalSchema || Array.isArray(modalSchema)) throw new Error('Missing modal schema');
    const modal = defaultField(modalSchema, document);
    expect(compositionErrors({ ...document, modals: [modal] })).toEqual([]);
  });

  it('exposes the away sensor target through the generated source inspector', () => {
    const document = createCompositionDocument('synthetic-document');
    const schema = compositionEditorSchema.properties!.dataSources.items;
    if (!schema || Array.isArray(schema)) throw new Error('Missing source schema');
    const away = fieldVariants(schema).find(variant => variant.properties?.model?.const === 'household-away-status@1');
    expect(away).toBeDefined();
    expect(defaultField(away!, document)).toMatchObject({
      kind: 'model', model: 'household-away-status@1', inputs: { entityId: { type: 'literal', value: '' } },
    });
  });

  it('imports one strict document tree with explicit content-only identity semantics', () => {
    const document = createCompositionDocument('imported-document');
    expect(importCompositionText(JSON.stringify(document), 'workspace-document').id).toBe('workspace-document');
    expect(() => importCompositionText('{"schemaVersion":"2.0","schema\\u0056ersion":"2.0"}', 'workspace')).toThrow(CompositionValidationError);
    expect(() => importCompositionText(JSON.stringify({ ...document, nativeFeature: 'home' }), 'workspace')).toThrow(CompositionValidationError);
    expect(compositionErrors({ ...document, variables: { privateValue: true } }).join('\n')).toContain('sh.local-state@1');
  });

  it('round-trips an exported near-limit document without pretty-print whitespace exceeding input bounds', () => {
    const document = createCompositionDocument('synthetic-document');
    document.pages[0].components = Array.from({ length: 10 }, (_, group) => ({
      id: `grid-${group}`, title: 'Grid', type: 'tile-grid', layout: { span: 1 },
      props: {
        minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' },
        equalRowHeights: false, shortRow: 'share', fold: 'page',
      },
      children: Array.from({ length: 90 }, (_, index) => ({
        id: `node-${group}-${index}`, title: 'Text', type: 'text', layout: { span: 1 },
        props: { value: { type: 'literal', value: 'x'.repeat(1980) }, style: 'body', unavailableText: 'Unavailable' },
      })),
    }));
    compileCompositionDocument(document);
    expect(new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength).toBeGreaterThan(MAX_COMPOSITION_ENVELOPE_BYTES);
    const exported = compositionSourceText(document);
    expect(importCompositionText(exported, document.id)).toEqual(document);
    expect(importCompositionText(compositionSourceText(document, true), document.id)).toEqual(document);
  });
});

describe('native composition structured controls', () => {
  it('edits configured todo counter fields without raw JSON', async () => {
    const draft = envelope();
    draft.document.dataSources.push({
      id: 'todo-counts', kind: 'model', model: 'todo-counts@1',
      inputs: { lists: [{ entityId: { type: 'literal', value: 'todo.example' }, overdue: true }] },
      labels: { openSuffix: 'open', overdueSuffix: 'late', separator: ' / ', zeroText: 'Clear',
        loadingText: 'Loading', unavailableText: 'Unavailable' },
    });
    draft.capabilities = compileCompositionDocument(draft.document).capabilities;
    vi.mocked(request).mockResolvedValue(draft);
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Data sources' }));
    fireEvent.change(screen.getByLabelText('Open Suffix'), { target: { value: 'remaining' } });
    fireEvent.click(screen.getByLabelText('Overdue'));
    vi.mocked(request).mockImplementationOnce(async (_path, init) => ({
      ...draft, revision: 2, document: JSON.parse(String(init?.body)).document,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/draft', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(String(vi.mocked(request).mock.calls.at(-1)?.[1]?.body));
    expect(body.document.dataSources[0]).toMatchObject({
      inputs: { lists: [{ overdue: false, entityId: { value: 'todo.example' } }] },
      labels: { openSuffix: 'remaining' },
    });
  });
  it('authors an exact engine job attachment and native target delivery', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Live Activities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add live activities item' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Cleaning' } });
    fireEvent.change(screen.getByLabelText('Glyph'), { target: { value: 'vacuum' } });
    fireEvent.change(screen.getByLabelText('Job Id'), { target: { value: 'vacuum.demo_unit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Routes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add native extension delivery' }));
    expect(screen.getByRole('button', { name: 'Import legacy aliases' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish native' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('authors ordered tab destinations through labels and selectors, and exports stable identity as read-only', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tabs item' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Authored tab' } });
    expect(screen.getByLabelText('Page Id').tagName).toBe('SELECT');
    const id = (screen.getByLabelText('Id') as HTMLInputElement);
    expect(id.readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('Initial tab'), { target: { value: id.value } });
    const next = { ...envelope(), revision: 2 };
    vi.mocked(request).mockResolvedValueOnce(next);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/draft', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(String(vi.mocked(request).mock.calls.at(-1)?.[1]?.body));
    expect(body.document.navigation.tabs[0]).toMatchObject({ id: id.value, label: 'Authored tab', pageId: 'page-home' });
    expect(body.document.navigation.initialTabId).toBe(id.value);
    expect(body.document.id).toBe('synthetic-document');
  });

  it('exposes component variants, policies and reparent controls without whole-screen feature types', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add components item' }));
    const type = screen.getByLabelText('New item type');
    const choices = within(type).getAllByRole('option');
    expect(choices.map(option => option.textContent)).toEqual(expect.arrayContaining([
      'text', 'navigation-tile', 'action-tile', 'tile-grid', 'section', 'local-tabs',
      'alarm-panel', 'door-tile', 'climate-control', 'room-device-control', 'camera-viewer',
    ]));
    fireEvent.change(type, { target: { value: within(type).getByRole<HTMLOptionElement>('option', { name: 'settings-link' }).value } });
    expect(screen.getByLabelText('Subtitle').tagName).toBe('TEXTAREA');
    expect((screen.getByLabelText('Shows Chevron') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(type, { target: { value: within(type).getByRole<HTMLOptionElement>('option', { name: 'tile-grid' }).value } });
    expect(screen.getByLabelText('Max Columns').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Short Row').tagName).toBe('SELECT');
    expect(screen.getByLabelText('New parent').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Component to move').tagName).toBe('SELECT');
  });

  it('authors an account header and private provider using generated fields', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Data sources' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add data sources item' }));
    const sourceType = screen.getAllByRole('combobox').find(select =>
      within(select).queryByRole('option', { name: 'profile-account@1' }));
    expect(sourceType).toBeDefined();
    const account = within(sourceType!).getAllByRole('option').find(option => option.textContent === 'profile-account@1');
    expect(account).toBeDefined();
    fireEvent.change(sourceType!, { target: { value: account!.getAttribute('value') } });
    expect(screen.queryByLabelText('Entity Id')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add components item' }));
    const componentType = screen.getByLabelText('New item type');
    fireEvent.change(componentType, { target: { value: within(componentType).getByRole<HTMLOptionElement>('option', { name: 'account-header' }).value } });
    expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
    fireEvent.change(screen.getByLabelText('Fallback Name'), { target: { value: 'Account' } });
    fireEvent.change(screen.getByLabelText('Loading Text'), { target: { value: 'Retrieving account' } });
    expect(screen.getByLabelText('Unavailable Text')).toBeDefined();
  });

  it('uses the immutable asset library and raw upload contract for wallpaper, without embedding bytes in the document', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    const asset: UploadedCompositionAsset = {
      sha256: 'b'.repeat(64), source: { type: 'publisher', path: `/api/assets/${'b'.repeat(64)}.png` },
      mimeType: 'image/png', byteLength: 100, pixelWidth: 2, pixelHeight: 2,
    };
    vi.mocked(request).mockResolvedValueOnce([asset]);
    fireEvent.click(screen.getByRole('button', { name: 'Wallpaper' }));
    await waitFor(() => expect(within(screen.getByLabelText('Uploaded immutable asset')).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Uploaded immutable asset'), { target: { value: asset.sha256 } });
    expect(screen.getByRole('link', { name: 'View authenticated image' }).getAttribute('href')).toBe(`./native${asset.source.path}`);
    const file = new File(['synthetic'], 'synthetic.png', { type: 'image/png' });
    vi.mocked(request).mockResolvedValueOnce(asset);
    fireEvent.change(screen.getByLabelText('Upload wallpaper (PNG/JPEG, at most 8 MiB)'), { target: { files: [file] } });
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/assets', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file }));
    fireEvent.click(screen.getByRole('button', { name: 'Use solid native background' }));
    expect(screen.queryByRole('link', { name: 'View authenticated image' })).toBeNull();
  });

  it('authors optional native tile presentation with structured controls and removes it without a null field', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add components item' }));
    const componentType = screen.getByLabelText('New item type');
    const navigationTile = within(componentType).getByRole<HTMLOptionElement>('option', { name: 'navigation-tile' });
    fireEvent.change(componentType, { target: { value: navigationTile.value } });
    expect(screen.queryByLabelText('Title Lines')).toBeNull();
    fireEvent.click(screen.getByLabelText('Include Presentation'));
    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'anchored-bottom' } });
    fireEvent.change(screen.getByLabelText('Title Lines'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Selected'), { target: { value: 'none' } });
    fireEvent.change(screen.getByLabelText('Fill type'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Red'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Blue'), { target: { value: '255' } });
    fireEvent.click(screen.getByLabelText('Include Body Hint'));
    fireEvent.change(screen.getByLabelText('Body Hint'), { target: { value: 'Opens the authored page' } });
    vi.mocked(request).mockImplementationOnce(async (_path, init) => ({
      ...envelope(), revision: 2, document: JSON.parse(String(init?.body)).document,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/draft', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(String(vi.mocked(request).mock.calls.at(-1)?.[1]?.body));
    expect(body.document.pages[0].components[0].props.presentation).toEqual({
      layout: 'anchored-bottom', titleLines: 2, fill: { type: 'solid-rgb', red: 42, green: 0, blue: 255 },
      bodyHint: 'Opens the authored page',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' }).hasAttribute('disabled')).toBe(true));
    fireEvent.click(screen.getByLabelText('Include Presentation'));
    expect(screen.queryByLabelText('Title Lines')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    const without = JSON.parse(String(vi.mocked(request).mock.calls.at(-1)?.[1]?.body));
    expect(without.document.pages[0].components[0].props).not.toHaveProperty('presentation');
  });

  it('keeps structured local work when advanced JSON/import validation fails', async () => {
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    const name = await screen.findByDisplayValue('Native composition');
    fireEvent.change(name, { target: { value: 'Local work survives failed import' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON...' }));
    fireEvent.change(screen.getByLabelText('Composition JSON'), { target: { value: '{"schemaVersion":"2.0","schemaVersion":"2.0"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and apply locally' }));
    expect(screen.getByRole('alert').textContent).toContain('duplicate_key');
    expect(screen.getByDisplayValue('Local work survives failed import')).toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('native composition persistence controls', () => {
  it('saves dirty work before publishing exactly the saved revision', async () => {
    const { result } = renderHook(useCompositionStudio);
    await waitFor(() => expect(result.current.document).toBeDefined());
    act(() => result.current.apply({ ...result.current.document!, name: 'Authored native composition' }));
    vi.mocked(request).mockResolvedValueOnce({ ...envelope(), revision: 2, document: result.current.document })
      .mockResolvedValueOnce({ ...envelope(), revision: 2, publishedAt: '2026-11-13T11:00:00Z' });
    await act(async () => { expect(await result.current.save(true)).toBe(true); });
    expect(request).toHaveBeenNthCalledWith(2, '/native/api/draft', expect.objectContaining({ method: 'PUT' }));
    expect(request).toHaveBeenNthCalledWith(3, '/native/api/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: 2 }) });
    expect(result.current.dirty).toBe(false);
    expect(result.current.publishedRevision).toBe(2);
  });

  it('retains local edits on conflict and only replaces latest server work after explicit keep-local', async () => {
    const { result } = renderHook(useCompositionStudio);
    await waitFor(() => expect(result.current.document).toBeDefined());
    act(() => result.current.apply({ ...result.current.document!, name: 'Keep my local work' }));
    vi.mocked(request).mockRejectedValueOnce(new ApiError('Revision conflict', 409));
    await act(async () => { expect(await result.current.save(true)).toBe(false); });
    expect(result.current.conflict).toBe(true);
    expect(result.current.document?.name).toBe('Keep my local work');
    expect(result.current.dirty).toBe(true);
    expect(request).not.toHaveBeenCalledWith('/native/api/publish', expect.anything());
    vi.mocked(request).mockResolvedValueOnce({ ...envelope(), revision: 7 })
      .mockResolvedValueOnce({ ...envelope(), revision: 8, document: result.current.document });
    await act(async () => { expect(await result.current.save(false, true)).toBe(true); });
    const body = JSON.parse(String(vi.mocked(request).mock.calls.at(-1)?.[1]?.body));
    expect(body.expectedRevision).toBe(7);
    expect(body.document.name).toBe('Keep my local work');
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('retains edits made while saving and blocks duplicate operations or invalid drafts', async () => {
    const { result } = renderHook(useCompositionStudio);
    await waitFor(() => expect(result.current.document).toBeDefined());
    act(() => result.current.apply({ ...result.current.document!, name: 'Snapshot' }));
    let finish!: (value: CompositionDraft) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<boolean>;
    const snapshot = result.current.document!;
    act(() => { pending = result.current.save(); });
    act(() => result.current.apply({ ...snapshot, name: 'Newer local edit' }));
    await act(async () => { expect(await result.current.save(true)).toBe(false); await result.current.reload(); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ ...envelope(), revision: 2, document: snapshot }); await pending; });
    expect(result.current.document?.name).toBe('Newer local edit');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.apply({ ...result.current.document!, pages: [] }));
    await act(async () => { expect(await result.current.save(true)).toBe(false); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.error).toContain('/document/pages');
  });
});

describe('Publish to Home Assistant', () => {
  const entry = (revision: number, publishedBy: string | null = 'supervisor-user-id') => ({
    revision, publishedAt: '2026-11-14T12:00:00+00:00', publishedBy, envelopeSha256: 'b'.repeat(64), capabilities: [],
  });
  it('publishes the saved draft, shows the revision, lists history and rolls back after confirmation', async () => {
    const summary = (current: number, history: number[]) => ({ epoch: 'e', current: entry(current), history: history.map(revision => entry(revision, null)), storedAssets: 0 });
    let published = false;
    vi.mocked(request).mockImplementation(async (path, init) => {
      if (path === '/native/api/ha/publish') { published = true; return { epoch: 'e', revision: 2, envelopeSha256: 'b'.repeat(64), uploadedAssets: 1, skippedAssets: 2 }; }
      if (path === '/native/api/ha/rollback') { expect(JSON.parse(String(init?.body))).toEqual({ revision: 1 }); published = false; return { epoch: 'e', revision: 3, envelopeSha256: 'b'.repeat(64) }; }
      if (path === '/native/api/ha/publication') return published ? summary(2, [1]) : summary(3, [2, 1]);
      return envelope();
    });
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.click(screen.getByRole('button', { name: 'Publish to Home Assistant' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/ha/publish', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) })));
    expect((await screen.findByRole('status')).textContent).toContain('Published to Home Assistant as revision 2');
    fireEvent.click(screen.getByRole('button', { name: 'Home Assistant' }));
    expect(await screen.findByText('1 image uploaded, 2 already stored', { exact: false })).toBeTruthy();
    const rows = await screen.findAllByRole('row');
    expect(rows.map(row => within(row).queryByRole('rowheader')?.textContent)).toEqual([undefined, 'r2current', 'r1']);
    expect(within(rows[2]).getByText('unknown')).toBeTruthy();
    expect(within(rows[1]).queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    expect(request).not.toHaveBeenCalledWith('/native/api/ha/rollback', expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/ha/rollback', expect.objectContaining({ method: 'POST' })));
    expect((await screen.findByRole('status')).textContent).toContain('Home Assistant now serves revision 3');
  });

  it('shows Home Assistant errors and keeps local edits', async () => {
    vi.mocked(request).mockImplementation(async path => {
      if (path === '/native/api/ha/publish') throw new ApiError('Home Assistant refused the request: publishing needs an administrator.', 502);
      if (path === '/native/api/ha/publication') throw new ApiError('Home Assistant is not configured', 503);
      return envelope();
    });
    render(<NativeCompositionWorkspace active onLegacy={() => {}}/>);
    await screen.findByDisplayValue('Native composition');
    fireEvent.change(screen.getByDisplayValue('Native composition'), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish to Home Assistant' }));
    expect((await screen.findByRole('alert')).textContent).toContain('needs an administrator');
    expect(screen.getByText('Unsaved local changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home Assistant' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map(item => item.textContent).join()).toContain('not configured'));
  });
});
