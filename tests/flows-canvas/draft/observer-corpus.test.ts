import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { decodeCompositionPublication } from '../../../server/composition';
import { CompositionValidationError } from '../../../src/shared/composition/json';
import { pointer } from '../../../src/shared/composition/json';
import { callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, predicateBase } from '../../../src/shared/composition/expression';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(`${directory}/${entry.name}`) : entry.name.endsWith('.json') ? [`${directory}/${entry.name}`] : []);
function result(operation: () => unknown) {
  try { return { ok: true, value: operation() }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false, issues: error.issues };
  }
}

it('keeps the committed plain visitor fresh without rewriting it', () => {
  execFileSync(process.execPath, ['scripts/generate-expression-checker.mjs', '--check'], { stdio: 'pipe' });
});

it('matches before/after baseline bytes for all 1812 corpus documents/publication fixtures with and without an observer', () => {
  let visits = 0;
  const accountingObserver = () => { visits += 1; };
  const paths = ['contract/corpus/accept', 'contract/corpus/reject', 'tests/fixtures', 'src/preview2/fixtures'].flatMap(files).sort();
  const cases = paths.flatMap(file => {
    const bytes = readFileSync(file);
    let envelope;
    try { envelope = JSON.parse(bytes.toString('utf8')); }
    catch { return [{ file, decode: result(() => decodeCompositionPublication(bytes)) }]; }
    if (!file.startsWith('contract/') && envelope?.document?.schemaVersion !== '2.0') return [];
    const tileInkDefault = Array.isArray(envelope.capabilities) && envelope.capabilities.includes('sh.tile-ink-default@1');
    const compile = result(() => compileCompositionDocument(envelope.document, { tileInkDefault }));
    expect(result(() => compileCompositionDocument(envelope.document, { tileInkDefault, accountingObserver })), file).toStrictEqual(compile);
    return [{ file, compile, decode: result(() => decodeCompositionPublication(bytes)) }];
  });
  expect(cases).toHaveLength(1812);
  expect(visits).toBeGreaterThan(0);
  expect(createHash('sha256').update(JSON.stringify(cases)).digest('hex')).toBe('22a3ab90825bd16fcbd697bbdb747cc47eda39cd2dff6f9bb93498d49e7eed2d');
}, 30_000);

it('gives both visitor specialisations identical facts and diagnostics for every grammar root in the corpus', () => {
  let roots = 0;
  const observer = () => {};
  function visit(value: unknown, at: string): void {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, pointer(at, index))); return; }
    if (value === null || typeof value !== 'object') return;
    if ('type' in value && typeof value.type === 'string') {
      const operand = operandBase.safeParse(value);
      const predicate = predicateBase.safeParse(value);
      if (operand.success) {
        expect(checkOperand(operand.data, at, true, false, 'lenient', observer), at).toStrictEqual(checkOperand(operand.data, at, true, false, 'lenient'));
        roots += 1;
      } else if (predicate.success) {
        expect(checkPredicate(predicate.data, at, false, 'lenient', observer), at).toStrictEqual(checkPredicate(predicate.data, at, false, 'lenient'));
        roots += 1;
      } else if (value.type === 'call-service') {
        const call = callServiceSchema.safeParse(value);
        if (call.success) {
          expect(checkCallService(call.data, at, true, 'lenient', 'any', observer), at).toStrictEqual(checkCallService(call.data, at, true, 'lenient', 'any'));
          roots += 1;
        }
      }
    }
    for (const [key, child] of Object.entries(value)) visit(child, pointer(at, key));
  }
  for (const file of ['contract/corpus/accept', 'contract/corpus/reject', 'tests/fixtures', 'src/preview2/fixtures'].flatMap(files).sort()) {
    let envelope;
    try { envelope = JSON.parse(readFileSync(file, 'utf8')); }
    catch { continue; }
    if (file.startsWith('contract/') || envelope?.document?.schemaVersion === '2.0') visit(envelope.document, '/document');
  }
  expect(roots).toBeGreaterThan(547);
}, 30_000);
