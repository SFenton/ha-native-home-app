import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileCompositionDocument, compositionDependencies } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { CompositionValidationError } from '../src/shared/composition/json';
import { documentDependencies, pruneEntitySources, removeUnusedSources, sourceUses } from '../src/workspace2/dialogs/sources';
import { entityReaders } from '../src/workspace2/flows/model';
import { logicParamKinds, type LogicEntry } from '../src/shared/composition/logic-library';
import type { Operand } from '../src/shared/composition/expression';

const jsonFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? jsonFiles(`${directory}/${entry.name}`) : entry.name.endsWith('.json') ? [`${directory}/${entry.name}`] : []);
const files = ['contract/corpus/accept', 'src/preview2/fixtures', 'tests/fixtures'].flatMap(jsonFiles).sort();
const read: Extract<Operand, { type: 'read' }> = { type: 'read', from: { type: 'source', sourceId: 'logic-sample', path: ['state'] }, as: 'string', missing: 'unavailable' };
const base: CompositionDocument = JSON.parse(readFileSync('src/preview2/fixtures/logic-gallery.json', 'utf8')).document;
const omittedSamples = logicParamKinds.flatMap(kind => ['read', 'constant', 'hole'].map(shape => {
  const hole = { type: 'hole', name: 'optional' };
  const body: LogicEntry['body'] = shape === 'read' ? read : shape === 'constant' ? { type: 'literal', value: 'Constant' }
    : kind === 'source-id' || kind === 'text' ? { type: 'raw-state', sourceId: hole }
      : kind === 'operand' ? hole : kind === 'number' ? { type: 'literal', value: hole }
        : { type: 'choose', cases: [{ when: hole, then: { type: 'literal', value: 1 } }], otherwise: { type: 'literal', value: 0 } };
  const document: CompositionDocument = {
    ...base, dataSources: [{ id: 'logic-sample', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.optional_sample' } }],
    pages: [{ ...base.pages[0], components: [] }], modals: [], componentLibrary: [],
    logicLibrary: [{ id: 'saved', name: 'Saved body', kind: 'operand', params: [{ name: 'optional', kind }], body }],
  };
  return { kind, shape, file: `omitted-sample/${kind}-${shape}`, document };
}));

it.each(omittedSamples)('supports an omitted $kind sample in a saved $shape body', ({ document, shape }) => {
  compileCompositionDocument(document);
  const graph = documentDependencies(document);
  expect(graph.complete).toBe(true);
  expect(graph.issues).toEqual([]);
  expect(sourceUses(document).get('logic-sample')).toBe(shape === 'read' ? 1 : 0);
  expect(entityReaders(document).has('sensor.optional_sample')).toBe(shape === 'read');
  if (shape === 'read') expect(entityReaders(document).get('sensor.optional_sample')).toEqual(new Set(['Saved body']));
  expect(graph.edges.filter(edge => edge.sample && edge.target.type === 'source').map(edge => edge.target.id)).toEqual(shape === 'read' ? ['logic-sample'] : []);
  const before: CompositionDocument = {
    ...document, pages: [{ ...document.pages[0], components: [{
      id: 'last-reader', title: 'Last reader', type: 'text', layout: { span: 1 }, props: { value: read, style: 'body', unavailableText: 'Unavailable' },
    }] }],
  };
  compileCompositionDocument(before);
  const pruned = pruneEntitySources(before, document);
  expect(pruned.dataSources.map(source => source.id)).toEqual(shape === 'read' ? ['logic-sample'] : []);
  compileCompositionDocument(pruned);
});

function* dependencyDocuments(): Generator<{ file: string; document: CompositionDocument }> {
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    yield { file, document: raw.document ?? raw };
  }
  yield* omittedSamples;
}

it('keeps compiler reference checking, In Use and pruning in agreement for every corpus source removal', () => {
  let documents = 0, removals = 0, entityRows = 0;
  for (const { file, document } of dependencyDocuments()) {
    if (!document.dataSources || !document.pages) continue;
    try { compileCompositionDocument(document); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      // Some preview/test fixtures are deliberately incomplete. Every accept-corpus document must compile.
      expect(file.startsWith('contract/corpus/accept/') || file.startsWith('omitted-sample/'), file).toBe(false);
      continue;
    }
    documents++;
    const { edges } = documentDependencies(document);
    const compilerEdges = compositionDependencies(document).edges;
    expect(edges.filter(edge => !edge.sample), file).toEqual(compilerEdges);
    const uses = sourceUses(document), readers = entityReaders(document);
    const retained = new Set(removeUnusedSources(document).dataSources.map(source => source.id));
    const haSources = document.dataSources.filter(source => source.kind === 'ha-entity');
    const before: CompositionDocument = {
      ...document, pages: document.pages.map((page, index) => index ? page : { ...page, components: [...page.components, ...haSources.map((source, at) => ({
        id: `differential-reader-${at}`, type: 'text' as const, title: 'Removed reader', layout: { span: 1 },
        props: { value: { type: 'read' as const, from: { type: 'source' as const, sourceId: source.id, path: ['state'] }, as: 'string' as const, missing: 'unavailable' as const }, style: 'body' as const, unavailableText: 'Unavailable' },
      }))] }),
    };
    const managed = new Set(pruneEntitySources(before, document).dataSources.map(source => source.id));
    for (const [index, source] of document.dataSources.entries()) {
      removals++;
      const label = `${file}: ${source.id}`;
      let needed = false;
      try { compileCompositionDocument({ ...document, dataSources: document.dataSources.filter(other => other !== source) }); }
      catch (error) {
        if (!(error instanceof CompositionValidationError)) throw error;
        needed = error.issues.some(issue => issue.code === 'invalid_reference');
      }
      const own = edges.filter(edge => edge.target.type === 'source' && edge.target.id === source.id);
      const sample = own.some(edge => edge.sample), sampleRead = own.some(edge => edge.sample && edge.kind === 'read');
      const argumentOnly = own.filter(edge => !edge.sample).every(edge => edge.kind === 'argument');
      expect((uses.get(source.id) ?? 0) > 0, label).toBe(needed || sample);
      expect(retained.has(source.id), label).toBe(needed || sample);
      // Automatic cleanup intentionally preserves editable model definitions.
      expect(managed.has(source.id), label).toBe(source.kind !== 'ha-entity' || needed || sample);
      if (source.kind === 'ha-entity' && source.entityId.type === 'literal') {
        // A unique entity endpoint avoids false agreement from two sources naming the same entity.
        const marker = `${source.entityId.value.split('.')[0]}.dependency_probe_${documents}_${index}`;
        const marked: CompositionDocument = { ...document, dataSources: document.dataSources.map(other => other === source ? { ...source, entityId: { type: 'literal', value: marker } } : other) };
        expect(documentDependencies(marked).issues, label).toEqual([]);
        expect(entityReaders(marked).has(marker), label).toBe(needed && !argumentOnly || sampleRead);
        entityRows++;
      }
      if (needed && !argumentOnly) {
        // Non-entity models only have entity rows when they lead to literal entity endpoints.
        const pending = [source.id], seen = new Set<string>();
        while (pending.length) {
          const id = pending.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          for (const edge of edges.filter(edge => edge.from === id && edge.kind !== 'argument')) {
            if (edge.target.type === 'entity') expect(readers.has(edge.target.id), `${label}: ${edge.target.id}`).toBe(true);
            else pending.push(edge.target.id);
          }
        }
      }
    }
  }
  expect(documents).toBeGreaterThan(500);
  expect(removals).toBeGreaterThan(3000);
  expect(entityRows).toBeGreaterThan(500);
}, 60_000);
