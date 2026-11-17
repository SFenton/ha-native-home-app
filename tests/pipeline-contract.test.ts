import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusCaseFile } from './corpusCase';
import { decodeCompositionPublication, validateCompositionPublication } from '../server/composition';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { checkPipelineProvider, checkPipelineRead, checkPipelineSource, pipelineSourceSchema, PIPELINE_CAPABILITY, PIPELINE_OPERANDS_CAPABILITY } from '../src/shared/composition/pipeline';

type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
/** An accepted case lives under `accept/`; a refusal under `reject/`, recording the issue the app and the Studio both give. */
const corpusFile = (name: string) => corpusCaseFile(corpus, `pipeline-${name}`);
const accepted = (name: string): J => JSON.parse(readFileSync(corpusFile(name), 'utf8'));
const index: { cases: { file: string; issue?: CompositionIssue; studioIssue?: CompositionIssue }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const recorded = (name: string) => index.cases.find(entry => entry.file === `reject/pipeline-${name}.json`)?.issue;
const compile = (document: unknown) => {
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] as CompositionIssue[] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [] as string[], issues: error.issues }; }
};
/** The accepted file's document with its last flow edited. */
function withFlow(name: string, edit: (inputs: J, document: J) => void) {
  const document = structuredClone(accepted(name).document);
  edit(document.dataSources.at(-1).inputs, document);
  return compile(document);
}

describe('the capabilities', () => {
  it('lists both in the compiler list and the shipped one, and not in the pending file', () => {
    const shared: string[] = JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'));
    const shipped: string[] = JSON.parse(readFileSync(path.join(corpus, 'capabilities.json'), 'utf8'));
    for (const name of [PIPELINE_CAPABILITY, PIPELINE_OPERANDS_CAPABILITY]) {
      expect(supportedCompositionCapabilities).toContain(name);
      expect(shared).not.toContain(name);
      expect(shipped).toContain(name);
    }
  });
  it('names sh.pipeline@1 for any flow, so a publish warning can say what the layout uses', () => {
    expect(compile(accepted('without-operands').document).capabilities).toContain('sh.pipeline@1');
    expect(compile(accepted('without-operands').document).capabilities).not.toContain('sh.pipeline-operands@1');
    for (const name of ['overdue-chores', 'upcoming-chores', 'expired-food', 'parameters']) {
      expect(compile(accepted(name).document).capabilities, name).toEqual(expect.arrayContaining(['sh.pipeline@1', 'sh.pipeline-operands@1']));
    }
  });
  it('asks for nothing when no flow is defined', () => {
    expect(compile(accepted('node-without-source').document).capabilities).not.toContain('sh.pipeline@1');
  });
  it('does not gate publishing: a layout that uses flows decodes as an envelope, with its capabilities in the manifest', () => {
    const envelope = accepted('upcoming-chores');
    expect(() => validateCompositionPublication(envelope)).not.toThrow();
    expect(decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(envelope))).capabilities).toContain('sh.pipeline@1');
  });
});

