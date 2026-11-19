// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/composition-first-slice.json';
import { valueAt } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionNode } from '../src/shared/composition/schema';
import { createDraft } from '../src/workspace2/editors/draft';
import { lineOperand, writeParts } from '../src/workspace2/expr/TokenField';
import { parseLine } from '../src/workspace2/expr/tokens';

const read = { type: 'read', from: { type: 'source', sourceId: 's', path: ['state'] }, as: 'string', missing: 'unavailable' } as const;
const operand = { ...read, from: { ...read.from, path: [...read.from.path] } };

describe.each(['read', 'expr'] as const)('editing a %s text slot', kind => {
  it('preserves fallback and keep when writing text and editing a token', () => {
    const settings = { fallback: 'No reading', whenUnavailable: 'keep' as const };
    const slot = kind === 'read' ? { ...operand, ...settings } : { type: 'expr' as const, value: operand, ...settings };
    const base = compileCompositionDocument(fixture.document).document;
    const node: CompositionNode = { id: 'keep-text', title: 'Reading', type: 'text', layout: { span: 1 }, props: { value: slot, style: 'body', unavailableText: 'Unknown' } };
    const draft = createDraft({ ...base, pages: base.pages.map((page, index) => index ? page : { ...page, components: [node] }) });
    const address = { path: ['pages', 0, 'components', 0, 'props', 'value'], wrap: 'slot' as const };
    const parts = parseLine(lineOperand(valueAt(draft.get(), address.path), 'slot')!)!;
    writeParts(draft, address, [...parts, { text: ' degrees' }], true);
    expect(valueAt(draft.get(), address.path)).toEqual({ type: 'expr', value: { type: 'format', pattern: '{a} degrees', args: { a: operand } }, ...settings });
    const replacement = { ...operand, from: { ...operand.from, sourceId: 'new-source' } };
    writeParts(draft, address, [{ token: { operand: replacement } }], false);
    expect(valueAt(draft.get(), address.path)).toEqual({ ...replacement, ...settings });
    draft.undo();
    expect(valueAt(draft.get(), address.path)).toMatchObject({ type: 'expr', ...settings });
  });
});
