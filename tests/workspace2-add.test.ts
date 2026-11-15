import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors } from '../src/composition-editor';
import { tileTypes } from '../src/workspace2/add/catalog';
import { canHold, endOf, insertEntity, insertType, type Destination } from '../src/workspace2/add/insert';
import { buildDocumentIndex } from '../src/preview2/model';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const doc = fixture.document;
const grid = (() => { const found = [...buildDocumentIndex(doc).entries.values()].find(e => e.node?.type === 'tile-grid'); return found!; })();
const section = [...buildDocumentIndex(doc).entries.values()].find(e => e.node?.type === 'section')!;
const rail = [...buildDocumentIndex(doc).entries.values()].find(e => e.node?.type === 'status-rail')!;

describe('probe', () => {
  it('compiles', () => {
    expect(compositionErrors(doc)).toEqual([]);
    const report: string[] = [];
    for (const [label, entry, owner] of [['page', undefined, 'page:page-home'], ['grid', grid, grid.key], ['section', section, section.key], ['rail', rail, rail.key]] as const) {
      const where = endOf(doc, owner as never) as Destination;
      for (const type of tileTypes) {
        const needsEntity = type.domains ? { entityId: `${type.domains[0]}.probe`, name: 'Probe' } : undefined;
        try {
          const { document } = insertType(doc, where, type.type, needsEntity);
          const errors = compositionErrors(document);
          report.push(`${label} + ${type.type}: ${errors.length ? errors.slice(0, 2).join(' | ') : 'ok'} (table ${canHold(doc, owner as never, type.type)})`);
        } catch (e) { report.push(`${label} + ${type.type}: threw ${(e as Error).message}`); }
      }
    }
    console.log(report.join('\n'));
  });
});
