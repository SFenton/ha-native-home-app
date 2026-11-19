import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { decodeCompositionPublication } from '../../../server/composition';
import { CompositionValidationError } from '../../../src/shared/composition/json';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(`${directory}/${entry.name}`) : entry.name.endsWith('.json') ? [`${directory}/${entry.name}`] : []);
function result(operation: () => unknown) {
  try { return { ok: true, value: operation() }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false, issues: error.issues };
  }
}

it('keeps acceptance, diagnostics, manifests and output bytes identical to main 2fd1e9c for every existing corpus document/publication fixture', () => {
  const paths = ['contract/corpus/accept', 'contract/corpus/reject', 'tests/fixtures', 'src/preview2/fixtures'].flatMap(files).sort();
  const cases = paths.flatMap(file => {
    const bytes = readFileSync(file);
    let envelope;
    try { envelope = JSON.parse(bytes.toString('utf8')); }
    catch { return [{ file, decode: result(() => decodeCompositionPublication(bytes)) }]; }
    if (!file.startsWith('contract/') && envelope?.document?.schemaVersion !== '2.0') return [];
    return [{
      file,
      compile: result(() => compileCompositionDocument(envelope.document, {
        tileInkDefault: Array.isArray(envelope.capabilities) && envelope.capabilities.includes('sh.tile-ink-default@1'),
      })),
      decode: result(() => decodeCompositionPublication(bytes)),
    }];
  });
  expect(cases).toHaveLength(1812);
  expect(createHash('sha256').update(JSON.stringify(cases)).digest('hex')).toBe('22a3ab90825bd16fcbd697bbdb747cc47eda39cd2dff6f9bb93498d49e7eed2d');
}, 30_000);
