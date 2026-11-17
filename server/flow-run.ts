import type { Express } from 'express';
import { z } from 'zod/v4';
import type { Json } from '../src/shared/types';
import { entityRows, evaluatePipeline, pipelineInputsSchema, resolveServiceCall, type FlowContext, type PipelineInputs } from '../src/shared/composition/pipeline';
import { HubRequestError, type LiveEntityHub } from './ha-live';
import { HttpError } from './store';

/**
 * Runs a draft Data Flow against live Home Assistant, for the Studio's Data tab. Read only, by construction:
 * - a service runs only when Home Assistant itself describes it as answering with data and nothing else (`response.optional === false`), and never
 *   from {@link REFUSED_DOMAINS}; any other service is refused before a call is made;
 * - entities and attributes come from the live hub's cache, and a service call goes over the hub's one connection: no second socket, no REST, no polling;
 * - one run has a timeout (the flow's own, 1 to 30 seconds), lists are cut to {@link FLOW_RUN_LIMITS.listItems} items, the answer to
 *   {@link FLOW_RUN_LIMITS.responseBytes}, and at most {@link FLOW_RUN_LIMITS.concurrent} runs are in flight;
 * - the token and Home Assistant's own error text never leave: a failure is one of the sentences below.
 */
export const FLOW_RUN_LIMITS = { concurrent: 3, listItems: 200, responseBytes: 512 * 1024, servicesTtlMs: 60_000, connectMs: 8000 } as const;
/** Domains whose services answer with data but also act (a voice command runs an intent), so no run may call them. */
export const REFUSED_DOMAINS: ReadonlySet<string> = new Set(['conversation', 'homeassistant', 'script', 'shell_command', 'rest_command', 'hassio']);

const clockSchema = z.strictObject({ now: z.string().max(40), utcOffsetMinutes: z.number().int().min(-1440).max(1440) });
const viewerSchema = z.strictObject({ userId: z.string().max(128).optional(), isAdmin: z.boolean().optional(), personEntityId: z.string().max(160).optional() });
/** The body of a run: the draft flow's inputs, and the clock and viewer its operands read (the browser's own, else the server's). */
export const flowRunBodySchema = z.strictObject({ inputs: pipelineInputsSchema, clock: clockSchema.optional(), viewer: viewerSchema.optional() });

/** What a successful run gives the page. */
export interface FlowRunAnswer {
  source: 'live';
  at: string;
  /** What the request returned (cut to the limits): the page runs its own steps on it, so the outline can show each step's result. */
  response: Json;
  /** What the flow gives, run on the server with the same evaluator. */
  output: Json;
  /** The number of rows, when the flow gives a list. */
  items?: number;
  /** True when a list in the answer was cut to the item limit. */
  trimmed?: boolean;
}

const fail = (status: number, code: string, message: string) => new HttpError(status, message, { code });
const FAILURES = {
  offline: () => fail(503, 'not-connected', "Home Assistant isn't connected."),
  dropped: () => fail(503, 'dropped', "Home Assistant's connection dropped. Try again."),
  refused: () => fail(502, 'refused', "Home Assistant couldn't run that. Check what the flow asks for."),
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Cuts every list to `limit` items; says whether it cut any. */
export function cutLists(value: Json, limit: number): { value: Json; cut: boolean } {
  let cut = false;
  const walk = (item: Json): Json => {
    if (Array.isArray(item)) { if (item.length > limit) cut = true; return item.slice(0, limit).map(walk); }
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)]));
    return item;
  };
  return { value: walk(value), cut };
}

/** Whether Home Assistant's description of a service says it only answers with data. */
export function readsOnly(domain: string, service: string, services: unknown): 'reads' | 'changes' | 'unknown' {
  const entry = isRecord(services) && isRecord(services[domain]) ? (services[domain] as Record<string, unknown>)[service] : undefined;
  if (!isRecord(entry)) return 'unknown';
  if (REFUSED_DOMAINS.has(domain)) return 'changes';
  return isRecord(entry.response) && entry.response.optional === false ? 'reads' : 'changes';
}

/** One server's runner: holds the cached service list and the count of runs in flight. */
export class FlowRunner {
  private inFlight = 0;
  private services?: { at: number; value: Promise<unknown> };
  constructor(private readonly hub: LiveEntityHub | undefined, private readonly credentials: readonly string[] = [], private readonly now: () => Date = () => new Date()) {}

  /** Runs a flow. Throws an `HttpError` whose message is the flow's own words. */
  async run(body: unknown): Promise<FlowRunAnswer> {
    const parsed = flowRunBodySchema.safeParse(body);
    if (!parsed.success) throw fail(422, 'unfinished', "This flow isn't finished, so it can't run yet.");
    if (this.inFlight >= FLOW_RUN_LIMITS.concurrent) throw fail(429, 'busy', 'Home Assistant is already answering other runs. Try again in a moment.');
    this.inFlight += 1;
    try { return await this.runOne(parsed.data.inputs, parsed.data.clock, parsed.data.viewer); }
    finally { this.inFlight -= 1; }
  }

