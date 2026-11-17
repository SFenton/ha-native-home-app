// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import { wgflowRecords, wgflowStory } from '../src/preview2/fixtures/wgflow-story';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const iphone = previewWindows[0];

/** Mounts the story on one of its pages; every element measures `width` wide. */
function mount(page: string, mode: 'use' | 'edit' = 'use', width = 342, records = wgflowRecords) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  const { document, house } = wgflowStory();
  const surface: PreviewSurface = { kind: 'page', id: `page-wf-${page}` };
  return render(<Preview2 document={document} mode={mode} surface={surface} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={iphone} bezel={false} house={house}
    overlay={emptyOverlay} onOverlayChange={vi.fn()} records={records}/>);
}
const cells = (root: HTMLElement, id: string) => [...root.querySelectorAll(`[data-sel="node:${id}"] .sh-repeat-cell`)];

describe('the repeat in the preview', () => {
  it('draws its first child once for each record, with item and index set', () => {
    const { container } = mount('row');
    const all = container.querySelectorAll('.sh-repeat-cell');
    expect(all).toHaveLength(12);
    expect(all[0].textContent).toContain('Now');
    expect(all[1].textContent).toContain('7 PM');
    expect(all[0].textContent).toContain('70°');
  });
  it('pages a row: five to a page in a compact window, with a page indicator that follows the page', () => {
    const { container, getByTestId } = mount('row');
    const pages = container.querySelectorAll('.sh-repeat-page');
    expect(pages).toHaveLength(3);
    expect(pages[0].children).toHaveLength(5);
    expect(getByTestId('repeat-dots').getAttribute('aria-label')).toBe('Page 1 of 3');
    expect(container.querySelector('[aria-label="Next page"]')).toBeNull();
  });
  it('counts a page by the window: nine would not fit, eight is the regular count and the buttons appear', () => {
    const { container, getByLabelText, getByTestId } = mount('row', 'use', 700);
    expect(container.querySelectorAll('.sh-repeat-page')[0].children).toHaveLength(8);
    fireEvent.click(getByLabelText('Next page'));
    expect(getByTestId('repeat-dots').getAttribute('aria-label')).toBe('Page 2 of 2');
    expect((getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true);
  });
  it('draws a column of at most `limit` cells and does not page it', () => {
    const { container } = mount('column');
    expect(container.querySelectorAll('.sh-repeat-cell')).toHaveLength(4);
    expect(container.querySelector('.sh-repeat-paged')).toBeNull();
  });
  it('draws the placeholder while the flow has not answered: the count of ghosts, numbered from 1, and the loading word', () => {
    const { container, getByTestId } = mount('loading');
    const ghosts = container.querySelectorAll('.sh-repeat-cell');
    expect(ghosts).toHaveLength(6);
    expect(ghosts[0].textContent).toBe('1');
    expect(ghosts[5].textContent).toBe('6');
    expect(getByTestId('repeat-word').textContent).toBe('Loading');
  });
  it('says its empty, error and unavailable words when the flow gives no records', () => {
    for (const [state, word] of [['empty', 'Nothing to show'], ['error', 'Could not update'], ['unavailable', 'Unavailable']] as const) {
      const { getByTestId, unmount } = mount('row', 'use', 342, () => ({ state, records: [] }));
      expect(getByTestId('repeat-word').textContent).toBe(word);
      unmount();
    }
  });
  it('keeps the records and adds the out-of-date line when a later run failed', () => {
    const { container, getByTestId } = mount('column', 'use', 342, (id, inputs) => ({ ...wgflowRecords(id, inputs), stale: true }));
    expect(container.querySelectorAll('.sh-repeat-cell')).toHaveLength(4);
    expect(getByTestId('repeat-stale').textContent).toBe('Out of date');
  });
  it('draws as loading when nothing runs flows', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(342);
    const { document, house } = wgflowStory();
    const { getByTestId } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: 'page-wf-row' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={iphone}
      bezel={false} house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    expect(getByTestId('repeat-word').textContent).toBe('Loading');
  });
  it('gives each place of a saved component its own flow and its own cells', () => {
    const { container } = mount('template');
    expect(container.querySelectorAll('.sh-repeat')).toHaveLength(2);
    expect(container.querySelectorAll('.sh-repeat-cell')).toHaveLength(24);
  });
});

describe('the repeat in Edit', () => {
  it('selects the first copy only: later copies carry no data-sel and are inert', () => {
    const { container } = mount('column', 'edit');
    expect(container.querySelectorAll('[data-sel="node:wf-col-cell"]')).toHaveLength(1);
    const later = container.querySelectorAll('.sh-repeat-cell[data-index="1"] [data-copy]');
    expect(later.length).toBeGreaterThan(0);
    for (const node of later) { expect(node.getAttribute('data-sel')).toBeNull(); expect(node.hasAttribute('inert')).toBe(true); }
  });
  it('draws every cell of a record with its own text, never the first one\'s', () => {
    const { container } = mount('column', 'edit');
    const labels = [...container.querySelectorAll('.sh-repeat-cell')].map(cell => cell.textContent);
    expect(new Set(labels).size).toBe(4);
  });
});
