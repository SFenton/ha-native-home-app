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
    expect(pruneEntitySources(legacy)).toBe(legacy);
  });

  it('does not mistake an entity id, label or service target for a source read; keeps model sources', () => {
    const before = doc();
    const source = base.dataSources.find(item => item.kind === 'model')!;
    const unused = { ...before, name: 'light.demo_kitchen', pages: [{ ...before.pages[0], components: [] }], dataSources: [...before.dataSources, source] };
    expect(sourceUses(unused).get('light.demo_kitchen')).toBe(0);
    expect(pruneEntitySources(unused).dataSources).toEqual([source]);
    expect(sourceUses(before).get('light.demo_kitchen')).toBe(1);
    expect(pruneEntitySources(before)).toBe(before);
    const onlyServiceTargets = replaceAt(before, ['pages', 0, 'components', 0, 'props', 'isOn'], { type: 'compare', op: 'eq', left: { type: 'literal', value: true }, right: { type: 'literal', value: true } });
    expect(pruneEntitySources(onlyServiceTargets).dataSources).toEqual([]);
  });

  it('keeps sources used through template samples and arguments, and removes orphaned dependency chains', () => {
    const before = doc('entity-legacy'), withoutTile = { ...before, pages: [{ ...before.pages[0], components: [] }] };
    const template: NonNullable<CompositionDocument['logicLibrary']>[number] = {
      id: 'template', name: 'Lamp status', kind: 'condition',
      params: [{ name: 'lamp', kind: 'source-id', label: 'Lamp', sample: 'entity-legacy' }],
      body: { type: 'state', sourceId: 'entity-legacy', path: ['state'], in: ['on'] },
    };
    expect(pruneEntitySources({ ...withoutTile, logicLibrary: [template] }).dataSources).toEqual(before.dataSources);
    const dependent: CompositionDocument['dataSources'][number] = { id: 'dependent', kind: 'ha-entity', entityId: { type: 'read', from: { type: 'source', sourceId: 'entity-legacy', path: ['state'] }, as: 'entity-id', missing: 'unavailable' } };
    expect(pruneEntitySources({ ...withoutTile, dataSources: [...before.dataSources, dependent] }).dataSources).toEqual([]);
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
