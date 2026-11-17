import { createContext } from 'react';
import { componentReferences, expandSources, libraryById, ownedSources } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument } from '../shared/composition/schema';

/**
 * The document's saved components by id, for the lists that draw a `component-ref` as its expansion. It is a context of its own, not a field of the render
 * context, so changing one component re-draws the lists that hold a use of it and leaves every other node's frame alone.
 */
export const ComponentLibraryContext = createContext<ReadonlyMap<string, ComponentEntry>>(new Map());

const sourcesOf = new WeakMap<object, CompositionDocument['dataSources']>();

/**
 * The data sources the preview reads: the document's own, then a copy of each source a template owns for every place that uses it (`<place id>~<source id>`,
 * `expandSources`). The draft and the publication never hold the copies; the app expands them the same way. The same array as `dataSources` when no
 * template owns a source, so nothing downstream sees a change it did not make.
 */
export function previewSources(document: Pick<CompositionDocument, 'dataSources' | 'pages' | 'modals' | 'componentLibrary'>): CompositionDocument['dataSources'] {
  if (!document.componentLibrary?.some(entry => ownedSources(entry).length)) return document.dataSources;
  const known = sourcesOf.get(document);
  if (known) return known;
  const entries = libraryById(document);
  const added = componentReferences(document).flatMap(use => { const entry = entries.get(use.ref.componentId); return entry ? expandSources(use.ref, entry) : []; });
  const all = added.length ? [...document.dataSources, ...added] : document.dataSources;
  sourcesOf.set(document, all);
  return all;
}