  private async runOne(inputs: PipelineInputs, clock: FlowContext['clock'] | undefined, viewer: FlowContext['viewer']): Promise<FlowRunAnswer> {
    const date = this.now();
    const context: FlowContext = { clock: clock ?? { now: new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19), utcOffsetMinutes: -date.getTimezoneOffset() }, viewer };
    const fetched = await this.fetch(inputs, context);
    const { value: response, cut } = cutLists(fetched, FLOW_RUN_LIMITS.listItems);
    const text = JSON.stringify(response);
    if (text.length > FLOW_RUN_LIMITS.responseBytes) throw fail(422, 'too-big', "Home Assistant's answer is too big to draw here. Add a Limit step in Home Assistant or narrow the request.");
    if (this.credentials.some(credential => credential && text.includes(credential))) throw fail(502, 'refused', "Home Assistant couldn't run that. Check what the flow asks for.");
    const result = evaluatePipeline(inputs, response, context);
    if (result.status !== 'ok') throw fail(422, 'over-budget', 'This flow does more work than one run allows. Add a Limit step early.');
    return { source: 'live', at: date.toISOString(), response, output: result.output, ...(Array.isArray(result.output) ? { items: result.output.length } : {}), ...(cut ? { trimmed: true } : {}) };
  }

  /** The request's answer from Home Assistant, as the steps expect it. */
  private async fetch(inputs: PipelineInputs, context: FlowContext): Promise<Json> {
    const request = inputs.request;
    if (request.type === 'none') return null;
    if (request.type === 'entities') {
      const hub = await this.ready();
      return entityRows(request, id => this.held(hub, id));
    }
    if (request.type === 'entity-attribute') {
      const hub = await this.ready();
      const entity = this.held(hub, request.entityId.value);
      if (!entity) throw fail(422, 'no-entity', `Home Assistant has no ${request.entityId.value}.`);
      const found = request.path.reduce<Json | undefined>((at, key) => isRecord(at) ? (at as { [key: string]: Json })[key] : undefined, entity.attributes);
      if (found === undefined) throw fail(422, 'no-attribute', `${request.entityId.value} has no ${request.path.join(' > ')}.`);
      return found;
    }
    if (request.type === 'ha-subscription') {
      const entityId = request.entityId.value;
      const answer = request.kind === 'todo-items'
        ? await this.call('todo', 'get_items', { entity_id: entityId }, {}, 10)
        : await this.call('weather', 'get_forecasts', { entity_id: entityId }, { type: request.forecastType }, 10);
      const own = isRecord(answer) && isRecord(answer[entityId]) ? answer[entityId] as Record<string, Json> : undefined;
      if (!own) throw fail(422, 'no-entity', `Home Assistant has no ${entityId}.`);
      return request.kind === 'todo-items' ? { items: Array.isArray(own.items) ? own.items : [] } : { type: request.forecastType, forecast: Array.isArray(own.forecast) ? own.forecast : [] };
    }
    const call = resolveServiceCall(inputs, context);
    if (!call) throw fail(422, 'over-budget', 'This flow does more work than one run allows. Add a Limit step early.');
    return await this.call(call.domain, call.service, call.target, call.data, request.timeoutSeconds) as Json;
  }

  private held(hub: LiveEntityHub, id: string): { state: string; attributes: { [key: string]: Json } } | undefined {
    const raw = hub.cache.get(id);
    return raw ? { state: raw.state, attributes: raw.attributes as { [key: string]: Json } } : undefined;
  }

  /** The hub, once it holds Home Assistant's states. */
  private async ready(): Promise<LiveEntityHub> {
    const hub = this.hub;
    if (!hub) throw FAILURES.offline();
    if (hub.hasStates) return hub;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { release(); reject(FAILURES.offline()); }, FLOW_RUN_LIMITS.connectMs);
      const release = hub.subscribe(event => { if (event.type === 'changed' || (event.type === 'status' && event.connected && hub.hasStates)) { clearTimeout(timer); release(); resolve(); } });
    });
    return hub;
  }

  private describe(hub: LiveEntityHub): Promise<unknown> {
    const now = Date.now();
    if (!this.services || now - this.services.at > FLOW_RUN_LIMITS.servicesTtlMs) {
      const value = hub.request({ type: 'get_services' }, FLOW_RUN_LIMITS.connectMs);
      this.services = { at: now, value };
      value.catch(() => { if (this.services?.value === value) this.services = undefined; });
    }
    return this.services.value;
  }

  /** One read-only service call with a response. Refuses before calling when Home Assistant does not describe the service as only returning data. */
  private async call(domain: string, service: string, target: Record<string, Json>, data: Record<string, Json>, seconds: number): Promise<unknown> {
    const hub = this.hub;
    if (!hub) throw FAILURES.offline();
    try {
      const kind = readsOnly(domain, service, await this.describe(hub));
      if (kind === 'unknown') throw fail(422, 'unknown-service', `Home Assistant has no ${domain}.${service}.`);
      if (kind === 'changes') throw fail(422, 'can-change-things', `${domain}.${service} can change things in your home, so the Studio won't run it. Paste a sample of its answer instead.`);
      const result = await hub.request({ type: 'call_service', domain, service, service_data: data, ...(Object.keys(target).length ? { target } : {}), return_response: true }, seconds * 1000);
      return isRecord(result) && 'response' in result ? result.response : null;
    } catch (error) {
      if (error instanceof HubRequestError) {
        if (error.reason === 'timeout') throw fail(504, 'timeout', `Home Assistant didn't answer in ${seconds} seconds.`);
        throw FAILURES[error.reason]();
      }
      throw error;
    }
  }
}

/** Adds `POST /native/api/ha/flow-run`. The route sits behind the Studio's sign-in: nothing here checks it again. */
export function registerFlowRun(app: Express, hub: LiveEntityHub | undefined, credentials: readonly string[]): FlowRunner {
  const runner = new FlowRunner(hub, credentials);
  app.post('/native/api/ha/flow-run', async (req, res) => { res.json(await runner.run(req.body)); });
  return runner;
}
