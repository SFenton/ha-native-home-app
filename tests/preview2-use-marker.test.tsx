// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import { markTitle } from '../src/preview2/use-marker';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const page: PreviewSurface = { kind: 'page', id: home.navigation.initialPageId };
const index = buildDocumentIndex(home);
/** A node on the first page. */
const node = index.keys.find(key => key.startsWith('node:') && index.get(key)!.surface === `page:${page.id}`)! as SelectionKey;

function show(mode: 'edit' | 'use', selection: SelectionKey | undefined, surface: PreviewSurface = page) {
  return render(<Preview2 document={home} mode={mode} surface={surface} onSurfaceChange={() => {}} selection={selection} onSelect={() => {}} window={previewWindows[0]} bezel={false}
    house={demoHouse(home)} overlay={emptyOverlay} onOverlayChange={() => {}}/>);
}
const element = (key: string) => [...document.querySelectorAll<HTMLElement>('[data-sel]')].find(item => item.getAttribute('data-sel') === key);

describe('the Use marker', () => {
  it('marks the selected node in Use with the name tag, and not with the Edit ring', () => {
    show('use', node);
    const marked = element(node)!;
    expect(marked.hasAttribute('data-marked')).toBe(true);
    expect(marked.hasAttribute('data-selected')).toBe(false);
    expect(marked.querySelector(':scope > .sh-use-tag')?.textContent).toBe(index.get(node)!.node!.title);
    // The tag and the marks take no pointer events and are hidden from the accessibility tree.
    expect(marked.querySelector(':scope > .sh-use-tag')?.getAttribute('aria-hidden')).toBe('true');
    expect(marked.querySelector('.sh-handle-slot')).toBeNull();
  });

  it('says what it shows in a status line', () => {
    show('use', node);
    expect(document.querySelector('[role=status].sh-use-status')?.textContent).toBe(`Showing ${index.get(node)!.node!.title} in the simulator.`);
  });

  it('is the Edit selection in Edit, and turns into one and back when the mode switches', () => {
    const { rerender } = show('edit', node);
    expect(element(node)!.hasAttribute('data-selected')).toBe(true);
    expect(element(node)!.hasAttribute('data-marked')).toBe(false);
    expect(document.querySelector('.sh-use-tag')).toBeNull();
    const props = { document: home, surface: page, onSurfaceChange: () => {}, selection: node, onSelect: () => {}, window: previewWindows[0], bezel: false, house: demoHouse(home), overlay: emptyOverlay, onOverlayChange: () => {} };
    rerender(<Preview2 {...props} mode="use"/>);
    expect(element(node)!.hasAttribute('data-marked')).toBe(true);
    expect(element(node)!.hasAttribute('data-selected')).toBe(false);
    rerender(<Preview2 {...props} mode="edit"/>);
    expect(element(node)!.hasAttribute('data-selected')).toBe(true);
    expect(document.querySelector('[data-marked]')).toBeNull();
    expect(document.querySelectorAll('.sh-use-tag')).toHaveLength(0);
  });

  it('leaves with the selection', () => {
    const { rerender } = show('use', node);
    expect(document.querySelectorAll('[data-marked]')).toHaveLength(1);
    rerender(<Preview2 document={home} mode="use" surface={page} onSurfaceChange={() => {}} onSelect={() => {}} window={previewWindows[0]} bezel={false} house={demoHouse(home)} overlay={emptyOverlay} onOverlayChange={() => {}}/>);
    expect(document.querySelector('[data-marked]')).toBeNull();
    expect(document.querySelector('.sh-use-tag')).toBeNull();
    expect(document.querySelector('.sh-use-status')?.textContent).toBe('');
  });

  it('marks nothing for a page, and nothing for an element that is not on screen', () => {
    show('use', `page:${page.id}` as SelectionKey);
    expect(document.querySelector('[data-marked]')).toBeNull();
    cleanup();
    // A node of another page is not drawn, so there is nothing to mark (the row stays selected in the library).
    const other = index.keys.find(key => key.startsWith('node:') && index.get(key)!.surface !== `page:${page.id}` && index.get(key)!.surface?.startsWith('page:'))!;
    show('use', other);
    expect(document.querySelector('[data-marked]')).toBeNull();
  });

  it('marks a sheet on its frame', () => {
    const modal = home.modals[0];
    show('use', `modal:${modal.id}` as SelectionKey, { kind: 'modal', id: modal.id });
    const frame = document.querySelector<HTMLElement>('.sh-sheet')!;
    expect(frame.hasAttribute('data-marked')).toBe(true);
    expect(frame.querySelector(':scope > .sh-use-tag')?.textContent).toBe(modal.title);
  });

  it('never selects: a tap in Use operates the app', () => {
    let selected: SelectionKey | undefined = undefined as SelectionKey | undefined;
    render(<Preview2 document={home} mode="use" surface={page} onSurfaceChange={() => {}} selection={node} onSelect={next => { selected = next; }} window={previewWindows[0]} bezel={false} house={demoHouse(home)} overlay={emptyOverlay} onOverlayChange={() => {}}/>);
    element(node)!.click();
    expect(selected).toBeUndefined();
  });
});

describe('markTitle', () => {
  it('names nodes, sheets and tabs, and nothing else', () => {
    expect(markTitle(home, node)).toBe(index.get(node)!.node!.title);
    expect(markTitle(home, `modal:${home.modals[0].id}` as SelectionKey)).toBe(home.modals[0].title);
    expect(markTitle(home, `tab:${home.navigation.tabs[0].id}` as SelectionKey)).toBe(home.navigation.tabs[0].label);
    expect(markTitle(home, 'node:missing' as SelectionKey)).toBeUndefined();
  });
});
