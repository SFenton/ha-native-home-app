import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileCompositionDocument, compositionDependencies } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { CompositionValidationError } from '../src/shared/composition/json';
import { documentDependencies, pruneEntitySources, removeUnusedSources, sourceUses } from '../src/workspace2/dialogs/sources';
import { entityReaders } from '../src/workspace2/flows/model';

const jsonFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? jsonFiles(`${directory}/${entry.name}`) : entry.name.endsWith('.json') ? [`${directory}/${entry.name}`] : []);
const files = ['contract/corpus/accept', 'src/preview2/fixtures', 'tests/fixtures'].flatMap(jsonFiles).sort();

it('keeps compiler reference checking, In Use and pruning in agreement for every corpus source removal', () => {
  let documents = 0, removals = 0, entityRows = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const document: CompositionDocument = raw.document ?? raw;
    if (!document.dataSources || !document.pages) continue;
    try { compileCompositionDocument(document); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      // Some preview/test fixtures are deliberately incomplete. Every accept-corpus document must compile.
      expect(file.startsWith('contract/corpus/accept/'), file).toBe(false);
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
