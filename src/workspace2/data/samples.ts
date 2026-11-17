import { useSyncExternalStore } from 'react';
import type { Json } from '../../shared/types';
import {
  entityRows, evaluatePipeline, requestShape, type FlowContext, type PipelineInputs, type RunResult, type Shape,
} from '../../shared/composition/pipeline';
import type { NativeState } from '../../shared/native-state';

/**
 * Samples (studio-pipes D4): the data a flow's editor and the simulator draw. They live beside the draft, in this browser, and are never part
 * of the document, the publication, the export or Edit as JSON. A run is kept as the sample; Hide Values draws kinds only; Clear removes it.
 * Nothing here fetches: only Run asks Home Assistant.
 */

/** The largest sample kept, in bytes of JSON, and the most items kept of each list. */
export const SAMPLE_LIMIT = 256 * 1024;
export const SAMPLE_ITEMS = 50;
/** The `localStorage` key. */
export const SAMPLES_KEY = 'sh-studio.data-samples';

/** One kept sample: the answer, when it was taken and how big it was. */
export interface Sample { json: Json; at: string; bytes: number; trimmed?: { shown: number; of: number } }
interface Stored { samples: Record<string, Sample>; hide: boolean }

const listeners = new Set<() => void>();
let cache: Stored | undefined;
function read(): Stored {
  if (cache) return cache;
  try {
    const value = JSON.parse(localStorage.getItem(SAMPLES_KEY) ?? '{}') as Partial<Stored>;
    cache = { samples: value && typeof value.samples === 'object' && value.samples ? value.samples : {}, hide: value?.hide === true };
  } catch { cache = { samples: {}, hide: false }; }
  return cache;
}
function write(next: Stored) {
  cache = next;
  try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable; the sample then lasts the session */ }
  listeners.forEach(listener => listener());
}
/** Forgets the in-memory copy (tests). */
export function resetSamples(): void { cache = undefined; listeners.forEach(listener => listener()); }

/** Cuts every list to its first {@link SAMPLE_ITEMS} items and says what it cut. */
export function trimSample(json: Json): { json: Json; trimmed?: { shown: number; of: number } } {
  let biggest = 0, kept = 0;
  const cut = (value: Json): Json => {
    if (Array.isArray(value)) {
      if (value.length > SAMPLE_ITEMS) { biggest = Math.max(biggest, value.length); kept = SAMPLE_ITEMS; }
      return value.slice(0, SAMPLE_ITEMS).map(cut);
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cut(item)]));
    return value;
  };
  const out = cut(json);
  return { json: out, trimmed: biggest ? { shown: kept, of: biggest } : undefined };
}

/** Keeps `json` as the sample of a flow, trimmed. Returns false when it is over the size limit even then. */
export function keepSample(flowId: string, json: Json, at: Date = new Date()): boolean {
  const { json: cut, trimmed } = trimSample(json);
  const bytes = new TextEncoder().encode(JSON.stringify(cut)).length;
  if (bytes > SAMPLE_LIMIT) return false;
  const state = read();
  write({ ...state, samples: { ...state.samples, [flowId]: { json: cut, at: at.toISOString(), bytes, ...(trimmed ? { trimmed } : {}) } } });
  return true;
}
/** Removes a flow's sample. */
export function clearSample(flowId: string): void {
  const state = read();
  if (!(flowId in state.samples)) return;
  const { [flowId]: _gone, ...rest } = state.samples;
  void _gone;
  write({ ...state, samples: rest });
}
/** Sets Hide Values, remembered per browser. */
export function setHideValues(hide: boolean): void { write({ ...read(), hide }); }
/** A flow's sample, and whether values are hidden, re-reading when either changes. */
export function useSample(flowId: string): { sample?: Sample; hide: boolean } {
  const state = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, read);
  return { sample: state.samples[flowId], hide: state.hide };
}
/** Reads without subscribing (the pure parts, tests). */
export const sampleOf = (flowId: string): Sample | undefined => read().samples[flowId];

// MARK: Demo data

