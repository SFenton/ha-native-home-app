// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/composition-first-slice.json';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import type { TextSlot } from '../src/shared/composition/evaluator';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { emptyOverlay, houseFrom, type House } from '../src/preview2/projections';

afterEach(cleanup);
const read = { type: 'read', from: { type: 'source', sourceId: 'keep-source', path: ['state'] }, as: 'string', missing: 'unavailable' } as const;
const content = { ...read, from: { ...read.from, path: [...read.from.path] } };
const base = compileCompositionDocument(fixture.document).document;
const house = (state?: string) => houseFrom({ states: state === undefined ? [] : [{ entityId: 'sensor.demo_keep', name: 'Reading', state }] });
function documentWith(slot: TextSlot, styled = false): CompositionDocument {
  const node: CompositionNode = { id: 'keep-text', title: 'Reading', type: 'text', layout: { span: 1 },
    props: { value: slot, style: 'body', unavailableText: 'Unknown', ...(styled ? { font: { weight: 'bold' as const } } : {}) } };
  return { ...base, dataSources: [...base.dataSources, { id: 'keep-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_keep' } }],
    pages: base.pages.map((page, index) => index ? page : { ...page, components: [node] }) };
}
function preview(document: CompositionDocument, home: House) {
  return <Preview2 document={document} mode="use" surface={{ kind: 'page', id: document.pages[0].id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={home} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>;
}

describe.each(['read', 'expr'] as const)('%s preview retention', kind => {
  const slot = kind === 'read' ? content : { type: 'expr' as const, value: content };
  it.each([false, true])('keeps the last answered text while unavailable (styled: %s)', styled => {
    const document = documentWith({ ...slot, whenUnavailable: 'keep', fallback: 'No reading' }, styled);
    const view = render(preview(document, house('21')));
    const text = () => view.container.querySelector('[data-sel="node:keep-text"]')?.textContent;
    expect(text()).toBe('21');
    view.rerender(preview(document, house()));
    expect(text()).toBe('21');
    view.rerender(preview(document, house('22')));
    expect(text()).toBe('22');
    view.rerender(preview(document, {}));
    expect(text()).toBe('22');
    view.rerender(preview(document, house()));
    expect(text()).toBe('22');
  });

  it('uses the current fallback until the first answer, without caching fallback as an answer', () => {
    const document = documentWith({ ...slot, whenUnavailable: 'keep', fallback: 'No reading' });
    const view = render(preview(document, house()));
    const text = () => view.container.querySelector('[data-sel="node:keep-text"]')?.textContent;
    expect(text()).toBe('No reading');
    const updated = documentWith({ ...slot, whenUnavailable: 'keep', fallback: 'Still waiting' });
    view.rerender(preview(updated, house()));
    expect(text()).toBe('Still waiting');
    view.rerender(preview(updated, house('23')));
    view.rerender(preview(updated, house()));
    expect(text()).toBe('23');
  });

  it('preserves fallback and no-fallback behavior when keep is not selected', () => {
    const document = documentWith({ ...slot, fallback: 'No reading' });
    const view = render(preview(document, house('21')));
    const text = () => view.container.querySelector('[data-sel="node:keep-text"]')?.textContent;
    view.rerender(preview(document, house()));
    expect(text()).toBe('No reading');
    view.rerender(preview(documentWith({ ...slot, whenUnavailable: 'keep' }), house()));
    expect(text()).toBe('21');
    cleanup();
    const never = render(preview(documentWith({ ...slot, whenUnavailable: 'keep' }), house()));
    expect(never.container.querySelector('[data-sel="node:keep-text"]')?.textContent).toBe('Unknown');
  });
});
