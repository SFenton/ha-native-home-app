// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAMPLE_ITEMS, SAMPLE_LIMIT, SAMPLES_KEY, clearSample, demoFromShape, demoLive, flowData, keepSample, resetSamples, sampleOf, setHideValues, trimSample,
} from '../src/workspace2/data/samples';
import { requestShape } from '../src/shared/composition/pipeline';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { flowById, newFlow } from '../src/workspace2/data/flow';

const context = { clock: { now: '2026-11-12T09:41:00', utcOffsetMinutes: 0 }, inputs: {} };
const base = (JSON.parse(readFileSync('src/preview2/fixtures/home-domains.json', 'utf8')) as { document: CompositionDocument }).document;
const made = newFlow(base, 'service', { title: 'Example' });
const service = flowById(made.document, made.id)!.inputs;
/** A made-up answer the flow's request shape accepts. */
const answer = demoFromShape(requestShape(service.request));

beforeEach(() => { localStorage.clear(); resetSamples(); });

describe('samples live beside the draft, never in the document', () => {
  it('keeps a run in this browser only, under its own key, and clears it', () => {
    expect(keepSample('flow-a', { items: ['a', 'b'] })).toBe(true);
    expect(sampleOf('flow-a')?.json).toEqual({ items: ['a', 'b'] });
    expect(localStorage.getItem(SAMPLES_KEY)).toContain('flow-a');
    expect(JSON.stringify(made.document)).not.toContain('"a","b"');
    clearSample('flow-a');
    expect(sampleOf('flow-a')).toBeUndefined();
  });
  it('cuts long lists to the item limit and says what it cut', () => {
    const list = Array.from({ length: SAMPLE_ITEMS + 25 }, (_, at) => at);
    const out = trimSample({ items: list });
    expect((out.json as { items: number[] }).items).toHaveLength(SAMPLE_ITEMS);
    expect(out.trimmed).toEqual({ shown: SAMPLE_ITEMS, of: SAMPLE_ITEMS + 25 });
    expect(trimSample({ items: [1] }).trimmed).toBeUndefined();
  });
  it('refuses a sample over the size limit even after trimming', () => {
    expect(keepSample('flow-big', { text: 'x'.repeat(SAMPLE_LIMIT + 10) })).toBe(false);
    expect(sampleOf('flow-big')).toBeUndefined();
  });
});

describe('what a flow draws', () => {
  it('draws demo data from the shape until there is a sample, then the sample', () => {
    const first = flowData(service, { context });
    expect(first.source).toBe('demo');
    expect(first.response).toEqual(answer);
    keepSample('flow-a', { kept: true });
    const next = flowData(service, { context, sample: sampleOf('flow-a') });
    expect(next.source).toBe('sample');
    expect(next.response).toEqual({ kept: true });
  });
  it('Hide Values draws demo data in place of the sample', () => {
    keepSample('flow-a', { kept: true });
    setHideValues(true);
    expect(flowData(service, { context, sample: sampleOf('flow-a'), hide: true }).source).toBe('demo');
  });
  it('makes up values of a shape, and a live list of chores and a forecast, with invented ids only', () => {
    expect(demoFromShape({ kind: 'array', of: { kind: 'string' } } as never)).toHaveLength(3);
    const todo = demoLive({ type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.example_chores' } } as never) as { items: unknown[] };
    expect(todo.items.length).toBeGreaterThan(0);
    const weather = demoLive({ type: 'ha-subscription', kind: 'weather-forecast', forecastType: 'daily', entityId: { type: 'literal', value: 'weather.example' } } as never) as { forecast: unknown[] };
    expect(weather.forecast.length).toBeGreaterThan(0);
  });
});