/** A made-up answer of a shape, so a flow draws something before Home Assistant has answered. Never your data. */
export function demoFromShape(shape: Shape, today = '2026-11-12', depth = 0): Json {
  switch (shape.kind) {
    case 'never': case 'any': case 'null': return null;
    case 'boolean': return true;
    case 'number': return shape.integer ? 3 : 21.5;
    case 'string': return shape.format === 'date' ? today : shape.format === 'date-time' ? `${today}T09:00:00` : shape.format === 'entity-id' ? 'sensor.example_sensor'
      : shape.format === 'url' ? 'https://example.com' : shape.format === 'numeric' ? '12' : shape.enum?.[0] ?? 'Sample';
    case 'array': return depth > 4 ? [] : [0, 1, 2].map(at => demoItem(shape.of, at, today, depth));
    case 'object': return Object.fromEntries(Object.entries(shape.fields).filter(([, field]) => !field.optional || depth < 3).map(([name, field]) => [name, demoFromShape(field.shape, today, depth + 1)]));
    case 'union': return demoFromShape(shape.of.find(member => member.kind !== 'null') ?? shape.of[0], today, depth);
  }
}
const demoItem = (shape: Shape, at: number, today: string, depth: number): Json => {
  const value = demoFromShape(shape, today, depth + 1);
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' && item === 'Sample' ? `Sample ${at + 1}` : item]));
  return value;
};
const addDays = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const CHORES = ['Take Out the Trash', 'Water the Plants', 'Change the Furnace Filter', 'Wipe the Counters', 'Sweep the Porch', 'Wash the Towels'];
/** Made-up chores and a made-up forecast for the live lists. */
export function demoLive(request: Extract<PipelineInputs['request'], { type: 'ha-subscription' }>, today = '2026-11-12'): Json {
  if (request.kind === 'todo-items') return { items: CHORES.map((summary, at) => ({ uid: `demo-${at + 1}`, summary, status: at === 5 ? 'completed' : 'needs_action', due: addDays(today, at - 3), description: null })) };
  const conditions = ['sunny', 'cloudy', 'rainy', 'sunny', 'partlycloudy'];
  return { type: request.forecastType, forecast: conditions.map((condition, at) => ({ datetime: `${addDays(today, at)}T12:00:00`, condition, temperature: 60 + at * 2, templow: 45 + at })) };
}

// MARK: Running over what is held

/** What Home Assistant holds about an entity as a flow reads it: the state and the attributes by their snake-case names. */
export function heldEntity(state: NativeState | undefined): { state: string; attributes: { [key: string]: Json } } | undefined {
  if (!state) return undefined;
  const attributes: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(state)) {
    if (['entityId', 'state', 'name'].includes(key) || value === undefined || typeof value === 'function') continue;
    attributes[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] = value as Json;
  }
  return { state: state.state, attributes };
}

/** Where the data a flow draws came from: the house (`live`), a kept run (`sample`), made-up data (`demo`), or nothing yet. */
export type DataSource = 'live' | 'sample' | 'demo' | 'none';
/** What a flow gives over some data. */
export interface FlowData { source: DataSource; response?: Json; result?: RunResult; items?: number }

/**
 * The data a flow draws now and what its steps make of it. A group of entities and an attribute read the house; a service and a live list draw what the server's live run returned (`live`), else the kept run, else demo data. Hide Values draws demo data in place of a sample.
 */
export function flowData(inputs: PipelineInputs, held: { states?: ReadonlyMap<string, NativeState>; sample?: Sample; hide?: boolean; /** What the server's read-only run returned for a service or a live list. */ live?: Json; context: FlowContext }): FlowData {
  const { request } = inputs;
  let response: Json | undefined, source: DataSource = 'none';
  if (request.type === 'none') { source = 'live'; response = null; }
  else if (request.type === 'entities') {
    if (held.states && held.states.size > 0) { source = 'live'; response = entityRows(request, id => heldEntity(held.states!.get(id))); }
    else { source = 'demo'; response = demoFromShape(requestShape(request), held.context.clock.now.slice(0, 10)); }
  } else if (request.type === 'entity-attribute' && held.states?.get(request.entityId.value)) {
    const entity = heldEntity(held.states.get(request.entityId.value))!;
    const value = request.path.reduce<Json | undefined>((at, key) => at && typeof at === 'object' && !Array.isArray(at) ? (at as { [key: string]: Json })[key] : undefined, entity.attributes);
    if (value !== undefined) { source = 'live'; response = value; }
  }
  if (response === undefined && held.live !== undefined && !held.hide && (request.type === 'service-response' || request.type === 'ha-subscription')) { source = 'live'; response = held.live; }
  if (response === undefined && held.sample && !held.hide) { source = 'sample'; response = held.sample.json; }
  if (response === undefined) {
    const today = held.context.clock.now.slice(0, 10);
    if (request.type === 'ha-subscription') { source = 'demo'; response = demoLive(request, today); }
    else if (request.type === 'service-response' || request.type === 'entity-attribute') { source = 'demo'; response = demoFromShape(request.responseShape, today); }
  }
  if (response === undefined) return { source: 'none' };
  const result = evaluatePipeline(inputs, response, held.context);
  const items = result.status === 'ok' && Array.isArray(result.output) ? result.output.length : undefined;
  return { source, response, result, items };
}

/** The data after step `index` (the answer itself for `-1`), so the outline can show one value from each field at that point. */
export function valueAfterStep(inputs: PipelineInputs, response: Json, index: number, context: FlowContext): Json | undefined {
  const result = evaluatePipeline({ ...inputs, steps: inputs.steps.slice(0, index + 1) }, response, context);
  return result.status === 'ok' ? result.value : undefined;
}
