import { describe, expect, it } from 'vitest';
import fixture from './fixtures/composition-first-slice.json';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { resolveText, loading, unavailable, value, type ReadResult, type TextSlot } from '../src/shared/composition/evaluator';
import { CompositionValidationError } from '../src/shared/composition/json';

const read = { type: 'read', from: { type: 'source', sourceId: 'keep-source', path: ['state'] }, as: 'string', missing: 'unavailable' } as const;
const content = { ...read, from: { ...read.from, path: [...read.from.path] } };
const slots: Exclude<TextSlot, { type: 'literal' }>[] = [content, { type: 'expr', value: content }];
const documentWith = (slot: unknown) => ({
  ...fixture.document,
  dataSources: [...fixture.document.dataSources, { id: 'keep-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_keep' } }],
  pages: fixture.document.pages.map((page, index) => index ? page : { ...page, components: [
    { id: 'keep-text', title: 'Reading', type: 'text', layout: { span: 1 }, props: { value: slot, style: 'body', unavailableText: 'Unknown' } },
  ] }),
});

describe.each(slots)('$type text unavailable policy', slot => {
  it.each(['fallback', 'keep'] as const)('accepts %s and declares text-keep', whenUnavailable => {
    const compiled = compileCompositionDocument(documentWith({ ...slot, fallback: 'No reading', whenUnavailable }));
    expect(compiled.capabilities).toContain('sh.text-keep@1');
  });

  it('keeps the existing manifest when the field is omitted', () => {
    expect(compileCompositionDocument(documentWith(slot)).capabilities).not.toContain('sh.text-keep@1');
  });

  it.each(['retain', '', false, null])('refuses invalid policy %s without repairing it', whenUnavailable => {
    expect(() => compileCompositionDocument(documentWith({ ...slot, whenUnavailable }))).toThrow(CompositionValidationError);
  });

  it.each(['fallback', 'keep'])('refuses %s without the capability in the manifest', whenUnavailable => {
    const document = documentWith({ ...slot, whenUnavailable });
    const compiled = compileCompositionDocument(document);
    const envelope = { ...fixture, document, capabilities: compiled.capabilities.filter(id => id !== 'sh.text-keep@1') };
    try {
      decodeCompositionPublication(Buffer.from(JSON.stringify(envelope)));
      expect.fail('A missing capability must be refused');
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      expect(error.issues[0]).toMatchObject({ code: 'capability_manifest_mismatch', pointer: '/capabilities' });
    }
  });

  it('keeps the last answer only with keep; absent and fallback still draw fallback', () => {
    const env = { read: (): ReadResult => unavailable };
    expect(resolveText({ ...slot, whenUnavailable: 'keep', fallback: 'No reading' }, env, '21 degrees')).toEqual(value('21 degrees'));
    expect(resolveText({ ...slot, whenUnavailable: 'keep', fallback: 'No reading' }, env, '')).toEqual(value(''));
    expect(resolveText({ ...slot, fallback: 'No reading' }, env, '21 degrees')).toEqual(value('No reading'));
    expect(resolveText({ ...slot, whenUnavailable: 'fallback', fallback: 'No reading' }, env, '21 degrees')).toEqual(value('No reading'));
  });

  it('draws fallback before any answer and retains loading behavior', () => {
    const keep = { ...slot, whenUnavailable: 'keep' as const, fallback: 'No reading' };
    expect(resolveText(keep, { read: () => unavailable })).toEqual(value('No reading'));
    expect(resolveText({ ...slot, whenUnavailable: 'keep' }, { read: () => unavailable })).toEqual(unavailable);
    expect(resolveText(keep, { read: () => loading }, 'Last shown')).toEqual(value('Last shown'));
    expect(resolveText(keep, { read: () => loading })).toEqual(loading);
    expect(resolveText(keep, { read: () => value('Fresh') }, 'Last shown')).toEqual(value('Fresh'));
  });
});
