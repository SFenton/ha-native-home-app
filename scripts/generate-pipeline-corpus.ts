/**
 * Writes the `pipeline-*` cases of the shared publication corpus and the Data Flow evaluation corpus. Accepted and rejected envelopes cover
 * `sh.pipeline@1` and `sh.pipeline-operands@1` (the data-source model, its request kinds, refresh, steps, output and schema, and the nodes and
 * reads that name a flow); each case is the shared first-slice fixture with its third page's body replaced and the flows added, so the files stay small.
 * The evaluation cases (`contract/corpus/pipelines/*.json`) are data, steps and the exact answer, run by TypeScript now and by Swift later.
 *
 *   tsx scripts/generate-pipeline-corpus.ts   # rewrites contract/corpus/reject/{pending-,}pipeline-*.json, their index entries and contract/corpus/pipelines/*.json
 *
 * Accepted capability lists come from the Studio compiler; a rejected case records the Studio's first issue. The evaluation cases carry
 * hand-written expectations: the generator writes the flows and the inputs, never the answers. Run `scripts/app-corpus-check/run.sh` afterwards when the app
 * has the capability. This file owns only `pipeline-*` and `pipelines/`.
 */
import { wgFlowPipelines } from './wgflow-corpus';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';
import {
  arrayOf, inferShapeFromSamples, INTEGER, newFacts, NUMBER, objectOf, orNull, STRING, text, todoItemShape, typeSteps, withoutNull, type Shape,
} from '../src/shared/composition/pipeline';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const PREFIX = 'pipeline-';

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const item = (...segments: string[]): J => ({ type: 'item', path: segments });
const param = (name: string): J => ({ type: 'param', name });
const today: J = { type: 'clock', part: 'today' };
const days = (from: J, to: J): J => ({ type: 'date', op: 'days-between', from, to });
const format = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const cases$ = (of: J, cases: [string | number | boolean, J][], otherwise: J): J => ({ type: 'map', of, cases: cases.map(([equals, then]) => ({ equals, then })), otherwise });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const all = (...of: J[]): J => ({ type: 'all', of });
const exists = (value: J): J => ({ type: 'exists', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const viewer = (field = 'userId'): J => ({ type: 'viewer', field });
const step = (id: string, op: string, rest: J = {}): J => ({ id, op, ...rest });
const refresh = (on: string[], rest: J = {}): J => ({ on, staleAfterSeconds: 300, ...rest });
const entityIds = (...ids: string[]): J[] => ids.map(lit);
const source = (id: string, inputs: J): J => ({ id, kind: 'model', model: 'pipeline@1', inputs });
const rowNode = (providerId: string, id = 'rows'): J => ({
  id, title: 'List', type: 'row-collection', layout: { span: 1 },
  props: { providerId, loadingText: 'Loading', emptyText: 'Nothing here', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date' },
});
const collectionNode = (providerId: string, template = 'rows', id = 'list'): J => ({
  id, title: 'List', type: 'collection', layout: { span: 1 }, props: { providerId, template, loadingText: 'Loading', emptyText: 'Nothing here', pullToRefresh: true },
});
const textNode = (id: string, value: J): J => ({ id, title: id, type: 'text', layout: { span: 1 }, props: { value, style: 'body', unavailableText: 'None' } });

/** The shape of a row object the `map` steps below build. */
const rowFields = (fields: Record<string, Shape>) => arrayOf(objectOf(fields));

// MARK: The owner's flows (demo entity ids only)
/** Overdue Chores: a live to-do subscription, so no refresh. */
const overdueChores = (): J => ({
  title: 'Overdue Chores', parameters: [],
  request: { type: 'ha-subscription', kind: 'todo-items', entityId: lit('todo.demo_chores') },
  steps: [
    step('items', 'get', { path: ['items'] }),
    step('late', 'filter', { where: all(cmp('eq', item('status'), lit('needs_action')), exists(item('due')), cmp('above', days(item('due'), today), lit(0))) }),
    step('oldest', 'sort', { by: [{ value: item('due'), direction: 'ascending', kind: 'date' }] }),
    step('shape', 'map', { fields: { id: item('uid'), title: item('summary'), late: days(item('due'), today) } }),
  ],
  output: {
    kind: 'rows', max: 50,
    row: {
      id: item('id'), title: item('title'),
      subtitle: cases$(item('late'), [[1, lit('1 day overdue')]], format('{days} days overdue', { days: item('late') })),
    },
  },
  schema: rowFields({ id: STRING, title: STRING, late: orNull(INTEGER) }),
});
/** Upcoming Chores: a service with a response, run again when either list changes. */
const upcomingChores = (): J => ({
  title: 'Upcoming Chores',
  parameters: [{
    name: 'list', type: 'entity-id',
    value: cases$(viewer(), [['user-1', lit('todo.demo_chores_alex')]], lit('todo.demo_chores')),
  }],
  request: {
    type: 'service-response', domain: 'todo', service: 'get_items', target: { entity_id: param('list') },
    data: { type: 'object', fields: { status: { type: 'list', items: [lit('needs_action')] } } }, timeoutSeconds: 10,
    responseShape: objectOf({ 'todo.demo_chores': objectOf({ items: arrayOf(todoItemShape) }), 'todo.demo_chores_alex': objectOf({ items: arrayOf(todoItemShape) }) },
      ['todo.demo_chores', 'todo.demo_chores_alex']),
  },
  steps: [
    step('entry', 'select-key', { key: param('list') }),
    step('items', 'get', { path: ['items'] }),
    step('soon', 'filter', { where: all(exists(item('due')), cmp('above', days(today, item('due')), lit(-1)), cmp('below', days(today, item('due')), lit(8))) }),
    step('soonest', 'sort', { by: [{ value: item('due'), direction: 'ascending', kind: 'date' }, { value: item('summary'), direction: 'ascending', kind: 'text' }] }),
    step('few', 'limit', { count: 20 }),
    step('shape', 'map', { fields: { id: item('uid'), title: item('summary'), inDays: days(today, item('due')) } }),
  ],
  output: {
    kind: 'rows', max: 20,
    row: {
      id: item('id'), title: item('title'),
      subtitle: cases$(item('inDays'), [[0, lit('Due today')], [1, lit('Due tomorrow')]], format('Due in {days} days', { days: item('inDays') })),
    },
  },
  schema: rowFields({ id: STRING, title: STRING, inDays: orNull(INTEGER) }),
  refresh: refresh(['open', 'manual', 'entity-change'], { entityIds: entityIds('todo.demo_chores', 'todo.demo_chores_alex') }),
});
/** Expired Food: the `expired_list` attribute of a sensor the app already holds. */
const expiredFood = (): J => ({
  title: 'Expired Food', parameters: [],
  request: {
    type: 'entity-attribute', entityId: lit('sensor.demo_expired_food'), path: ['expired_list'],
    responseShape: arrayOf(objectOf({ name: STRING, expiry_date: text('date'), location: STRING, quantity: INTEGER }, ['quantity'])),
  },
  steps: [
    step('expired', 'filter', { where: cmp('above', days(item('expiry_date'), today), lit(0)) }),
    step('oldest', 'sort', { by: [{ value: item('expiry_date'), direction: 'ascending', kind: 'date' }, { value: item('name'), direction: 'ascending', kind: 'text' }] }),
    step('shape', 'map', {
      fields: {
        id: format('{name}-{date}', { name: item('name'), date: item('expiry_date') }), title: item('name'), place: item('location'),
        ago: days(item('expiry_date'), today),
      },
    }),
  ],
  output: { kind: 'rows', max: 100, row: { id: item('id'), title: item('title'), subtitle: item('place'), value: format('{days}d', { days: item('ago') }) } },
  schema: rowFields({ id: STRING, title: STRING, place: STRING, ago: orNull(INTEGER) }),
  refresh: refresh(['open', 'manual', 'entity-change'], { staleAfterSeconds: 600 }),
});
/** The next five days, from a live weather subscription. */
const forecastDays = (): J => ({
  title: 'Forecast', parameters: [],
  request: { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'daily' },
  steps: [
    step('forecast', 'get', { path: ['forecast'] }),
    step('week', 'limit', { count: 5 }),
    step('shape', 'map', { fields: { id: item('datetime'), outlook: cases$(item('condition'), [['sunny', lit('Sunny')], ['rainy', lit('Rain')]], lit('Mixed')), high: item('temperature') } }),
  ],
  output: { kind: 'rows', max: 5, row: { id: item('id'), title: item('outlook'), value: format('{high}°', { high: item('high') }, { high: { number: { maximumFractionDigits: 0 } } }) } },
  schema: rowFields({ id: text('date-time'), outlook: orNull(STRING), high: orNull(NUMBER) }),
});
/** A scalar: the title of the oldest open chore. */
const nextChoreTitle = (): J => ({
  title: 'Next Chore', parameters: [],
  request: { type: 'ha-subscription', kind: 'todo-items', entityId: lit('todo.demo_chores') },
  steps: [
    step('items', 'get', { path: ['items'] }),
    step('open', 'filter', { where: cmp('eq', item('status'), lit('needs_action')) }),
    step('oldest', 'sort', { by: [{ value: item('due'), direction: 'ascending', kind: 'date' }] }),
    step('one', 'first'),
    step('name', 'get', { path: ['summary'] }),
  ],
  output: { kind: 'scalar' }, schema: STRING,
});
/** A record: the oldest open chore with its lateness. */
const nextChore = (): J => ({
  title: 'Next Chore Details', parameters: [],
  request: { type: 'ha-subscription', kind: 'todo-items', entityId: lit('todo.demo_chores') },
  steps: [
    step('items', 'get', { path: ['items'] }),
    step('open', 'filter', { where: cmp('eq', item('status'), lit('needs_action')) }),
    step('oldest', 'sort', { by: [{ value: item('due'), direction: 'ascending', kind: 'date' }] }),
    step('one', 'first'),
    step('shape', 'map', { fields: { title: item('summary'), late: days(item('due'), today) } }),
  ],
  output: { kind: 'record' }, schema: objectOf({ title: STRING, late: orNull(INTEGER) }),
});
/** No operand at all, so no operand capability: read one field. */
const attributeCount = (): J => ({
  title: 'Spice Notes', parameters: [],
  request: { type: 'entity-attribute', entityId: lit('sensor.demo_pantry'), path: ['summary'], responseShape: objectOf({ headline: STRING }) },
  steps: [step('headline', 'get', { path: ['headline'] })],
  output: { kind: 'scalar' }, schema: STRING, refresh: refresh(['entity-change']),
});
const pantryShape = arrayOf(objectOf({ name: STRING, stock: arrayOf(objectOf({ lot: STRING, qty: NUMBER }, ['qty'])) }));
/** Every remaining step: flatten, default, unique, group, count. */
const lotCount = (): J => ({
  title: 'Lots', parameters: [],
  request: { type: 'entity-attribute', entityId: lit('sensor.demo_pantry'), path: ['inventory'], responseShape: pantryShape },
  steps: [
    step('lots', 'flatten', { path: ['stock'] }),
    step('quantities', 'default', { path: ['qty'], value: lit(0) }),
    step('distinct', 'unique', { by: item('lot') }),
    step('by-lot', 'group', { by: item('lot') }),
    step('how-many', 'count'),
  ],
  output: { kind: 'scalar' }, schema: INTEGER, refresh: refresh(['open']),
});
const totalStock = (): J => ({
  title: 'Total Stock', parameters: [],
  request: { type: 'entity-attribute', entityId: lit('sensor.demo_pantry'), path: ['inventory'], responseShape: pantryShape },
  steps: [step('lots', 'flatten', { path: ['stock'] }), step('total', 'sum', { value: item('qty') })],
  output: { kind: 'scalar' }, schema: NUMBER, refresh: refresh(['open', 'manual']),
});
/** A parameter that reads another source, one that builds on a parameter, and a filter on both. */
const parametersFlow = (): J => ({
  title: 'Search', parameters: [
    { name: 'needle', type: 'string', value: read('source-entity', ['state']) },
    { name: 'label', type: 'string', value: format('Matches for {needle}', { needle: param('needle') }) },
  ],
  request: { type: 'entity-attribute', entityId: lit('sensor.demo_pantry'), path: ['inventory'], responseShape: pantryShape },
  steps: [step('hits', 'filter', { where: cmp('eq', item('name'), param('needle')) }), step('shape', 'map', { fields: { id: item('name'), title: param('label') } })],
  output: { kind: 'rows', max: 10, row: { id: item('id'), title: item('title') } },
  schema: rowFields({ id: STRING, title: orNull(STRING) }), refresh: refresh(['open', 'manual', 'entity-change']),
});

/** How many of a set of lights are on: an `entities` request, a filter and a count. No refresh: the flow runs when one of them changes. */
const lightsOn = (): J => ({
  title: 'Lights On', parameters: [],
  request: { type: 'entities', entityIds: entityIds('light.demo_study', 'light.demo_den', 'light.demo_hall'), attributes: ['brightness'] },
  steps: [step('on', 'filter', { where: cmp('eq', item('state'), lit('on')) }), step('how-many', 'count')],
  output: { kind: 'scalar' }, schema: INTEGER,
});
/** A scalar from parameters only: a rule that words a count. */
const countWords = (): J => ({
  title: 'Chore Count Words', parameters: [{ name: 'n', type: 'number', value: read('source-entity', ['attributes', 'chores'], 'number') }],
  request: { type: 'none', value: choose([[cmp('eq', param('n'), lit(1)), lit('1 chore')], [cmp('eq', param('n'), lit(0)), lit('No chores')]], format('{n} chores', { n: param('n') })) },
  steps: [], output: { kind: 'scalar' }, schema: STRING,
});

// MARK: Cases
interface Case { name: string; outcome: 'accept' | 'reject'; note: string; sources: J[]; components?: J[]; tweak?: (envelope: J) => void }
const cases: Case[] = [];
const accept = (name: string, note: string, sources: J[], more: Partial<Case> = {}) => cases.push({ name: PREFIX + name, outcome: 'accept', note, sources, ...more });
const reject = (name: string, note: string, sources: J[], more: Partial<Case> = {}) => cases.push({ name: PREFIX + name, outcome: 'reject', note, sources, ...more });
/** A flow with `edit` applied to a copy of `make()`'s inputs. */
const edited = (make: () => J, edit: (inputs: J) => void, id = 'flow'): J => { const inputs = make(); edit(inputs); return source(id, inputs); };

// MARK: Accepted
accept('overdue-chores', 'Overdue Chores over a live to-do subscription: no refresh, rows with a days-late subtitle, shown by a collection with the rows template.',
  [source('overdue', overdueChores())], { components: [collectionNode('overdue')] });
accept('upcoming-chores', 'Upcoming Chores over a service with a response: a parameter from the viewer, an entity-keyed answer, refresh on open, pull to refresh and either list changing.',
  [source('upcoming', upcomingChores())], { components: [rowNode('upcoming')] });
accept('expired-food', 'Expired Food over an entity attribute the app already holds: the entity is watched implicitly, so refresh names none.',
  [source('expired', expiredFood())], { components: [rowNode('expired')] });
accept('forecast-live', 'A live weather forecast: the closed subscription list, a forecast type, no refresh.',
  [source('forecast', forecastDays())], { components: [collectionNode('forecast')] });
accept('scalar-read', 'A scalar flow read by a text node through the path ["value"].',
  [source('next-title', nextChoreTitle())], { components: [textNode('next', read('next-title', ['value']))] });
accept('record-read', 'A record flow read by field name: a text node binds the title field.',
  [source('next-chore', nextChore())], { components: [textNode('next', read('next-chore', ['title']))] });
accept('without-operands', 'A flow that uses none of the four flow operands needs only sh.pipeline@1.', [source('notes', attributeCount())]);
accept('every-step', 'flatten, default, unique, group and count in one flow.', [source('lots', lotCount())]);
accept('sum', 'sum over a flattened list.', [source('stock', totalStock())]);
accept('parameters', 'A parameter that reads another source, a parameter built on another parameter, and a filter on them.',
  [source('search', parametersFlow())], { components: [rowNode('search')] });
accept('source-without-node', 'A flow no node uses is accepted; it costs nothing.', [source('unused', expiredFood())]);
accept('node-without-source', 'A collection naming a provider no source defines still compiles: the app has a compiled provider by that name or shows nothing.',
  [], { components: [collectionNode('compiled-provider')] });
accept('todo-get-items-service', 'A service request for get_items of the to-do domain is accepted; the Studio will later suggest the live todo-items source for it.',
  [source('upcoming', upcomingChores())]);

accept('entities-count', 'Lights On: an entities request over three literal entities with one attribute, a filter on state and a count; no refresh.',
  [source('lights-on', lightsOn())], { components: [textNode('on', read('lights-on', ['value'], 'number'))].map(node => ({ ...node, props: { ...node.props, value: { type: 'expr', value: read('lights-on', ['value'], 'number') } } })) });
accept('none-rule', 'A none request: a scalar from a parameter only, worded by a rule (choose), so the flow needs sh.rules@1.',
  [source('chore-words', countWords())], { components: [textNode('words', read('chore-words', ['value']))] });
accept('choose-in-step', 'A rule inside a step: choose builds a field of each row.',
  [edited(upcomingChores, inputs => { inputs.steps.push(step('tag', 'map', { fields: { id: item('id'), title: choose([[cmp('eq', item('title'), lit('Water plants')), lit('Plants')]], item('title')) } })); inputs.output.row = { id: item('id'), title: item('title') }; inputs.schema = rowFields({ id: orNull(STRING), title: orNull(STRING) }); })]);

// MARK: Rejected (structure)
reject('unknown-input', 'A flow takes the fields of its schema and no others.', [edited(expiredFood, inputs => { inputs.colour = 'red'; })]);
reject('request-with-url', 'A request never carries a URL: it names a Home Assistant service, and Home Assistant holds the key.',
  [edited(expiredFood, inputs => { inputs.request.url = 'https://example.invalid/feed'; })]);
reject('request-with-headers', 'A request never carries headers or a key.', [edited(upcomingChores, inputs => { inputs.request.headers = { Authorization: 'Bearer demo' }; })]);
reject('unknown-request-type', 'The request kinds are a service response, an entity attribute and a subscription.', [edited(expiredFood, inputs => { inputs.request.type = 'http'; })]);
reject('unknown-subscription-kind', 'A subscription kind is from a closed list of two: an app must not send any other websocket command.',
  [edited(overdueChores, inputs => { inputs.request.kind = 'camera-stream'; })]);
reject('todo-subscription-with-forecast-type', 'A to-do subscription takes no forecast type.', [edited(overdueChores, inputs => { inputs.request.forecastType = 'daily'; })]);
reject('weather-subscription-without-forecast-type', 'A forecast subscription names its forecast type.', [edited(forecastDays, inputs => { delete inputs.request.forecastType; })]);
reject('weather-forecast-type-unknown', 'The forecast types are daily, hourly and twice_daily.', [edited(forecastDays, inputs => { inputs.request.forecastType = 'weekly'; })]);
reject('live-with-refresh', 'A live source takes no refresh: its steps run again on every push.', [edited(overdueChores, inputs => { inputs.refresh = refresh(['open']); })]);
reject('live-todo-entity-not-a-todo', 'A to-do subscription names a to-do entity.', [edited(overdueChores, inputs => { inputs.request.entityId = lit('light.demo_lamp'); })]);
reject('live-weather-entity-not-weather', 'A forecast subscription names a weather entity.', [edited(forecastDays, inputs => { inputs.request.entityId = lit('sensor.demo_outdoor'); })]);
reject('refresh-missing', 'A service or an attribute says when it runs again.', [edited(expiredFood, inputs => { delete inputs.refresh; })]);
reject('refresh-interval', 'There is no timer: refresh is open, manual and entity-change.', [edited(expiredFood, inputs => { inputs.refresh.on = ['interval']; })]);
reject('refresh-entity-change-without-ids', 'A service that refreshes on entity change names what to watch.', [edited(upcomingChores, inputs => { delete inputs.refresh.entityIds; })]);
reject('refresh-ids-without-entity-change', 'Watched entities mean nothing without the entity-change trigger.', [edited(upcomingChores, inputs => { inputs.refresh.on = ['open']; })]);
reject('refresh-too-many-entities', 'A flow watches at most 8 entities.',
  [edited(upcomingChores, inputs => { inputs.refresh.entityIds = entityIds(...Array.from({ length: 9 }, (_, index) => `todo.demo_list_${index}`)); })]);
reject('refresh-attribute-with-entities', 'An attribute watches its own entity, so it names none.', [edited(expiredFood, inputs => { inputs.refresh.entityIds = entityIds('sensor.demo_other'); })]);
reject('refresh-duplicate-trigger', 'A trigger is listed once.', [edited(expiredFood, inputs => { inputs.refresh.on = ['open', 'open']; })]);
reject('refresh-stale-too-soon', 'A flow is not out of date sooner than 30 seconds.', [edited(expiredFood, inputs => { inputs.refresh.staleAfterSeconds = 10; })]);
reject('refresh-entity-malformed', 'A watched entity has the form domain.object.', [edited(upcomingChores, inputs => { inputs.refresh.entityIds = entityIds('Todo Chores'); })]);
reject('entities-with-refresh', 'An entities flow runs when an observed entity changes: it takes no refresh.', [edited(lightsOn, inputs => { inputs.refresh = refresh(['open']); })]);
reject('entities-duplicate', 'An entity is listed once.', [edited(lightsOn, inputs => { inputs.request.entityIds = entityIds('light.demo_study', 'light.demo_study'); })]);
reject('entities-over-64', 'An entities request lists at most 64 entities.', [edited(lightsOn, inputs => { inputs.request.entityIds = entityIds(...Array.from({ length: 65 }, (_, index) => `light.demo_${index}`)); })]);
reject('entities-none-listed', 'An entities request lists at least one entity.', [edited(lightsOn, inputs => { inputs.request.entityIds = []; })]);
reject('entities-over-8-attributes', 'An entities request names at most 8 attributes.', [edited(lightsOn, inputs => { inputs.request.attributes = Array.from({ length: 9 }, (_, index) => `a${index}`); })]);
reject('entities-attribute-named-state', 'A row already has entityId and state: an attribute cannot take either name.', [edited(lightsOn, inputs => { inputs.request.attributes = ['state']; })]);
reject('entities-entity-malformed', 'A listed entity has the form domain.object.', [edited(lightsOn, inputs => { inputs.request.entityIds = entityIds('Study Light'); })]);
reject('none-with-refresh', 'A none flow has no data to refresh.', [edited(countWords, inputs => { inputs.refresh = refresh(['open']); })]);
reject('none-with-item', 'A none flow has no item: its value reads parameters, the viewer and the clock.', [edited(countWords, inputs => { inputs.request.value = item('x'); })]);
reject('none-with-read', 'A none value reads a parameter, never another source directly.', [edited(countWords, inputs => { inputs.request.value = read('source-entity', ['state']); })]);
reject('choose-branch-kinds-differ', 'The branches of a rule give one kind: text and a number are refused.',
  [edited(countWords, inputs => { inputs.request.value = choose([[cmp('eq', param('n'), lit(1)), lit('one')]], lit(3)); })]);
reject('choose-without-otherwise', 'A rule always has an otherwise.',
  [edited(countWords, inputs => { inputs.request.value = { type: 'choose', cases: [{ when: cmp('eq', param('n'), lit(1)), then: lit('one') }] }; })]);
reject('choose-over-16-cases', 'A rule has at most 16 cases.',
  [edited(countWords, inputs => { inputs.request.value = choose(Array.from({ length: 17 }, (_, index) => [cmp('eq', param('n'), lit(index)), lit(`${index}`)] as [J, J]), lit('x')); })]);
reject('control-operand', 'The control value exists only on a bound control: a flow refuses it.', [edited(countWords, inputs => { inputs.request.value = { type: 'control' }; })]);
reject('legacy-state-leaf-in-filter', 'A flow condition compares operands: the document leaves that read a source by name are refused.',
  [edited(expiredFood, inputs => { inputs.steps[1] = step('flagged', 'filter', { where: { type: 'state', sourceId: 'source-entity', path: ['state'], in: ['on'] } }); })]);
reject('timeout-too-long', 'A request waits at most 30 seconds.', [edited(upcomingChores, inputs => { inputs.request.timeoutSeconds = 31; })]);
reject('too-many-parameters', 'A flow declares at most 8 parameters.',
  [edited(expiredFood, inputs => { inputs.parameters = Array.from({ length: 9 }, (_, index) => ({ name: `p${index}`, type: 'string', value: lit('x') })); })]);
reject('too-many-steps', 'A flow has at most 32 steps.',
  [edited(expiredFood, inputs => { inputs.steps = [...inputs.steps, ...Array.from({ length: 30 }, (_, index) => step(`more-${index}`, 'limit', { count: 100 }))]; })]);
reject('limit-count-zero', 'A limit keeps at least one item.', [edited(upcomingChores, inputs => { inputs.steps[4].count = 0; })]);
reject('rows-max-over-100', 'A list shows at most 100 rows.', [edited(expiredFood, inputs => { inputs.output.max = 101; })]);
reject('too-many-pipelines', 'A document has at most 128 flows.', Array.from({ length: 129 }, (_, index) => source(`flow-${index}`, expiredFood())));

// MARK: Rejected (parameters and operands)
reject('parameter-duplicate-name', 'A parameter name is declared once.', [edited(parametersFlow, inputs => { inputs.parameters[1].name = 'needle'; })]);
reject('parameter-unknown-reference', 'A param operand names a declared parameter.', [edited(upcomingChores, inputs => { inputs.request.target.entity_id = param('ghost'); })]);
reject('parameter-cycle', 'Parameters are acyclic: two that build on each other cannot be evaluated.',
  [edited(parametersFlow, inputs => { inputs.parameters = [{ name: 'a', type: 'string', value: param('b') }, { name: 'b', type: 'string', value: param('a') }]; inputs.steps = []; inputs.output = { kind: 'record' }; inputs.schema = objectOf({}); inputs.request.responseShape = objectOf({}); })]);
reject('parameter-self-reference', 'A parameter cannot read itself.', [edited(parametersFlow, inputs => { inputs.parameters[0].value = param('needle'); })]);
reject('parameter-type-mismatch', 'A parameter\'s value is of its declared kind.', [edited(parametersFlow, inputs => { inputs.parameters[0].type = 'number'; })]);
reject('parameter-entity-literal-malformed', 'An entity-id parameter holds an entity id.', [edited(upcomingChores, inputs => { inputs.parameters[0].value = lit('Todo Chores'); })]);
reject('item-in-parameter', 'A parameter is evaluated before any item exists.', [edited(parametersFlow, inputs => { inputs.parameters[0].value = item('name'); })]);
reject('item-in-request', 'A request is made before any item exists.', [edited(upcomingChores, inputs => { inputs.request.data.fields.status = item('status'); })]);
reject('read-in-step', 'A step reads only the flow\'s data and parameters; another source is read through a parameter.',
  [edited(expiredFood, inputs => { inputs.steps[0].where.right = read('source-entity', ['state'], 'number'); })]);
reject('viewer-in-step', 'A step reads the viewer through a parameter, never directly.', [edited(overdueChores, inputs => { inputs.steps[1].where.of[0].right = viewer(); })]);
reject('read-unknown-source', 'A parameter reads a source the document defines.', [edited(parametersFlow, inputs => { inputs.parameters[0].value = read('ghost', ['state']); })]);
reject('flows-read-each-other', 'A parameter that reads another flow, which reads this one back, cannot be evaluated.',
  [source('first', { ...nextChore(), parameters: [{ name: 'p', type: 'string', value: read('second', ['title']) }] }),
    source('second', { ...nextChore(), parameters: [{ name: 'p', type: 'string', value: read('first', ['title']) }] })]);

// MARK: Rejected (request)
reject('target-entity-malformed', 'A literal target entity has the form domain.object.', [edited(upcomingChores, inputs => { inputs.request.target.entity_id = lit('Todo Chores'); })]);
reject('target-key-also-in-data', 'A target key is not repeated in the data.', [edited(upcomingChores, inputs => { inputs.request.data.fields.entity_id = lit('todo.demo_chores'); })]);
reject('attribute-path-index', 'A path cannot index a list: no segment is all digits.', [edited(expiredFood, inputs => { inputs.request.path = ['expired_list', '0']; })]);
reject('response-shape-too-deep', 'A shape is at most 6 levels deep.', [edited(expiredFood, inputs => {
  let shape: Shape = STRING;
  for (let level = 0; level < 7; level++) shape = arrayOf(shape);
  inputs.request.responseShape = shape;
})]);

// MARK: Rejected (steps)
reject('step-duplicate-id', 'A step id is used once.', [edited(expiredFood, inputs => { inputs.steps[1].id = inputs.steps[0].id; })]);
reject('unknown-step-op', 'The step list is closed.', [edited(expiredFood, inputs => { inputs.steps[0] = step('regex', 'regex', { pattern: '.*' }); })]);
reject('get-unknown-field', 'A get names a field the data has.', [edited(overdueChores, inputs => { inputs.steps[0].path = ['entries']; })]);
reject('filter-on-a-record', 'A filter needs a list.', [edited(overdueChores, inputs => { inputs.steps = [inputs.steps[1]]; })]);
reject('filter-field-unknown', 'An item operand names a field the items have.', [edited(overdueChores, inputs => { inputs.steps[1].where.of[0].left = item('state'); })]);
reject('compare-kinds-differ', 'eq compares values of a kind in common.', [edited(overdueChores, inputs => { inputs.steps[1].where.of[0].right = lit(5); })]);
reject('above-on-text', 'above compares numbers.', [edited(overdueChores, inputs => { inputs.steps[1].where.of[2].left = item('summary'); })]);
reject('sort-number-on-text', 'A number sort key is a number.', [edited(overdueChores, inputs => { inputs.steps[2].by[0] = { value: item('summary'), direction: 'ascending', kind: 'number' }; })]);
reject('sum-of-text', 'sum adds numbers.', [edited(totalStock, inputs => { inputs.steps[1].value = item('lot'); })]);
reject('select-key-unknown', 'A literal key is one the answer has.', [edited(upcomingChores, inputs => { inputs.steps[0].key = lit('todo.demo_other'); })]);
reject('flatten-path-not-a-list', 'flatten follows a path to a list.', [edited(lotCount, inputs => { inputs.steps[0].path = ['name']; })]);
reject('date-of-a-number', 'A date operand takes dates.', [edited(overdueChores, inputs => { inputs.steps[3].fields.late = days(lit(5), today); })]);
reject('format-missing-argument', 'A format hole names an argument.', [edited(overdueChores, inputs => { inputs.output.row.subtitle.otherwise.pattern = '{n} days overdue'; })]);
reject('math-wrong-arity', 'subtract takes two arguments.', [edited(overdueChores, inputs => { inputs.steps[3].fields.late = { type: 'math', op: 'subtract', args: [lit(1)] }; })]);
reject('operand-too-deep', 'An operand is at most 8 levels deep.', [edited(overdueChores, inputs => {
  let nested: J = lit(1);
  for (let level = 0; level < 9; level++) nested = { type: 'math', op: 'round', args: [nested] };
  inputs.steps[3].fields.late = nested;
})]);
reject('map-without-fields', 'A map step builds at least one field.', [edited(overdueChores, inputs => { inputs.steps[3].fields = {}; })]);
reject('default-unknown-parent', 'A default fills a field whose parent exists.', [edited(lotCount, inputs => { inputs.steps[1].path = ['detail', 'qty']; })]);

// MARK: Rejected (output and schema)
reject('rows-over-a-record', 'A rows output needs a list.', [edited(nextChore, inputs => { inputs.output = { kind: 'rows', max: 5, row: { id: item('title'), title: item('title') } }; })]);
reject('rows-title-is-a-list', 'A row\'s texts are scalars.', [edited(overdueChores, inputs => { inputs.output.row.title = { type: 'list', items: [item('title')] }; })]);
reject('rows-field-unknown', 'A row operand names a field of the final items.', [edited(overdueChores, inputs => { inputs.output.row.title = item('name'); })]);
reject('record-over-a-list', 'A record output needs one object.', [edited(overdueChores, inputs => { inputs.output = { kind: 'record' }; inputs.schema = objectOf({ id: STRING }); })]);
reject('scalar-over-a-record', 'A scalar output needs one value.', [edited(nextChore, inputs => { inputs.output = { kind: 'scalar' }; inputs.schema = STRING; })]);
reject('schema-differs-from-steps', 'The authored schema is what the steps produce: a title that is text cannot be declared a number.', [edited(overdueChores, inputs => { inputs.schema = rowFields({ id: STRING, title: NUMBER, late: orNull(INTEGER) }); })]);
reject('schema-field-missing', 'The authored schema may not promise a field the steps do not produce.', [edited(overdueChores, inputs => { inputs.schema = rowFields({ id: STRING, title: STRING, late: orNull(INTEGER), extra: STRING }); })]);
reject('schema-wrong-kind-for-output', 'A rows flow declares a list.', [edited(overdueChores, inputs => { inputs.schema = objectOf({ id: STRING }); })]);
reject('schema-any', 'The schema says what the flow gives; any says nothing.', [edited(overdueChores, inputs => { inputs.schema = { kind: 'any' }; })]);
reject('schema-too-deep', 'A shape is at most 6 levels deep.', [edited(overdueChores, inputs => {
  let shape: Shape = STRING;
  for (let level = 0; level < 7; level++) shape = arrayOf(shape);
  inputs.schema = shape;
})]);
reject('schema-union-repeats-a-kind', 'A union holds each kind once.', [edited(overdueChores, inputs => { inputs.schema = arrayOf({ kind: 'union', of: [STRING, { kind: 'string', format: 'date' }] } as Shape); })]);

// MARK: Rejected (nodes and reads)
reject('read-record-unknown-field', 'A read names a field the record\'s schema has.', [source('next-chore', nextChore())], { components: [textNode('next', read('next-chore', ['name']))] });
reject('read-record-wrong-kind', 'A read of a number field as text is refused.', [source('next-chore', nextChore())], { components: [textNode('next', read('next-chore', ['late'], 'string'))] });
reject('read-rows-flow', 'A list cannot be indexed: a rows flow is shown by a node\'s provider, not read.', [source('overdue', overdueChores())], { components: [textNode('next', read('overdue', ['title']))] });
reject('read-scalar-wrong-path', 'A scalar flow is read at ["value"].', [source('next-title', nextChoreTitle())], { components: [textNode('next', read('next-title', ['title']))] });
reject('provider-is-a-record', 'Only a rows flow is a provider.', [source('next-chore', nextChore())], { components: [rowNode('next-chore')] });
reject('collection-template-not-rows', 'A collection shows a flow with the rows template.', [source('overdue', overdueChores())], { components: [collectionNode('overdue', 'todo')] });
reject('capability-missing-from-manifest', 'A document that carries a flow must list sh.pipeline@1.', [source('overdue', overdueChores())], {
  tweak: envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.pipeline@1'); },
});
reject('operands-capability-missing-from-manifest', 'A flow that uses item, param, clock or date must list sh.pipeline-operands@1.', [source('overdue', overdueChores())], {
  tweak: envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.pipeline-operands@1'); },
});

// MARK: Evaluation corpus
interface Evaluation { name: string; note: string; inputs: J; response: unknown; context?: J; budget?: number; expected: J; expectedShape?: Shape; compiles: boolean }
const evaluations: Evaluation[] = [];
const clock = (now = '2026-11-15T09:30:00', utcOffsetMinutes = -480): J => ({ now, utcOffsetMinutes });
/**
 * A flow over an attribute. The response shape is inferred from `response`, and `schema` is the shape the steps give (the Studio's own typing rules):
 * the evaluation cases hand-write the answers, not the shapes. A case that runs a step on data the compiler refuses is marked `compiles: false`.
 */
function flow(response: unknown, steps: J[], output: J, rest: J = {}): J {
  const parameters: J[] = rest.parameters ?? [];
  const input = inferShapeFromSamples([response as any]);
  const shapes = typeSteps(steps as any, input, new Map(parameters.map(entry => [entry.name, entry.type])), '', newFacts());
  const final = shapes.length ? shapes[shapes.length - 1] : input;
  return {
    title: 'Case', parameters: [], request: { type: 'entity-attribute', entityId: lit('sensor.demo_case'), path: ['value'], responseShape: input },
    steps, output, schema: final.kind === 'any' ? final : withoutNull(final), refresh: refresh(['open']), ...rest,
  };
}
const scalar: J = { kind: 'scalar' };
const record: J = { kind: 'record' };
const rows = (max = 100, row: J = { id: item('id'), title: item('title') }): J => ({ kind: 'rows', max, row });
const evaluation = (name: string, note: string, response: unknown, steps: J[], output: J, expected: J, more: Partial<Evaluation> & { flow?: J } = {}) => {
  const { flow: extra, ...rest } = more;
  evaluations.push({ name, note, inputs: flow(response, steps, output, extra), response, context: { clock: clock() }, expected, compiles: true, ...rest });
};
const refused = { compiles: false };
const ok = (output: unknown, extra: J = {}): J => ({ status: 'ok', output, ...extra });
const held = [{ entityId: 'light.demo_study', state: 'on', brightness: 200 }, { entityId: 'light.demo_den', state: 'off', brightness: null }, { entityId: 'light.demo_hall', state: 'on', brightness: 40 }];
const heldRequest = { type: 'entities', entityIds: entityIds('light.demo_study', 'light.demo_den', 'light.demo_hall'), attributes: ['brightness'] };

evaluation('entities-count-on', 'An entities flow starts from one row per listed entity: filter the ones that are on and count them.', held,
  [step('on', 'filter', { where: cmp('eq', item('state'), lit('on')) }), step('n', 'count')], scalar, ok(2), { flow: { request: heldRequest, refresh: undefined } });
evaluation('entities-attribute-null', 'An attribute an entity lacks is null, and a null never passes above.', held,
  [step('bright', 'filter', { where: cmp('above', item('brightness'), lit(100)) }), step('n', 'count')], scalar, ok(1), { flow: { request: heldRequest, refresh: undefined } });
evaluation('none-rule-plural', 'A none flow evaluates its value from the parameters: a rule words the count.', null, [], scalar, ok('3 chores'),
  { flow: { request: { type: 'none', value: choose([[cmp('eq', param('n'), lit(1)), lit('1 chore')]], format('{n} chores', { n: param('n') })) }, refresh: undefined,
    parameters: [{ name: 'n', type: 'number', value: lit(3) }], schema: STRING } });
evaluation('none-rule-first-case', 'The first case that holds wins.', null, [], scalar, ok('1 chore'),
  { flow: { request: { type: 'none', value: choose([[cmp('eq', param('n'), lit(1)), lit('1 chore')]], format('{n} chores', { n: param('n') })) }, refresh: undefined,
    parameters: [{ name: 'n', type: 'number', value: lit(1) }], schema: STRING } });
evaluation('choose-in-map', 'A rule inside a map step: a null never passes above, so the second row takes otherwise.', [{ k: 'a', n: 1 }, { k: 'b', n: null }],
  [step('m', 'map', { fields: { label: choose([[cmp('above', item('n'), lit(0)), lit('some')]], lit('none')) } })], rows(10, { id: item('label'), title: item('label') }),
  ok([{ id: 'some', title: 'some' }, { id: 'none', title: 'none' }]));

const people = [{ id: 'a', title: 'Zed', age: 30, tags: ['x', 'y'] }, { id: 'b', title: 'amy', age: 25, tags: [] }, { id: 'c', title: 'Bo', age: null, tags: ['y'] }];
evaluation('get-nested', 'get follows object fields; a missing field is null, never an error.', { a: { b: { c: 7 } } },
  [step('s', 'get', { path: ['a', 'b', 'c'] })], scalar, ok(7));
evaluation('get-missing-is-null', 'A path that leaves the data gives null, and a scalar output of null is null.', { a: { b: 1 } },
  [step('s', 'get', { path: ['a', 'x', 'y'] })], scalar, ok(null), refused);
evaluation('select-key-hit', 'select-key picks the entry named by a string key.', { 'todo.demo_a': { items: [1] }, 'todo.demo_b': { items: [2] } },
  [step('s', 'select-key', { key: lit('todo.demo_b') }), step('g', 'get', { path: ['items'] }), step('f', 'first')], scalar, ok(2));
evaluation('select-key-miss', 'A key the data lacks, or a key that is not text, gives null.', { 'todo.demo_a': { items: [1] } },
  [step('s', 'select-key', { key: lit('todo.demo_z') })], record, ok(null), refused);
evaluation('filter-compare', 'filter keeps items whose condition holds; a null never holds, in eq, above or below.', people,
  [step('f', 'filter', { where: all(cmp('above', item('age'), lit(20)), cmp('below', item('age'), lit(30))) })], rows(100, { id: item('id'), title: item('title') }),
  ok([{ id: 'b', title: 'amy' }]));
evaluation('filter-ne-and-null', 'ne holds only when both sides have a value: a null age is not "not 30".', people,
  [step('f', 'filter', { where: cmp('ne', item('age'), lit(30)) })], rows(), ok([{ id: 'b', title: 'amy' }]));
evaluation('filter-in-exists-not-any', 'in, exists, not and any.', people,
  [step('f', 'filter', { where: { type: 'any', of: [{ type: 'in', value: item('id'), in: [lit('a'), lit('c')] }, { type: 'not', of: exists(item('age')) }] } })],
  rows(), ok([{ id: 'a', title: 'Zed' }, { id: 'c', title: 'Bo' }]));
evaluation('filter-on-a-record-is-empty', 'A list step given a record gives the empty list.', { a: 1 }, [step('f', 'filter', { where: exists(item('a')) })], rows(), ok([]), refused);
evaluation('filter-dates', 'before and after compare to the second on the viewer\'s clock: a time with an offset is moved to it, a date is midnight.',
  [{ id: 'a', due: '2026-11-15' }, { id: 'b', due: '2026-11-15T17:00:00Z' }, { id: 'c', due: '2026-11-15T09:29:59' }, { id: 'd', due: 'soon' }, { id: 'e', due: null }],
  [step('f', 'filter', { where: cmp('before', item('due'), { type: 'clock', part: 'now' }) })], rows(100, { id: item('id'), title: item('id') }),
  ok([{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }, { id: 'c', title: 'c' }]),
  );
evaluation('sort-text-and-stability', 'Text sorts ascending by NFC scalar value, so "Bo" comes before "Zed" and "amy" (lower case follows upper); ties keep input order.',
  [{ id: 'a', title: 'Zed' }, { id: 'b', title: 'amy' }, { id: 'c', title: 'Bo' }, { id: 'd', title: 'Bo' }],
  [step('s', 'sort', { by: [{ value: item('title'), direction: 'ascending', kind: 'text' }] })], rows(),
  ok([{ id: 'c', title: 'Bo' }, { id: 'd', title: 'Bo' }, { id: 'a', title: 'Zed' }, { id: 'b', title: 'amy' }]));
evaluation('sort-missing-last-either-way', 'A missing or wrongly typed key sorts last whichever the direction.',
  [{ id: 'a', n: 2 }, { id: 'b', n: null }, { id: 'c', n: 9 }, { id: 'd', n: '7' }],
  [step('s', 'sort', { by: [{ value: item('n'), direction: 'descending', kind: 'number' }] })], rows(100, { id: item('id'), title: item('id') }),
  ok([{ id: 'c', title: 'c' }, { id: 'a', title: 'a' }, { id: 'b', title: 'b' }, { id: 'd', title: 'd' }]));
evaluation('sort-two-keys-and-dates', 'A second key breaks ties; the date kind orders instants, so a time with an offset sorts by its moment.',
  [{ id: 'a', due: '2026-11-16', name: 'b' }, { id: 'b', due: '2026-11-15T20:00:00-08:00', name: 'a' }, { id: 'c', due: '2026-11-16T00:00:00', name: 'a' }, { id: 'd', due: '2026-11-15T20:00:00-08:00', name: 'b' }],
  [step('s', 'sort', { by: [{ value: item('due'), direction: 'ascending', kind: 'date' }, { value: item('name'), direction: 'ascending', kind: 'text' }] })],
  rows(100, { id: item('id'), title: item('id') }), ok([{ id: 'b', title: 'b' }, { id: 'd', title: 'd' }, { id: 'c', title: 'c' }, { id: 'a', title: 'a' }]));
evaluation('limit-and-count', 'limit keeps the first n; count counts a list and is 0 for anything else.', [1, 2, 3, 4],
  [step('l', 'limit', { count: 3 }), step('c', 'count')], scalar, ok(3));
evaluation('count-of-a-record', 'count of a record is 0.', { a: 1 }, [step('c', 'count')], scalar, ok(0), refused);
evaluation('first-of-empty', 'first of an empty list is null.', [], [step('f', 'first')], scalar, ok(null), refused);
evaluation('sum-skips-non-numbers', 'sum adds the numbers and skips the rest, in order.', [{ n: 1.5 }, { n: '2' }, { n: null }, { n: 2.5 }, {}],
  [step('s', 'sum', { value: item('n') })], scalar, ok(4));
evaluation('sum-float-order', 'sum adds in input order, so the result is the same everywhere: 0.1 + 0.2 + 0.3.', [{ n: 0.1 }, { n: 0.2 }, { n: 0.3 }],
  [step('s', 'sum', { value: item('n') })], scalar, ok(0.6000000000000001));
evaluation('flatten-field-and-self', 'flatten joins the lists found at a path; an empty path joins lists of lists; non-lists are skipped.', people,
  [step('f', 'flatten', { path: ['tags'] })], rows(100, { id: item(), title: item() }), ok([{ id: 'x', title: 'x' }, { id: 'y', title: 'y' }]));
evaluation('flatten-lists-of-lists', 'An empty flatten path joins an outer list of lists.', [[1, 2], 3, [4]], [step('f', 'flatten', { path: [] }), step('c', 'count')], scalar, ok(3));
evaluation('unique-first-wins-null-is-a-key', 'unique keeps the first item of each key; null is one key; 1 and "1" are different keys.', [{ k: 1 }, { k: '1' }, { k: 1 }, { k: null }, {}],
  [step('u', 'unique', { by: item('k') }), step('c', 'count')], scalar, ok(3));
evaluation('group-order-and-null', 'group lists groups in order of first appearance with their count and items; null items form one group.',
  [{ id: 'a', k: 'x' }, { id: 'b', k: 'y' }, { id: 'c', k: 'x' }, { id: 'd', k: null }],
  [step('g', 'group', { by: item('k') }), step('m', 'map', { fields: { key: item('key'), count: item('count') } })],
  rows(100, { id: item('key'), title: item('count') }),
  ok([{ id: 'x', title: '2' }, { id: 'y', title: '1' }]));
evaluation('map-record', 'map on a record builds one record.', { a: 1, b: 2 },
  [step('m', 'map', { fields: { total: { type: 'math', op: 'add', args: [item('a'), item('b')] } } })], record, ok({ total: 3 }));
evaluation('default-fills-missing-and-null', 'default sets a field that is missing or null, keeps one that has a value, and does nothing under a parent that is not an object.',
  [{ a: { n: null } }, { a: { n: 4 } }, { a: 5 }, { b: 1 }],
  [step('d', 'default', { path: ['a', 'n'], value: lit(0) }), step('m', 'map', { fields: { n: item('a', 'n') } })],
  rows(100, { id: item('n'), title: item('n') }), ok([{ id: '0', title: '0' }, { id: '4', title: '4' }]));

// Operands
evaluation('format-number-text', 'A number prints as Swift prints a Double: no ".0" below 1e15, ".0" to 1e16, then exponent form, and an exponent of two digits.',
  { a: 3, b: 1.5, c: 1e15, d: 1e16, e: 0.000001, f: 1.5e-7, g: 0.0001, h: 123456789012345680000, i: -0.0 },
  [step('m', 'map', { fields: { text: format('{a}|{b}|{c}|{d}|{e}|{f}|{g}|{h}|{i}', Object.fromEntries('abcdefghi'.split('').map(name => [name, item(name)]))) } })],
  record, ok({ text: '3|1.5|1000000000000000.0|1e+16|1e-06|1.5e-07|0.0001|1.2345678901234568e+20|0' }));
evaluation('format-fraction-digits', 'formats rounds like C printf: exact ties go to the even digit, everything else to the nearest.', { a: 2.5, b: 3.5, c: 0.125, d: 2.675, e: -1.005 },
  [step('m', 'map', { fields: { text: format('{a} {b} {c} {d} {e}', Object.fromEntries('abcde'.split('').map(name => [name, item(name)])),
    { a: { number: { maximumFractionDigits: 0 } }, b: { number: { maximumFractionDigits: 0 } }, c: { number: { maximumFractionDigits: 2 } }, d: { number: { maximumFractionDigits: 2 } }, e: { number: { maximumFractionDigits: 2 } } }) } })],
  record, ok({ text: '2 4 0.12 2.67 -1' }));
evaluation('format-null-argument', 'A format with an argument that has no value has no value.', { a: null }, [step('m', 'map', { fields: { text: format('x {a}', { a: item('a') }) } })], record, ok({ text: null }));
evaluation('map-operand-cases', 'A map operand compares text by NFC equality and numbers by value; an unmatched value takes otherwise; a null subject is null.',
  [{ id: 'a', n: 1 }, { id: 'b', n: '1' }, { id: 'c', n: 3 }, { id: 'd', n: null }],
  [step('m', 'map', { fields: { id: item('id'), word: cases$(item('n'), [[1, lit('one')]], lit('many')) } })], rows(100, { id: item('id'), title: item('word') }),
  ok([{ id: 'a', title: 'one' }, { id: 'b', title: 'one' }, { id: 'c', title: 'many' }]));
evaluation('math-round-ties-and-zero', 'round sends a tie away from zero; divide by zero has no value.', { a: -2.5, b: 2.5, c: 1, d: 0 },
  [step('m', 'map', { fields: {
    down: { type: 'math', op: 'round', args: [item('a')] }, up: { type: 'math', op: 'round', args: [item('b')] },
    half: { type: 'math', op: 'round', args: [{ type: 'math', op: 'divide', args: [item('c'), lit(8)] }, lit(2)] }, none: { type: 'math', op: 'divide', args: [item('c'), item('d')] },
  } })], record, ok({ down: -3, up: 3, half: 0.13, none: null }));
evaluation('date-days-between', 'days-between counts calendar days on the viewer\'s clock: 2026-11-15T07:30:00Z is 23:30 on the 14th at -08:00, so it is one day before today; a time with no offset is already on the clock.',
  { a: '2026-11-10', b: '2026-11-15T07:30:00Z', c: '2026-11-15T07:30:00', d: 'tomorrow' },
  [step('m', 'map', { fields: {
    late: days(item('a'), today), utc: days(item('b'), today), wall: days(item('c'), today), bad: days(item('d'), today),
    leap: days(lit('2024-02-28'), lit('2024-03-01')), year: days(lit('2026-01-01'), lit('2027-01-01')),
  } })], record, ok({ late: 5, utc: 1, wall: 0, bad: null, leap: 2, year: 365 }));
evaluation('clock-today-and-now', 'clock gives the viewer\'s today and now as written; a clock that does not parse gives null.', {},
  [step('m', 'map', { fields: { today, now: { type: 'clock', part: 'now' } } })], record, ok({ today: '2026-11-15', now: '2026-11-15T09:30:00' }));
evaluation('clock-invalid', 'A clock that is not a wall-clock date and time gives no today and no now.', {},
  [step('m', 'map', { fields: { today, now: { type: 'clock', part: 'now' } } })], record, ok({ today: null, now: null }), { context: { clock: { now: 'yesterday', utcOffsetMinutes: 0 } } });
evaluation('parameter-from-viewer-and-read', 'Parameters are evaluated in dependency order: one reads the viewer, one reads a source, one builds on both.', {},
  [step('m', 'map', { fields: { who: param('who'), level: param('level'), label: param('label') } })], record,
  ok({ who: 'user-1', level: 3, label: 'user-1 at 3' }),
  { context: { clock: clock(), viewer: { userId: 'user-1' }, reads: { 'source-entity': { attributes: { level: '3' } } } },
    flow: { parameters: [
      { name: 'label', type: 'string', value: format('{who} at {level}', { who: param('who'), level: param('level') }) },
      { name: 'who', type: 'string', value: viewer() },
      { name: 'level', type: 'number', value: read('source-entity', ['attributes', 'level'], 'number') },
    ] } });
evaluation('object-and-list-keep-gaps', 'An object or list operand keeps a null part as null; the whole is not lost.', { a: 1 },
  [step('m', 'map', { fields: { pair: { type: 'list', items: [item('a'), item('missing')] }, both: { type: 'object', fields: { a: item('a'), b: item('b') } } } })],
  record, ok({ pair: [1, null], both: { a: 1, b: null } }), refused);

// Output
evaluation('rows-skip-and-dedupe', 'Rows with no id or no title are skipped, a repeated id keeps its first row, blank subtitles are left out, numbers become text, the list stops at max.',
  [{ id: 1, t: 'One', s: '', v: 2.5 }, { id: 1, t: 'Again', s: 'x', v: 1 }, { id: null, t: 'No id', s: 'x', v: 1 }, { id: 2, t: ' ', s: 'x', v: 1 }, { id: 'c', t: 'Three', s: 'sub', v: true }, { id: 'd', t: 'Four', s: 'x', v: 1 }],
  [], rows(3, { id: item('id'), title: item('t'), subtitle: item('s'), value: item('v') }),
  ok([{ id: '1', title: 'One', value: '2.5' }, { id: 'c', title: 'Three', subtitle: 'sub', value: 'true' }, { id: 'd', title: 'Four', subtitle: 'x', value: '1' }]));
evaluation('rows-ids-compare-as-nfc', 'Two row ids that are the same text under NFC are one id.', [{ id: '\u00e9', t: 'A' }, { id: 'e\u0301', t: 'B' }], [], rows(10, { id: item('id'), title: item('t') }), ok([{ id: '\u00e9', title: 'A' }]));
evaluation('record-of-a-list-is-null', 'A record output of anything but an object is null.', [1], [], record, ok(null), refused);
evaluation('scalar-of-a-record-is-null', 'A scalar output of an object is null.', { a: 1 }, [], scalar, ok(null), refused);

// Budget
const budgetSteps = (where: J) => [step('f', 'filter', { where }), step('c', 'count')];
const small = [{ n: 1 }, { n: 2 }, { n: 3 }];
evaluation('budget-exact', 'A filter over 3 items costs 1 for the step and 3 for the items, plus 3 for each item\'s condition (the comparison and its two operands): 13; count costs 1. A budget of 14 finishes.',
  small, budgetSteps(cmp('above', item('n'), lit(1))), scalar, ok(2, { visits: 14 }), { budget: 14 });
evaluation('budget-over', 'One unit less and the run gives no data: the app keeps what it last had.',
  small, budgetSteps(cmp('above', item('n'), lit(1))), scalar, { status: 'over-budget' }, { budget: 13 });
evaluation('budget-all-parts-evaluated', 'all evaluates every part, so the cost never depends on an earlier answer: the first part is false and the second still costs. 2 for the filter, 7 for the condition, 1 for count.',
  [{ n: 1 }], budgetSteps(all(cmp('above', item('n'), lit(5)), cmp('below', item('n'), lit(5)))), scalar, ok(0, { visits: 10 }), { budget: 10 });

// The four divergences, pinned (text order, text equality, number text, rounding)
evaluation('divergence-text-order', 'JavaScript orders UTF-16 units (U+1F600 before U+FF5E); Swift orders scalars (U+FF5E before U+1F600). A flow orders by scalar value.',
  [{ id: 'emoji', t: '\u{1F600}' }, { id: 'wide', t: '～' }], [step('s', 'sort', { by: [{ value: item('t'), direction: 'ascending', kind: 'text' }] })],
  rows(10, { id: item('id'), title: item('id') }), ok([{ id: 'wide', title: 'wide' }, { id: 'emoji', title: 'emoji' }]));
evaluation('divergence-text-equality', 'JavaScript says U+00E9 differs from "e" + U+0301; Swift says they are equal. A flow compares NFC forms.',
  [{ id: 'a', t: '\u00e9' }, { id: 'b', t: 'e\u0301' }, { id: 'c', t: 'e' }], [step('f', 'filter', { where: cmp('eq', item('t'), lit('\u00e9')) })],
  rows(10, { id: item('id'), title: item('id') }), ok([{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }]));
evaluation('divergence-number-text', 'JavaScript prints 123456789012345680000 and 0.000001 in full; Swift prints 1.2345678901234568e+20 and 1e-06. A flow prints as Swift does.',
  { big: 123456789012345680000, small: 0.000001 }, [step('m', 'map', { fields: { big: format('{n}', { n: item('big') }), small: format('{n}', { n: item('small') }) } })],
  record, ok({ big: '1.2345678901234568e+20', small: '1e-06' }));
evaluation('divergence-rounding', 'Math.round sends -2.5 to -2; Swift .rounded() sends it to -3. A flow rounds a tie away from zero.', { n: -2.5 },
  [step('m', 'map', { fields: { r: { type: 'math', op: 'round', args: [item('n')] } } })], record, ok({ r: -3 }));

// Typing, with the expected shape written by hand
const typed = (name: string, note: string, response: unknown, steps: J[], output: J, expected: J, expectedShape: Shape) =>
  evaluation(name, note, response, steps, output, expected, { expectedShape });
typed('shape-after-map', 'The shape after a map is the object the fields build: an optional source field becomes a nullable one, a date measure a nullable integer.',
  [{ uid: 'u1', summary: 'Water plants', due: '2026-11-10' }, { uid: 'u2', summary: 'Sweep' }],
  [step('m', 'map', { fields: { id: item('uid'), name: item('summary'), late: days(item('due'), today) } })], rows(10, { id: item('id'), title: item('name') }),
  ok([{ id: 'u1', title: 'Water plants' }, { id: 'u2', title: 'Sweep' }]),
  arrayOf(objectOf({ id: { kind: 'string', enum: ['u1', 'u2'] }, name: { kind: 'string', enum: ['Sweep', 'Water plants'] }, late: orNull(INTEGER) })));
typed('shape-after-group-and-count', 'group gives {key, count, items}; count gives an integer.',
  [{ k: 'x' }, { k: 'y' }, { k: 'x' }], [step('g', 'group', { by: item('k') }), step('c', 'count')], scalar, ok(2), INTEGER);

// MARK: Writing
function envelope(item: Case): J {
  const value = structuredClone(base);
  const document = value.document;
  if (item.components) document.pages[PAGE].components = item.components;
  document.dataSources.push(...item.sources);
  return value;
}
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
const ownFile = (file: unknown) => new RegExp(`/(pending-)?${PREFIX}`).test(String(file));
index.cases = index.cases.filter(entry => !ownFile(entry.file));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (ownFile(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));
const shipped = shippedCapabilities(root);
const problems: string[] = [];
for (const item of cases) {
  // Every flow needs a pending capability, so the shipped app refuses each case before anything else: an accepted case is a `pending-` reject.
  const draft = envelope(item);
  let issue: J | undefined;
  if (item.outcome === 'accept') {
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; }
    catch (error) { problems.push(`${item.name} did not compile: ${JSON.stringify((error as any).issues)}`); continue; }
  } else {
    // A rejected case starts from a document that would otherwise be complete, so only the fault under test is reported.
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; } catch { /* the document is the fault */ }
    for (const name of ['sh.pipeline@1', 'sh.pipeline-operands@1']) if (!draft.capabilities.includes(name)) draft.capabilities = [...draft.capabilities, name].sort();
    item.tweak?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); throw new Error(`${item.name} was accepted`); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      issue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    }
  }
  if (item.outcome === 'accept') {
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); } catch (error) { problems.push(`${item.name} did not decode: ${JSON.stringify((error as any).issues)}`); }
  }
  // A document that uses no pending capability is an ordinary case.
  const { file, entry } = placeCase(item.name, item.note, item.outcome, shippedIssue(shipped, draft.capabilities), issue);
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  index.cases.push(entry);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

evaluations.push(...(wgFlowPipelines as unknown as Evaluation[]));
const evaluationRoot = path.join(root, 'pipelines');
mkdirSync(evaluationRoot, { recursive: true });
for (const name of readdirSync(evaluationRoot)) if (name.endsWith('.json')) unlinkSync(path.join(evaluationRoot, name));
for (const entry of evaluations) {
  const { name, ...rest } = entry;
  writeFileSync(path.join(evaluationRoot, `${name}.json`), `${JSON.stringify({ format: 1, name, ...rest }, null, 2)}\n`);
}
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept) and ${evaluations.length} evaluation cases`);