describe('the owner\'s flows', () => {
  it('rebuilds Overdue Chores over a live to-do subscription with no refresh', () => {
    const inputs = accepted('overdue-chores').document.dataSources.at(-1).inputs;
    expect(inputs.request).toEqual({ type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.demo_chores' } });
    expect(inputs.refresh).toBeUndefined();
  });
  it('rebuilds Upcoming Chores over get_items of the to-do domain, refreshed on open, pull to refresh and the lists changing', () => {
    const inputs = accepted('upcoming-chores').document.dataSources.at(-1).inputs;
    expect(inputs.request).toMatchObject({ type: 'service-response', domain: 'todo', service: 'get_items' });
    expect(inputs.refresh.on).toEqual(['open', 'manual', 'entity-change']);
    expect(inputs.refresh.entityIds).toHaveLength(2);
  });
  it('rebuilds Expired Food over the expired_list attribute, watching its own entity', () => {
    const inputs = accepted('expired-food').document.dataSources.at(-1).inputs;
    expect(inputs.request).toMatchObject({ type: 'entity-attribute', path: ['expired_list'] });
    expect(inputs.refresh.entityIds).toBeUndefined();
  });
  it('uses demo entity ids only', () => {
    for (const name of ['overdue-chores', 'upcoming-chores', 'expired-food', 'forecast-live']) {
      const text = JSON.stringify(accepted(name).document.dataSources.at(-1));
      for (const found of text.match(/"[a-z_]+\.[a-z0-9_]+"/g) ?? []) if (/^"(todo|sensor|weather)\./.test(found)) expect(found, name).toMatch(/demo/);
    }
  });
});

describe('the live sources', () => {
  it("accepts a service-response of the to-do domain's get_items (the Studio will later suggest the live source)", () => {
    expect(withFlow('upcoming-chores', () => undefined).issues).toEqual([]);
  });
  it('refuses a refresh on a live source, whichever kind', () => {
    for (const name of ['overdue-chores', 'forecast-live']) {
      expect(withFlow(name, inputs => { inputs.refresh = { on: ['open'], staleAfterSeconds: 60 }; }).issues).toEqual([{ code: 'invalid_combination', pointer: '/document/dataSources/2/inputs/refresh' }]);
    }
  });
  it('maps each kind to a closed pair: an entity of its domain, and a forecast type only for the forecast', () => {
    expect(withFlow('overdue-chores', inputs => { inputs.request.entityId.value = 'weather.demo_home'; }).issues[0]).toMatchObject({ code: 'invalid_combination' });
    expect(withFlow('forecast-live', inputs => { inputs.request.entityId.value = 'todo.demo_chores'; }).issues[0]).toMatchObject({ code: 'invalid_combination' });
    for (const type of ['daily', 'hourly', 'twice_daily']) expect(withFlow('forecast-live', inputs => { inputs.request.forecastType = type; }).issues).toEqual([]);
    expect(withFlow('forecast-live', inputs => { inputs.request.forecastType = 'weekly'; }).issues[0]).toMatchObject({ code: 'unknown_variant' });
    expect(withFlow('overdue-chores', inputs => { inputs.request.kind = 'logbook'; }).issues[0]).toMatchObject({ code: 'unknown_variant' });
  });
  it('types the steps against what each subscription pushes', () => {
    expect(withFlow('overdue-chores', inputs => { inputs.steps[0].path = ['forecast']; }).issues[0]).toMatchObject({ code: 'invalid_reference' });
    expect(withFlow('forecast-live', inputs => { inputs.steps[0].path = ['items']; }).issues[0]).toMatchObject({ code: 'invalid_reference' });
    expect(withFlow('overdue-chores', inputs => { inputs.steps[1].where.of[0].right.value = 'completed'; }).issues).toEqual([]);
  });
});

describe('refresh', () => {
  it('is a subset of open, manual and entity-change, with no interval', () => {
    for (const on of [['open'], ['manual'], ['entity-change'], ['open', 'manual']]) {
      const issues = withFlow('expired-food', inputs => { inputs.refresh.on = on; }).issues;
      expect(issues, on.join()).toEqual([]);
    }
    expect(withFlow('expired-food', inputs => { inputs.refresh.on = ['interval']; }).issues[0]).toMatchObject({ code: 'unknown_variant' });
    expect(withFlow('expired-food', inputs => { inputs.refresh.intervalSeconds = 60; }).issues[0]).toMatchObject({ code: 'unknown_field' });
  });
  it('names up to 8 entities for a service, and none for an attribute', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({ type: 'literal', value: `todo.demo_list_${index}` }));
    expect(withFlow('upcoming-chores', inputs => { inputs.refresh.entityIds = many(8); }).issues).toEqual([]);
    expect(withFlow('upcoming-chores', inputs => { inputs.refresh.entityIds = many(9); }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
    expect(withFlow('upcoming-chores', inputs => { inputs.refresh.entityIds = []; }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
    expect(withFlow('expired-food', inputs => { inputs.refresh.entityIds = many(1); }).issues[0]).toMatchObject({ code: 'invalid_combination' });
    expect(withFlow('upcoming-chores', inputs => { inputs.refresh.entityIds = [many(1)[0], many(1)[0]]; }).issues[0]).toMatchObject({ code: 'invalid_combination' });
  });
  it('is required for a service and an attribute, and bounded in staleness', () => {
    expect(withFlow('expired-food', inputs => { delete inputs.refresh; }).issues).toEqual([{ code: 'missing_required', pointer: '/document/dataSources/2/inputs/refresh' }]);
    expect(withFlow('expired-food', inputs => { inputs.refresh.staleAfterSeconds = 86_400; }).issues).toEqual([]);
    expect(withFlow('expired-food', inputs => { inputs.refresh.staleAfterSeconds = 86_401; }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
  });
});

describe('secrets', () => {
  it('has no field for a URL, a header, a key or a token on any request kind', () => {
    for (const [name, field] of [['expired-food', 'url'], ['upcoming-chores', 'headers'], ['overdue-chores', 'apiKey'], ['forecast-live', 'token'], ['expired-food', 'endpoint']] as const) {
      expect(withFlow(name, inputs => { inputs.request[field] = 'demo'; }).issues[0], `${name} ${field}`).toMatchObject({ code: 'unknown_field' });
    }
  });
  it('allows only a service name, and its fields are the closed ones', () => {
    expect(withFlow('upcoming-chores', inputs => { inputs.request.service = 'https://example.invalid/x'; }).issues[0]).toMatchObject({ code: 'invalid_value' });
    expect(withFlow('upcoming-chores', inputs => { inputs.request.target.url = { type: 'literal', value: 'x' }; }).issues[0]).toMatchObject({ code: 'unknown_field' });
  });
});

describe('references and parameters', () => {
  it('rejects a parameter cycle and a self reference at the reference that closes it', () => {
    const cycle = withFlow('parameters', (inputs, document) => { document.pages[2].components = []; inputs.parameters = [{ name: 'a', type: 'string', value: { type: 'param', name: 'b' } }, { name: 'b', type: 'string', value: { type: 'param', name: 'a' } }]; inputs.steps = []; inputs.output = { kind: 'record' }; inputs.schema = { kind: 'object', fields: {} }; inputs.request.responseShape = { kind: 'object', fields: {} }; });
    expect(cycle.issues.map(issue => [issue.code, issue.pointer])).toEqual([
      ['invalid_combination', '/document/dataSources/2/inputs/parameters/0/value/name'], ['invalid_combination', '/document/dataSources/2/inputs/parameters/1/value/name'],
    ]);
  });
  it('lets a parameter build on a later one', () => {
    expect(withFlow('parameters', inputs => { inputs.parameters.reverse(); }).issues).toEqual([]);
  });
  it('rejects a parameter read of an unknown source or the wrong type, through the document\'s own read checks', () => {
    expect(withFlow('parameters', inputs => { inputs.parameters[0].value.from.sourceId = 'ghost'; }).issues).toEqual([{ code: 'invalid_reference', pointer: '/document/dataSources/2/inputs/parameters/0/value/from/sourceId' }]);
    expect(withFlow('parameters', inputs => { inputs.parameters[0].value.from.path = ['attributes']; }).issues[0]).toMatchObject({ code: 'invalid_reference' });
    expect(withFlow('parameters', inputs => { inputs.parameters[0].value.as = 'number'; }).issues[0]).toMatchObject({ code: 'binding_type' });
  });
  it('rejects two flows that read each other', () => {
    const document = structuredClone(accepted('record-read').document);
    const first = document.dataSources.at(-1), second = structuredClone(first);
    first.id = 'one'; second.id = 'two';
    const readOf = (id: string) => ({ name: 'p', type: 'string', value: { type: 'read', from: { type: 'source', sourceId: id, path: ['title'] }, as: 'string', missing: 'unavailable' } });
    first.inputs.parameters = [readOf('two')]; second.inputs.parameters = [readOf('one')];
    document.dataSources.push(second);
    document.pages[2].components = [];
    expect(compile(document).issues.map(issue => issue.code)).toContain('invalid_combination');
  });
  it('limits a document to 128 flows', () => {
    const document = structuredClone(accepted('expired-food').document);
    const flow = document.dataSources.at(-1);
    document.dataSources.push(...Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(flow), id: `more-${index}` })));
    expect(compile(document).issues).toEqual([{ code: 'limit_exceeded', pointer: '/document/dataSources/130' }]);
  });
});

describe('what a flow gives, and what reads and nodes may ask of it', () => {
  const inputsOf = (name: string) => pipelineSourceSchema.parse(accepted(name).document.dataSources.at(-1)).inputs;
  it('reads a record by field and a scalar at value, with the field\'s kind', () => {
    const record = inputsOf('record-read'), scalar = inputsOf('scalar-read');
    expect(checkPipelineRead(record, ['title'], 'string')).toBeUndefined();
    expect(checkPipelineRead(record, ['late'], 'number')).toBeUndefined();
    expect(checkPipelineRead(record, ['late'], 'string')).toEqual({ code: 'binding_type', suffix: '/as' });
    expect(checkPipelineRead(record, ['missing'], 'string')).toEqual({ code: 'invalid_reference', suffix: '/from/path' });
    expect(checkPipelineRead(record, ['title', 'x'], 'string')).toEqual({ code: 'invalid_reference', suffix: '/from/path' });
    expect(checkPipelineRead(scalar, ['value'], 'string')).toBeUndefined();
    expect(checkPipelineRead(scalar, ['value'], 'number')).toEqual({ code: 'binding_type', suffix: '/as' });
    expect(checkPipelineRead(scalar, ['title'], 'string')).toEqual({ code: 'invalid_reference', suffix: '/from/path' });
  });
  it('refuses a read of a list: it has no index, and a node shows rows through its provider', () => {
    expect(checkPipelineRead(inputsOf('overdue-chores'), ['0', 'title'], 'string')).toEqual({ code: 'invalid_reference', suffix: '/from/path' });
  });
  it('names only a rows flow as a provider, with the rows template on a collection', () => {
    const rows = inputsOf('overdue-chores'), record = inputsOf('record-read');
    expect(checkPipelineProvider(rows, { type: 'row-collection' }, '/p')).toEqual([]);
    expect(checkPipelineProvider(rows, { type: 'collection', template: 'rows' }, '/p')).toEqual([]);
    expect(checkPipelineProvider(rows, { type: 'collection', template: 'todo' }, '/p')).toEqual([{ code: 'invalid_combination', pointer: '/p/template' }]);
    expect(checkPipelineProvider(record, { type: 'row-collection' }, '/p')).toEqual([{ code: 'binding_type', pointer: '/p/providerId' }]);
  });
  it('proves the steps produce the authored schema, and reports nothing else when they do not', () => {
    expect(withFlow('overdue-chores', inputs => { inputs.schema.of.fields.title.shape = { kind: 'number' }; }).issues).toEqual([{ code: 'binding_type', pointer: '/document/dataSources/2/inputs/schema' }]);
    expect(withFlow('overdue-chores', inputs => { inputs.schema.of.fields.title.shape = { kind: 'string', enum: ['a'] }; }).issues).toEqual([{ code: 'binding_type', pointer: '/document/dataSources/2/inputs/schema' }]);
    expect(withFlow('overdue-chores', inputs => { inputs.schema.of.fields.title = { shape: { kind: 'union', of: [{ kind: 'null' }, { kind: 'string' }] } }; }).issues).toEqual([]);
    expect(withFlow('overdue-chores', inputs => { delete inputs.schema.of.fields.late; }).issues).toEqual([]);
    expect(withFlow('overdue-chores', inputs => { inputs.steps[3].fields.late = { type: 'literal', value: 'soon' }; }).issues).toEqual([{ code: 'binding_type', pointer: '/document/dataSources/2/inputs/schema' }]);
  });
  it('limits a rows output to 100 rows and a limit step to 1000', () => {
    expect(withFlow('expired-food', inputs => { inputs.output.max = 100; }).issues).toEqual([]);
    expect(withFlow('expired-food', inputs => { inputs.output.max = 101; }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
    expect(withFlow('upcoming-chores', inputs => { inputs.steps[4].count = 1000; }).issues).toEqual([]);
    expect(withFlow('upcoming-chores', inputs => { inputs.steps[4].count = 1001; }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
  });
  it('limits a flow to 32 steps and 8 parameters', () => {
    expect(withFlow('expired-food', inputs => { inputs.steps = [...inputs.steps, ...Array.from({ length: 29 }, (_, index) => ({ id: `s${index}`, op: 'limit', count: 5 }))]; }).issues).toEqual([]);
    expect(withFlow('expired-food', inputs => { inputs.steps = [...inputs.steps, ...Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, op: 'limit', count: 5 }))]; }).issues[0]).toMatchObject({ code: 'limit_exceeded' });
  });
  it('checks a flow on its own with absolute pointers', () => {
    const source = pipelineSourceSchema.parse(accepted('expired-food').document.dataSources.at(-1));
    expect(checkPipelineSource(source, '/x/1')).toMatchObject({ issues: [], capabilities: ['sh.pipeline@1', 'sh.pipeline-operands@1'] });
    const broken = structuredClone(source);
    broken.inputs.steps[0].id = broken.inputs.steps[1].id;
    expect(checkPipelineSource(broken, '/x/1').issues).toEqual([{ code: 'duplicate_id', pointer: '/x/1/inputs/steps/1/id' }]);
  });
});

describe('the recorded drift cases', () => {
  it('keeps the first issue the corpus records for the rules the owner set', () => {
    expect(recorded('request-with-url')?.code).toBe('unknown_field');
    expect(recorded('live-with-refresh')?.code).toBe('invalid_combination');
    expect(recorded('refresh-interval')?.code).toBe('unknown_variant');
    expect(recorded('refresh-too-many-entities')?.code).toBe('limit_exceeded');
    expect(recorded('unknown-subscription-kind')?.code).toBe('unknown_variant');
    expect(recorded('weather-subscription-without-forecast-type')?.code).toBe('missing_required');
    expect(recorded('parameter-cycle')?.code).toBe('invalid_combination');
    expect(recorded('schema-differs-from-steps')?.code).toBe('binding_type');
    expect(recorded('capability-missing-from-manifest')).toEqual({ code: 'capability_manifest_mismatch', pointer: '/capabilities' });
  });
});
