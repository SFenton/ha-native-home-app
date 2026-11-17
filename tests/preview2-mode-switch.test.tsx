// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay, type Overlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { SelectionKey } from '../src/preview2/model';

afterEach(cleanup);

const home = homeDomains.document as unknown as CompositionDocument;
const corpus = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../contract/corpus/accept/${name}.json`), 'utf8')).document as CompositionDocument;

/** The shell's job: it owns the mode, the selection and the surface, and passes them down. */
function Shell({ document, start, initial = 'edit' }: { document: CompositionDocument; start: PreviewSurface; initial?: 'edit' | 'use' }) {
  const [mode, setMode] = useState(initial);
  const [selection, setSelection] = useState<SelectionKey>();
  const [surface, setSurface] = useState(start);
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  return <>
    <button onClick={() => setMode(mode === 'edit' ? 'use' : 'edit')}>Mode {mode}</button><output data-testid="surface">{surface.kind}:{surface.id}</output>
    <Preview2 document={document} mode={mode} surface={surface} onSurfaceChange={setSurface} selection={mode === 'edit' ? selection : undefined} onSelect={setSelection} window={previewWindows[0]} bezel={false}
      house={demoHouse(document)} overlay={overlay} onOverlayChange={setOverlay}/>
  </>;
}
const toggle = () => fireEvent.click(screen.getByRole('button', { name: /^Mode / }));
const sheet = () => globalThis.document.querySelector<HTMLElement>('.sh-sheet')!;

// H7: with a sheet open, switching Edit to Use closed and opened it again. The present animation was keyed to the mode, so it
// started the moment Use began; it now belongs to the sheet's arrival.
describe('switching the mode with a sheet open', () => {
  it('keeps the same sheet and adds no present animation going from Edit to Use and back', () => {
    render(<Shell document={home} start={{ kind: 'modal', id: 'hc-overview-lights' }}/>);
    const first = sheet();
    expect(first.hasAttribute('data-animate'), 'opened in Edit: no animation').toBe(false);
    toggle();
    expect(sheet(), 'the same element after the switch to Use').toBe(first);
    expect(first.hasAttribute('data-animate'), 'Use adds no slide-in').toBe(false);
    toggle();
    expect(sheet()).toBe(first);
    expect(first.hasAttribute('data-animate')).toBe(false);
    expect(globalThis.document.querySelectorAll('.sh-sheet')).toHaveLength(1);
  });

  it('keeps a sheet that arrived in Use as it is when the mode goes to Edit and back', () => {
    render(<Shell document={home} start={{ kind: 'page', id: 'page-home' }} initial="use"/>);
    const lights = screen.getAllByRole('button').find(item => item.closest('[data-sel="node:hc-chip-0"]'))!;
    fireEvent.click(lights);
    const first = sheet();
    expect(screen.getByTestId('surface').textContent).toBe('modal:hc-overview-lights');
    expect(first.hasAttribute('data-animate'), 'it slid in once, on arrival').toBe(true);
    toggle();
    expect(sheet()).toBe(first);
    expect(first.hasAttribute('data-animate'), 'the arrival animation is not taken back or replayed').toBe(true);
    expect(screen.getByTestId('surface').textContent).toBe('modal:hc-overview-lights');
    toggle();
    expect(sheet()).toBe(first);
  });

  it('keeps the page stack: a pushed page is still on top, once, after Edit and back', () => {
    const doc = corpus('fixture-home-domains');
    const start: PreviewSurface = { kind: 'page', id: doc.pages.find(page => page.id !== doc.navigation.initialPageId)!.id };
    render(<Shell document={doc} start={start} initial="use"/>);
    const pageOf = () => [...globalThis.document.querySelectorAll('.sh-page[data-current]')].map(item => item.getAttribute('data-page'));
    const before = pageOf();
    expect(before).toHaveLength(1);
    const surface = screen.getByTestId('surface').textContent;
    toggle(); expect(pageOf()).toEqual(before); expect(screen.getByTestId('surface').textContent).toBe(surface);
    toggle(); expect(pageOf()).toEqual(before); expect(screen.getByTestId('surface').textContent).toBe(surface);
    expect(globalThis.document.querySelectorAll('.sh-page')).toHaveLength(1);
  });
});

// H1 on the drawn nodes: both horizontal scrollers carry the Edit-only bar.
describe('the scroll bar on the drawn rows', () => {
  const paged = () => {
    const doc = corpus('collection-pull-to-refresh-true');
    const found: CompositionNode[] = [];
    const walk = (node: unknown) => { if (node && typeof node === 'object') { if ((node as { type?: string }).type === 'paged-row') found.push(node as CompositionNode); Object.values(node).forEach(walk); } };
    walk(doc.pages);
    return { doc, node: found[0] };
  };
  it('draws one under a status rail and a paged row in Edit and none in Use', () => {
    const { doc, node } = paged();
    expect(node).toBeDefined();
    for (const [mode, expected] of [['edit', 1], ['use', 0]] as const) {
      const view = render(<Preview2 document={doc} mode={mode} surface={{ kind: 'page', id: doc.pages.find(page => JSON.stringify(page).includes('paged-row'))!.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
        house={demoHouse(doc)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
      const row = view.container.querySelector(`[data-sel="node:${node.id}"] .sh-paged-track`);
      expect(row, mode).not.toBeNull();
      expect(view.container.querySelectorAll(`[data-sel="node:${node.id}"] .sh-hbar`), mode).toHaveLength(expected);
      view.unmount();
    }
  });
  it('draws one under the Home status rail in Edit', () => {
    const view = render(<Preview2 document={home} mode="edit" surface={{ kind: 'page', id: 'page-home' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
      house={demoHouse(home)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    expect(view.container.querySelectorAll('[data-sel="node:hc-status-rail"] .sh-hbar')).toHaveLength(1);
  });
});

// A local choice was a native <select> that the preview could not style or place; it is a pull-down now.
describe('a local choice control', () => {
  it('opens a pull-down of its options in Use and writes the pick into the overlay', () => {
    const doc = corpus('family-local-controls');
    const node = { id: 'panel-pick', title: 'Panel', type: 'local-control', layout: { span: 1 }, props: { stateId: 'panel', kind: 'choice', placeholder: '' } } as CompositionNode;
    const page = { ...doc.pages[0], toolbar: { type: 'inherit' as const }, components: [node] };
    const base = { ...doc, navigation: { ...doc.navigation, tabs: [], initialPageId: page.id, initialTabId: null }, pages: [page], modals: [] } as CompositionDocument;
    const onOverlayChange = vi.fn();
    const view = render(<Preview2 document={base} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
      house={demoHouse(base)} overlay={emptyOverlay} onOverlayChange={onOverlayChange}/>);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Panel' }));
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Details', 'Options']);
    expect(screen.getByRole('menuitemradio', { name: 'Details' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Options' }));
    expect(onOverlayChange).toHaveBeenCalledWith({ entities: {}, local: { panel: { type: 'string', value: 'options' } } });
  });
});
