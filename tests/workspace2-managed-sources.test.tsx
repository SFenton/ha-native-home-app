// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import { useCompositionStudio } from '../src/useCompositionStudio';
import { tileType } from '../src/workspace2/add/catalog';
import { ensureSource } from '../src/workspace2/add/sources';
import { replaceAt } from '../src/composition-editor';
import { pruneEntitySources, sourceUses } from '../src/workspace2/dialogs/sources';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import fixture from '../src/preview2/fixtures/logic-gallery.json';

vi.mock('../src/api', async original => ({ ...await original<typeof import('../src/api')>(), request: vi.fn() }));
afterEach(cleanup);
const base = fixture.document as unknown as CompositionDocument;
const entity = (id: string, value = 'light.demo_kitchen'): CompositionDocument['dataSources'][number] => ({ id, kind: 'ha-entity', entityId: { type: 'literal', value } });
const doc = (id = 'light.demo_kitchen'): CompositionDocument => {
  const made = tileType('bound-control')!.make({ document: { ...base, dataSources: [] }, entityId: 'light.demo_kitchen', name: 'Kitchen light' });
  const node = { ...made.node, props: { ...('props' in made.node ? made.node.props : {}), kind: 'toggle', surface: 'tile', isOn: { type: 'state', sourceId: id, path: ['state'], in: ['on'] }, unavailableText: 'Unavailable' } };
  return { ...base, dataSources: [entity(id)], pages: [{ ...base.pages[0], components: [node as CompositionDocument['pages'][number]['components'][number]] }], modals: [], componentLibrary: [], logicLibrary: [] };
};

