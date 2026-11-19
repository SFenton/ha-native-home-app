import type { LogicUseBinding } from '../../../src/shared/composition/graph/types';
import { createCompositionDocument, compositionSymbol } from '../../../src/shared/composition/workspace';
import type { Json } from '../../../src/shared/types';

export const useField = '/props/subtitle/value';
export const read = (sourceId: Json) => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'string', missing: 'unavailable' });
export const labelTemplate = {
  id: 'tile-label', name: 'Tile label', kind: 'operand',
  params: [{ name: 'source', kind: 'source-id' }],
  body: read({ type: 'hole', name: 'source' }),
};
export const use = (source = 'source-a') => ({ type: 'logic-ref', logicId: 'tile-label', args: { source } });
export function tile(id: string, sourceId: string) {
  return {
    id, type: 'navigation-tile', title: id, icon: compositionSymbol(), layout: { span: 1 },
    props: { family: 'neutral', selected: 'navigation-path', titleProviderId: sourceId, subtitle: { type: 'expr', value: use() } },
    action: { type: 'push', pageId: 'page-home', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
  };
}
export const binding = (nodeId: string): LogicUseBinding => ({
  use: { kind: 'page', id: 'page-home', nodeId, field: useField },
  argument: 'source', from: { kind: 'use-tile', field: '/props/titleProviderId' },
});
export function draftDocument(id = 'draft-fixture') {
  const base = createCompositionDocument(id);
  return {
    ...base,
    dataSources: ['source-a', 'source-b'].map((id, index) => ({
      id, kind: 'ha-entity', entityId: { type: 'literal', value: `sensor.demo_${index}` },
    })),
    pages: [{ ...base.pages[0], components: [tile('tile-a', 'source-a'), tile('tile-b', 'source-b')] }],
    logicLibrary: [labelTemplate],
    logicUseBindings: [binding('tile-a'), binding('tile-b')],
  };
}
