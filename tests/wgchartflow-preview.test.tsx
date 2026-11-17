// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import { wgchartflowStory } from '../src/preview2/fixtures/wgchartflow-story';
import { wgflowRecords } from '../src/preview2/fixtures/wgflow-story';

/** The chart that reads a records flow, the chart that reads the list it sits in, and the gauge in a repeated cell (lane `integ10`, the WG-S2 and WG-S3 seam). */
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(page: string, records: typeof wgflowRecords | null = wgflowRecords) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(342);
  const { document, house } = wgchartflowStory();
  const surface: PreviewSurface = { kind: 'page', id: `page-wx-${page}` };
  return render(<Preview2 document={document} mode="use" surface={surface} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
    house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()} records={records ?? undefined}/>).container;
}
const el = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;

describe('the story', () => {
  it('compiles and declares the chart, the gauge, the repeat and nothing else it does not use', () => {
    const result = compileCompositionDocument(wgchartflowStory().document);
    for (const id of ['sh.chart@1', 'sh.linear-gauge@1', 'sh.repeat@1']) expect(result.capabilities).toContain(id);
  });
  it('names nothing after a product', () => {
    expect(JSON.stringify(wgchartflowStory().document)).not.toMatch(/forecast_|humidity|aqi/i);
  });
});

describe('a chart over the records of a flow', () => {
  it('draws one bar for each of the first twelve records, labelled by the label operand', () => {
    const chart = el(mount('chart'), 'wx-bars');
    expect(chart.querySelectorAll('.sh-chart-bar')).toHaveLength(12);
    expect(chart.querySelector('.sh-chart-series')!.textContent).toMatch(/^Now 70°?/);
    expect(chart.querySelectorAll('.sh-chart-xlabel')[1].textContent).toBe('7 PM');
  });
  it('draws an area from the same flow, with a dot on each known value', () => {
    const chart = el(mount('chart'), 'wx-area');
    expect(chart.querySelector('.sh-chart-area')).not.toBeNull();
    expect(chart.querySelectorAll('.sh-chart-dot')).toHaveLength(12);
  });
  it('says its empty text while the flow has not answered, and with no host to run flows', () => {
    expect(el(mount('chart'), 'wx-slow').querySelector('.sh-chart-empty-text')!.textContent).toBe('Unavailable');
    cleanup();
    expect(el(mount('chart', null), 'wx-bars').querySelector('.sh-chart-empty-text')).not.toBeNull();
  });
  it('draws no bar for a flow that answers with no records', () => {
    const chart = el(mount('chart', () => ({ state: 'empty', records: [] })), 'wx-bars');
    expect(chart.querySelector('.sh-chart-bar')).toBeNull();
    expect(chart.querySelector('.sh-chart-empty-text')).not.toBeNull();
  });
});

describe('a chart inside a repeat', () => {
  it('reads the list of the repeat: its first three records, in every cell', () => {
    const container = mount('inside');
    const charts = container.querySelectorAll('.sh-chart');
    expect(charts).toHaveLength(3);
    for (const chart of charts) expect(chart.querySelectorAll('.sh-chart-bar')).toHaveLength(3);
  });
});

describe('a gauge in a repeated cell', () => {
  it('places each marker by its own record: the first hour is warmer than the fourth', () => {
    const container = mount('gauge');
    const markers = [...container.querySelectorAll<HTMLElement>('.sh-repeat-cell .sh-gauge-marker')];
    expect(markers).toHaveLength(4);
    const lefts = markers.map(marker => parseFloat(marker.style.left));
    expect(lefts[0]).toBeGreaterThan(lefts[3]);
    expect(new Set(lefts).size).toBe(4);
  });
  it('reads each as a meter named by its own record', () => {
    const meters = [...mount('gauge').querySelectorAll('.sh-repeat-cell [role="meter"]')];
    expect(meters.map(meter => meter.getAttribute('aria-label')?.slice(0, 3))).toEqual(['Now', '7 P', '8 P', '9 P']);
  });
});
