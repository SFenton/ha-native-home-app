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