describe('Studio-managed entity sources', () => {
  it('uses the entity id in both factories, suffixes collisions, and reuses legacy ids without migration', () => {
    const empty = { ...base, dataSources: [] };
    for (const key of ['bound-control', 'row', 'readout']) {
      const type = tileType(key);
      if (!type) throw new Error(`Missing entity factory ${key}`);
      expect(type.make({ document: empty, entityId: 'light.demo_kitchen' }).sources[0].id).toBe('light.demo_kitchen');
    }
    expect(ensureSource(empty, 'light.demo_kitchen').sourceId).toBe('light.demo_kitchen');
    const collision = { ...empty, dataSources: [entity('light.demo_kitchen', 'light.demo_other')] };
    expect(ensureSource(collision, 'light.demo_kitchen').sourceId).toBe('light.demo_kitchen-2');
    expect(tileType('bound-control')!.make({ document: collision, entityId: 'light.demo_kitchen' }).sources[0].id).toBe('light.demo_kitchen-2');
    const legacy = doc('entity-kitchen');
    expect(ensureSource(legacy, 'light.demo_kitchen')).toEqual({ document: legacy, sourceId: 'entity-kitchen' });
    expect(tileType('bound-control')!.make({ document: legacy, entityId: 'light.demo_kitchen' }).sources).toEqual([]);
    expect(pruneEntitySources(legacy, legacy)).toBe(legacy);
  });

  it('does not mistake an entity id, label or service target for a source read; keeps model sources', () => {
    const before = doc();
    const source = base.dataSources.find(item => item.kind === 'model')!;
    const unused = { ...before, name: 'light.demo_kitchen', pages: [{ ...before.pages[0], components: [] }], dataSources: [...before.dataSources, source] };
    expect(sourceUses(unused).get('light.demo_kitchen')).toBe(0);
    expect(pruneEntitySources(before, unused).dataSources).toEqual([source]);
    expect(sourceUses(before).get('light.demo_kitchen')).toBe(1);
    expect(pruneEntitySources(before, before)).toBe(before);
    const onlyServiceTargets = replaceAt(before, ['pages', 0, 'components', 0, 'props', 'isOn'], { type: 'compare', op: 'eq', left: { type: 'literal', value: true }, right: { type: 'literal', value: true } });
    expect(pruneEntitySources(before, onlyServiceTargets).dataSources).toEqual([]);
  });

  it('keeps sources used through template samples and arguments, and removes orphaned dependency chains', () => {
    const before = doc('entity-legacy'), withoutTile = { ...before, pages: [{ ...before.pages[0], components: [] }] };
    const template: NonNullable<CompositionDocument['logicLibrary']>[number] = {
      id: 'template', name: 'Lamp status', kind: 'condition',
      params: [{ name: 'lamp', kind: 'source-id', label: 'Lamp', sample: 'entity-legacy' }],
      body: { type: 'state', sourceId: 'entity-legacy', path: ['state'], in: ['on'] },
    };
    expect(pruneEntitySources(before, { ...withoutTile, logicLibrary: [template] }).dataSources).toEqual(before.dataSources);
    const dependent: CompositionDocument['dataSources'][number] = { id: 'dependent', kind: 'ha-entity', entityId: { type: 'read', from: { type: 'source', sourceId: 'entity-legacy', path: ['state'] }, as: 'entity-id', missing: 'unavailable' } };
    const chain = { ...before, dataSources: [...before.dataSources, dependent] };
    const usedChain = replaceAt(chain, ['pages', 0, 'components', 0, 'props', 'isOn', 'sourceId'], dependent.id);
    expect(pruneEntitySources(usedChain, { ...withoutTile, dataSources: chain.dataSources }).dataSources).toEqual([]);
  });

  it('resolves plain-string value bindings before pruning, retaining validity through undo and redo', async () => {
    const initial = doc('legacy-actual');
    const node: CompositionDocument['pages'][number]['components'][number] = {
      id: 'value-text', title: 'Value', type: 'text', layout: { span: 1 },
      props: { value: { type: 'read', from: { type: 'source', sourceId: 'legacy-default', path: ['state'] }, as: 'string', missing: 'unavailable' }, style: 'body', unavailableText: 'Unavailable' },
    };
    const before: CompositionDocument = {
      ...initial, dataSources: [...initial.dataSources, entity('legacy-default')],
      componentLibrary: [{ id: 'value-component', name: 'Value component', node, params: [{ name: 'which', kind: 'value' }], bindings: [{ param: 'which', nodeId: node.id, field: 'props/value/from/sourceId' }] }],
      pages: [{ ...initial.pages[0], components: [{ id: 'value-place', type: 'component-ref', componentId: 'value-component', layout: { span: 1 }, values: { which: 'legacy-actual' } }] }],
    };
    expect(() => compileCompositionDocument(before)).not.toThrow();
    expect(sourceUses(before).get('legacy-actual')).toBeGreaterThan(0);
    vi.mocked(request).mockResolvedValueOnce({ envelopeVersion: '2.0', document: before, revision: 1 });
    const { result } = renderHook(useCompositionStudio);
    await waitFor(() => expect(result.current.document).toBeDefined());
    act(() => result.current.apply({ ...before, name: 'Renamed' }));
    expect(result.current.document!.dataSources).toEqual(before.dataSources);
    expect(() => compileCompositionDocument(result.current.document)).not.toThrow();
    act(() => result.current.undo());
    expect(result.current.document).toBe(before);
    act(() => result.current.redo());
    expect(() => compileCompositionDocument(result.current.document)).not.toThrow();
    expect(result.current.document!.dataSources).toEqual(before.dataSources);
  });

  it('resolves string parameters and private namespaces without mistaking private ids or entity targets for global reads', () => {
    const initial = doc('legacy-actual');
    const node = initial.pages[0].components[0];
    const definition: NonNullable<CompositionDocument['componentLibrary']>[number] = {
      id: 'private-component', name: 'Private component', node,
      sources: [{ id: 'legacy-actual', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_private' } }],
      params: [{ name: 'which', kind: 'source-id' }],
      bindings: [{ param: 'which', nodeId: node.id, field: 'props/isOn/sourceId' }],
    };
    const without = { ...initial, pages: [{ ...initial.pages[0], components: [] }], componentLibrary: [definition] };
    expect(sourceUses(without).get('legacy-actual')).toBe(0);
    const placed = replaceAt(without, ['pages', 0, 'components'], [{ id: 'place', type: 'component-ref', componentId: definition.id, layout: { span: 1 }, args: { which: 'legacy-actual' } }]);
    expect(sourceUses(placed).get('legacy-actual')).toBeGreaterThan(0);
    expect(pruneEntitySources(placed, without).dataSources).toEqual([]);
    const literalTarget = replaceAt(without, ['pages', 0, 'components'], [{ ...node, props: { copySourceId: 'legacy-actual' } }]);
    expect(sourceUses(literalTarget).get('legacy-actual')).toBe(0);
  });

  it('retains declared source arguments even without bindings, but not text arguments that happen to name a source', () => {
    const initial = doc('legacy-actual');
    const entry: NonNullable<CompositionDocument['componentLibrary']>[number] = {
      id: 'unbound-component', name: 'Unbound component',
      node: { id: 'unbound-text', type: 'text', title: 'Caption', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Caption' }, style: 'body', unavailableText: 'Unavailable' } },
      params: [{ name: 'reader', kind: 'source-id' }, { name: 'caption', kind: 'text' }],
    };
    const place = { id: 'unbound-place', type: 'component-ref' as const, componentId: entry.id, layout: { span: 1 as const }, args: { reader: 'legacy-actual', caption: 'legacy-actual' } };
    const before: CompositionDocument = { ...initial, componentLibrary: [entry], pages: [{ ...initial.pages[0], components: [...initial.pages[0].components, place] }] };
    const edited = { ...before, pages: [{ ...before.pages[0], components: [place] }] };
    expect(() => compileCompositionDocument(before)).not.toThrow();
    expect(sourceUses(edited).get('legacy-actual')).toBe(1);
    const pruned = pruneEntitySources(before, edited);
    expect(pruned.dataSources).toEqual(before.dataSources);
    expect(() => compileCompositionDocument(pruned)).not.toThrow();
    const textOnly = replaceAt(edited, ['componentLibrary', 0, 'params', 0, 'kind'], 'text');
    expect(() => compileCompositionDocument(textOnly)).not.toThrow();
    expect(sourceUses(textOnly).get('legacy-actual')).toBe(0);
  });

  it.each([
    ['navigation visibility', ['navigation', 'tabs', 0, 'visibleWhen']],
    ['chrome', ['navigation', 'chrome', 'groups']],
    ['surface toolbar', ['pages', 0, 'toolbar']],
    ['models and flow parameter reads', ['dataSources', 1]],
    ['rules, looks and controls', ['pages', 0, 'components']],
  ])('counts references throughout %s', (_name, path) => {
    const initial = doc('legacy-actual');
    const empty = { ...initial, pages: [{ ...initial.pages[0], components: [] }] };
    const edited = replaceAt(empty, path as (string | number)[], { from: { sourceId: 'legacy-actual' }, subtitleSourceIds: ['legacy-actual'], scopeProviderId: 'legacy-actual' });
    expect(sourceUses(edited).get('legacy-actual')).toBe(3);
    expect(pruneEntitySources(initial, edited).dataSources).toContainEqual(initial.dataSources[0]);
  });

  it('leaves loaded orphans and no-op edits alone, but prunes the source this edit orphaned', async () => {
    const initial = doc('legacy-used');
    const before = { ...initial, dataSources: [...initial.dataSources, entity('legacy-orphan')] };
    vi.mocked(request).mockResolvedValueOnce({ envelopeVersion: '2.0', document: before, revision: 1 });
    const { result } = renderHook(useCompositionStudio);
    await waitFor(() => expect(result.current.document).toBeDefined());
    for (const edit of [before, structuredClone(before)]) act(() => result.current.apply(edit));
    expect(result.current.document).toBe(before);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.apply({ ...before, name: 'Renamed' }));
    expect(result.current.document!.dataSources).toEqual(before.dataSources);
    act(() => result.current.apply({ ...result.current.document!, pages: [{ ...before.pages[0], components: [] }] }));
    expect(result.current.document!.dataSources.map(source => source.id)).toEqual(['legacy-orphan']);
    act(() => result.current.undo());
    expect(result.current.document!.dataSources).toEqual(before.dataSources);
    act(() => result.current.redo());
    expect(result.current.document!.dataSources.map(source => source.id)).toEqual(['legacy-orphan']);
  });

  it('prunes the last read in the same undo step and restores both on undo/redo; stale drops cannot revert it', async () => {
    for (const id of ['light.demo_kitchen', 'entity-legacy']) {
      const before = doc(id);
      vi.mocked(request).mockResolvedValueOnce({ envelopeVersion: '2.0', document: before, revision: 1 });
      const { result, unmount } = renderHook(useCompositionStudio);
      await waitFor(() => expect(result.current.document).toBeDefined());
      const edit = { ...before, pages: [{ ...before.pages[0], components: [] }] };
      act(() => result.current.apply(edit));
      expect(result.current.document!.dataSources).toEqual([]);
      let reverted = false;
      act(() => { reverted = result.current.revert(edit); });
      expect(reverted).toBe(true);
      expect(result.current.document).toBe(before);
      act(() => result.current.apply(edit));
      act(() => result.current.undo());
      expect(result.current.document).toBe(before);
      act(() => result.current.redo());
      expect(result.current.document!.dataSources).toEqual([]);
      const newer = { ...result.current.document!, name: 'Newer' };
      act(() => result.current.apply(newer));
      reverted = true;
      act(() => { reverted = result.current.revert(edit); });
      expect(reverted).toBe(false);
      act(() => { reverted = result.current.revert(newer); });
      expect(reverted).toBe(true);
      unmount();
    }
  });
});
