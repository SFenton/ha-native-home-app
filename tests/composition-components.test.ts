import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bodyCount, bodyHeight, COMPONENT_LIMITS, componentReferences, componentUses, derivedId, expandDocument, expandRef, expandSources, fieldKind, findNodePath, readField, writeField,
} from '../src/shared/composition/components';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { decodeCompositionPublication } from '../server/composition';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import type { ComponentEntry, ComponentRefNode, CompositionDocument, CompositionNode } from '../src/shared/composition/schema';

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, extra: J = {}): J => node(id, 'text', { props: { value: lit('Hello'), style: 'body', unavailableText: 'None' }, ...extra });
const section = (id: string, children: J[]): J => node(id, 'section', {
  props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children,
});
const tile = (id: string): J => node(id, 'navigation-tile', {
  icon: symbol('info.circle'), props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Open') },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});
const ref = (id: string, componentId: string, rest: J = {}): J => ({ id, type: 'component-ref', componentId, layout: { span: 1 }, ...rest });
const entry = (id: string, body: J, rest: J = {}): J => ({ id, name: id, node: body, ...rest });

function fixture(components: J[], library?: J[]): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.pages[2].components = components;
  if (library) document.componentLibrary = library;
  return document as CompositionDocument;
}
function issuesOf(document: CompositionDocument): CompositionIssue[] {
  try { compileCompositionDocument(document); return []; }
  catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; }
}
const first = (document: CompositionDocument) => { const [issue] = issuesOf(document); return issue && { code: issue.code, pointer: issue.pointer }; };
const ROOT = '/document/pages/2/components';

describe('expandRef', () => {
  const body = section('inner', [text('copy'), tile('open')]) as CompositionNode;
  const library = entry('guests', body) as ComponentEntry;

  it('gives the root the reference id and width, and every other node a derived id', () => {
    const out = expandRef(ref('home-guests', 'guests', { layout: { span: 3 } }) as ComponentRefNode, library);
    expect(out.id).toBe('home-guests');
    expect(out.layout.span).toBe(3);
    const children = (out as J).children as CompositionNode[];
    expect(children.map(child => child.id)).toEqual([derivedId('home-guests', 'copy'), derivedId('home-guests', 'open')]);
    expect(children[0].id).toBe('home-guests~copy');
  });

  it('changes nothing else: ids that name something outside the body stay as written', () => {
    const out = expandRef(ref('home-guests', 'guests') as ComponentRefNode, library);
    const open = (out as J).children[1];
    expect(open.action).toEqual(((body as J).children[1] as J).action);
    expect(open.title).toBe('open');
    expect(((out as J).props)).toBe((body as J).props);
  });

  it('returns the same object for the same body, reference and arguments', () => {
    const one = ref('a', 'guests') as ComponentRefNode;
    expect(expandRef(one, library)).toBe(expandRef({ ...one }, library));
    expect(expandRef(one, library)).not.toBe(expandRef(ref('b', 'guests') as ComponentRefNode, library));
  });

  it('leaves the body untouched', () => {
    const before = JSON.stringify(body);
    expandRef(ref('a', 'guests', { layout: { span: 2 } }) as ComponentRefNode, library);
    expect(JSON.stringify(body)).toBe(before);
  });

  it('fills a bound field from the argument and keeps the default when there is none', () => {
    const bound = entry('door', tile('cmp-open'), {
      params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }],
    }) as ComponentEntry;
    const filled = expandRef(ref('use-a', 'door', { args: { target: 'page-orbit' } }) as ComponentRefNode, bound) as J;
    expect(filled.action.pageId).toBe('page-orbit');
    expect(filled.action.type).toBe('push');
    expect(expandRef(ref('use-b', 'door') as ComponentRefNode, bound) as J).toHaveProperty('action.pageId', 'page-lattice');
    expect((bound.node as J).action.pageId).toBe('page-lattice');
  });
});

describe('expandDocument', () => {
  it('is the same object for a document without a library', () => {
    const document = fixture([text('a')]);
    expect(expandDocument(document)).toBe(document);
  });

  it('replaces every reference and drops the library', () => {
    const document = fixture([ref('one', 'guests'), section('holder', [ref('two', 'guests')])], [entry('guests', section('inner', [text('copy')]))]);
    const expanded = expandDocument(document);
    expect(expanded.componentLibrary).toBeUndefined();
    const ids = JSON.stringify(expanded.pages[2].components);
    expect(ids).toContain('"one~copy"');
    expect(ids).toContain('"two~copy"');
    expect(ids).not.toContain('component-ref');
    expect(expandDocument(document)).toBe(expanded);
  });

  it('keeps a reference to a missing entry, which the compiler reports', () => {
    const document = fixture([ref('one', 'gone')], []);
    expect(expandDocument(document).pages[2].components[0].type).toBe('component-ref');
  });
});

describe('uses and shape helpers', () => {
  const document = fixture([ref('a', 'guests'), node('tabs', 'local-tabs', {
    props: { stateId: 'panel', transition: 'canonical-swap@1' },
    tabs: [{ id: 'a', label: 'A', children: [ref('b', 'guests')] }, { id: 'b', label: 'B', children: [ref('c', 'other')] }],
  })], [entry('guests', text('copy')), entry('other', text('more'))]);

  it('lists every use with where it sits', () => {
    expect(componentReferences(document).map(use => use.ref.id)).toEqual(['a', 'b', 'c']);
    const uses = componentUses(document, 'guests');
    expect(uses.map(use => use.ref.id)).toEqual(['a', 'b']);
    expect(uses[0].path).toEqual(['pages', 2, 'components', 0]);
    expect(uses[1].path).toEqual(['pages', 2, 'components', 1, 'tabs', 0, 'children', 0]);
    expect(uses[1].tab).toEqual({ id: 'a', label: 'A' });
    expect(uses[0].surface).toMatchObject({ kind: 'page', id: 'page-echo' });
    expect(componentUses(document, 'nobody')).toEqual([]);
  });

  it('counts, measures and finds', () => {
    const body = section('s', [text('a'), section('t', [text('b')])]) as CompositionNode;
    expect(bodyCount(body)).toBe(4);
    expect(bodyHeight(body)).toBe(3);
    expect(bodyHeight(text('x') as CompositionNode)).toBe(1);
    expect(findNodePath(body, 'b')).toEqual(['children', 1, 'children', 0]);
    expect(findNodePath(body, 's')).toEqual([]);
    expect(findNodePath(body, 'nope')).toBeUndefined();
  });

  it('reads and writes a field path without touching the original', () => {
    const open = tile('open');
    expect(readField(open, 'action/pageId')).toBe('page-lattice');
    const next = writeField(open, 'action/pageId', 'page-orbit');
    expect(readField(next, 'action/pageId')).toBe('page-orbit');
    expect(readField(open, 'action/pageId')).toBe('page-lattice');
    expect(next.props).toBe(open.props);
    expect(writeField(open, 'action/nowhere', 'x')).toBe(open);
  });

  it('classifies the fields a parameter may fill', () => {
    const open = tile('open') as CompositionNode;
    expect(fieldKind(open, 'action/pageId')).toBe('page-id');
    expect(fieldKind(open, 'props/subtitle/value')).toBe('text');
    expect(fieldKind(open, 'icon/name')).toBe('symbol');
    expect(fieldKind(open, 'title')).toBe('text');
    expect(fieldKind(open, 'action/origin')).toBeUndefined();
    expect(fieldKind(open, 'layout/span')).toBeUndefined();
  });
});

describe('compiler rules for saved components', () => {
  const copy = () => entry('guests', text('cmp-copy'));

  it('requires the capability for a library, even an empty one, and for a reference', () => {
    expect(compileCompositionDocument(fixture([text('a')], [])).capabilities).toContain('sh.component-ref@1');
    expect(compileCompositionDocument(fixture([ref('a', 'guests')], [copy()])).capabilities).toContain('sh.component-ref@1');
    expect(compileCompositionDocument(fixture([text('a')])).capabilities).not.toContain('sh.component-ref@1');
  });

  it('compiles a document without a library to what it compiled to before', () => {
    const plain = compileCompositionDocument(fixture([text('a')]));
    expect(plain.capabilities.some(name => name.includes('component'))).toBe(false);
    expect(compileCompositionDocument(JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document).document.componentLibrary).toBeUndefined();
  });

  it('accepts a reference and an unused entry', () => {
    expect(issuesOf(fixture([ref('a', 'guests'), ref('b', 'guests')], [copy()]))).toEqual([]);
    expect(issuesOf(fixture([text('a')], [copy()]))).toEqual([]);
  });

  it('reports a missing entry at the reference', () => {
    expect(first(fixture([ref('a', 'gone')], [copy()]))).toEqual({ code: 'invalid_reference', pointer: `${ROOT}/0/componentId` });
  });

  it('reports a duplicate entry id at the entry', () => {
    expect(first(fixture([], [copy(), entry('guests', text('cmp-other'))]))).toEqual({ code: 'duplicate_id', pointer: '/document/componentLibrary/0/id' });
  });

  it('keeps one catalog of node ids across pages, bodies and references', () => {
    expect(first(fixture([text('same'), ref('a', 'guests')], [entry('guests', text('same'))])).code).toBe('duplicate_id');
    expect(first(fixture([text('same'), ref('same', 'guests')], [copy()])).code).toBe('duplicate_id');
  });

  it('refuses a reference inside a body, at the inner node\'s type', () => {
    const nested = entry('wrap', section('cmp-s', [ref('cmp-r', 'guests')]));
    expect(first(fixture([], [copy(), nested]))).toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/1/node/children/0/type' });
    expect(first(fixture([], [copy(), entry('root', ref('cmp-r', 'guests'))]))).toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/1/node/type' });
  });

  it('keeps the body root at width 1 and a use at width 1 outside a grid', () => {
    expect(first(fixture([], [entry('guests', text('cmp-copy', { layout: { span: 2 } }))]))).toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/0/node/layout/span' });
    expect(first(fixture([ref('a', 'guests', { layout: { span: 2 } })], [copy()]))).toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/layout/span` });
  });

  it('lets a use span inside a grid', () => {
    const grid = node('grid', 'tile-grid', {
      props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' },
      children: [ref('a', 'door', { layout: { span: 2 } })],
    });
    expect(issuesOf(fixture([grid], [entry('door', tile('cmp-door'))]))).toEqual([]);
  });

  it('applies where-it-sits rules to the body\'s root type at the reference', () => {
    const form = node('cmp-form', 'form', { props: { providerId: 'p', saveLabel: 'Save', selectionOnly: false, fields: [{ key: 'k', label: 'K', control: 'text' }] } });
    const library = [entry('editor', form)];
    expect(issuesOf(fixture([ref('top', 'editor')], library))).toEqual([]);
    expect(first(fixture([section('s', [ref('low', 'editor')])], library))).toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/children/0/componentId` });
    expect(first(fixture([ref('one', 'editor'), ref('two', 'editor')], library))).toEqual({ code: 'invalid_combination', pointer: `${ROOT}` });
  });

  it('counts a use as its whole body for the node total and the depth', () => {
    let tall: J = text('cmp-leaf');
    for (let level = 1; level < 12; level++) tall = section(`cmp-l${level}`, [tall]);
    expect(issuesOf(fixture([ref('top', 'tall')], [entry('tall', tall)]))).toEqual([]);
    expect(first(fixture([section('s', [ref('low', 'tall')])], [entry('tall', tall)]))).toEqual({ code: 'limit_exceeded', pointer: `${ROOT}/0/children/0` });
    const big = section('cmp-big', Array.from({ length: 100 }, (_, index) => text(`cmp-r${index}`)));
    const uses = (count: number) => Array.from({ length: count }, (_, index) => ref(`use-${index}`, 'big'));
    expect(issuesOf(fixture(uses(38), [entry('big', big)]))).toEqual([]);
    expect(issuesOf(fixture(uses(42), [entry('big', big)])).some(issue => issue.code === 'limit_exceeded')).toBe(true);
  });

  it('checks a body once, at the library, however many places use it', () => {
    const bad = entry('bad', node('cmp-power', 'action-tile', {
      icon: symbol('power'), binding: { sourceId: 'source-missing', projection: 'power-tile@1' },
      props: { family: 'lights', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
      action: { type: 'domain', sourceId: 'source-missing', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } },
    }));
    const pointers = issuesOf(fixture([ref('a', 'bad'), ref('b', 'bad')], [bad])).map(issue => issue.pointer);
    expect(pointers.every(pointer => pointer.startsWith('/document/componentLibrary/0/'))).toBe(true);
    expect(pointers.length).toBeGreaterThan(0);
  });

  it('names an unknown field on a reference and an entry', () => {
    expect(first(fixture([ref('a', 'guests', { title: 'x' })], [copy()]))).toEqual({ code: 'unknown_field', pointer: `${ROOT}/0/title` });
    expect(first(fixture([], [{ ...copy(), note: 'x' }]))).toEqual({ code: 'unknown_field', pointer: '/document/componentLibrary/0/note' });
    expect(first(fixture([], [{ ...copy(), name: '' }])).code).toBe('invalid_value');
    expect(first(fixture([], [{ ...copy(), name: 'a\u0007' }])).code).toBe('invalid_value');
  });

  it('limits the library to 100 entries', () => {
    const many = Array.from({ length: 101 }, (_, index) => entry(`e${index}`, text(`cmp-${index}`)));
    expect(first(fixture([], many))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary' });
  });

  it('reads the expanded tree for whole-document checks: a push inside a body is followed', () => {
    const document = fixture([ref('a', 'door')], [entry('door', tile('cmp-door'))]);
    expect(issuesOf(document)).toEqual([]);
    const missingPage = entry('door', { ...tile('cmp-door'), action: { type: 'push', pageId: 'gone', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } });
    expect(first(fixture([ref('a', 'door')], [missingPage]))).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/node/action/pageId' });
  });
});

describe('parameters', () => {
  const door = (extra: J = {}) => entry('door', tile('cmp-open'), {
    params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }], ...extra,
  });

  it('accepts one argument per parameter, set per use', () => {
    const document = fixture([ref('a', 'door', { args: { target: 'page-orbit' } }), ref('b', 'door', { args: { target: 'page-lattice' } })], [door()]);
    expect(issuesOf(document)).toEqual([]);
    const expanded = expandDocument(document).pages[2].components as J[];
    expect(expanded.map(item => item.action.pageId)).toEqual(['page-orbit', 'page-lattice']);
  });

  it('reports a missing, an unknown and an unwanted argument at args/<name>', () => {
    expect(first(fixture([ref('a', 'door', { args: {} })], [door()]))).toEqual({ code: 'missing_required', pointer: `${ROOT}/0/args/target` });
    expect(first(fixture([ref('a', 'door', { args: { target: 'page-orbit', extra: 'x' } })], [door()]))).toEqual({ code: 'unknown_field', pointer: `${ROOT}/0/args/extra` });
    expect(first(fixture([ref('a', 'guests', { args: { target: 'page-orbit' } })], [entry('guests', text('cmp-copy'))]))).toEqual({ code: 'unknown_field', pointer: `${ROOT}/0/args/target` });
  });

  it('checks an argument as the field it fills', () => {
    expect(first(fixture([ref('a', 'door', { args: { target: 'page-gone' } })], [door()]))).toEqual({ code: 'invalid_reference', pointer: `${ROOT}/0/args/target` });
    expect(first(fixture([ref('a', 'door', { args: { target: 'not an id' } })], [door()]))).toEqual({ code: 'invalid_value', pointer: `${ROOT}/0/args/target` });
  });

  it('reports a source of the wrong model at the argument, with the field\'s own code', () => {
    const power = entry('power', node('cmp-power', 'action-tile', {
      icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' },
      props: { family: 'lights', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
      action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } },
    }), { params: [{ name: 'lamp', kind: 'source-id' }], bindings: [
      { param: 'lamp', nodeId: 'cmp-power', field: 'binding/sourceId' }, { param: 'lamp', nodeId: 'cmp-power', field: 'action/sourceId' }] });
    expect(issuesOf(fixture([ref('a', 'power', { args: { lamp: 'source-power' } })], [power]))).toEqual([]);
    expect(first(fixture([ref('a', 'power', { args: { lamp: 'source-entity' } })], [power]))).toEqual({ code: 'binding_type', pointer: `${ROOT}/0/args/lamp` });
  });

  it('checks each binding: a parameter, a node, a field that exists and a kind that fits', () => {
    const at = (bindings: J[], params = door().params) => first(fixture([], [door({ params, bindings })]));
    expect(at([{ param: 'other', nodeId: 'cmp-open', field: 'action/pageId' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/param' });
    expect(at([{ param: 'target', nodeId: 'nope', field: 'action/pageId' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/nodeId' });
    expect(at([{ param: 'target', nodeId: 'cmp-open', field: 'action/nowhere' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(at([{ param: 'target', nodeId: 'cmp-open', field: 'props/subtitle/value' }])).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(at([{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }, { param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }]))
      .toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/0/bindings/1/field' });
  });

  it('declares each parameter once and at most sixteen', () => {
    expect(first(fixture([], [door({ params: [{ name: 'target', kind: 'page-id' }, { name: 'target', kind: 'text' }] })]))).toEqual({ code: 'duplicate_id', pointer: '/document/componentLibrary/0/params/1/name' });
    const seventeen = Array.from({ length: 17 }, (_, index) => ({ name: `p${index}`, kind: 'text' }));
    expect(first(fixture([], [door({ params: seventeen, bindings: [] })]))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/params' });
  });
});

// MARK: - Tier-1 template extensions

const call = (id: string): J => node(id, 'primary-button', { props: {}, action: { type: 'call-service', domain: 'fan', service: 'turn_on', target: { entity_id: lit('fan.example_fan') } } });
const readText = (id: string, sourceId: string, extra: J = {}): J => node(id, 'text', {
  props: { value: { type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'string', missing: 'unavailable' }, style: 'body', unavailableText: 'None' }, ...extra,
});
const haSource = (id: string, entityId: string): J => ({ id, kind: 'ha-entity', entityId: lit(entityId) });
const tabsBody = (id = 'cmp-tabs'): J => node(id, 'local-tabs', {
  props: { stateId: 'panel', transition: 'canonical-swap@1' }, tabs: [{ id: 'a', label: 'A', children: [text('cmp-a')] }, { id: 'b', label: 'B', children: [text('cmp-b')] }],
});
const choice = (id: string, ids = ['a', 'b']): J => ({ id, type: 'choice', initial: ids[0], options: ids.map(option => ({ id: option, label: option.toUpperCase() })) });
function withState(components: J[], library: J[], localState: J[] = [], sources: J[] = []): CompositionDocument {
  const document = fixture(components, library) as J;
  if (localState.length) document.localState = localState;
  document.dataSources.push(...sources);
  return document as CompositionDocument;
}
const fanEntry = (extra: J = {}) => entry('fan-button', call('cmp-go'), {
  params: [{ name: 'fan', kind: 'entity-id' }], bindings: [{ param: 'fan', nodeId: 'cmp-go', field: 'action/target/entity_id/value' }], ...extra,
});

describe('field kinds for entities and tab state (D1, D3, D6)', () => {
  it('classifies an entity id by its key and by the literal under entityId or entity_id', () => {
    const button = call('go') as CompositionNode;
    expect(fieldKind(button, 'action/target/entity_id/value')).toBe('entity-id');
    expect(fieldKind({ binding: { entityId: 'cover.example_vent' } }, 'binding/entityId')).toBe('entity-id');
    expect(fieldKind({ props: { kind: 'copy-color', entityId: 'light.demo_a', copySourceId: 'light.demo_b' } }, 'props/copySourceId')).toBe('entity-id');
    expect(fieldKind({ props: { kind: 'copy-color', entityId: 'light.demo_a', copySourceId: 'light.demo_b' } }, 'props/entityId')).toBe('entity-id');
    expect(fieldKind({ inputs: { powerEntityId: 'switch.demo_a' } }, 'inputs/powerEntityId')).toBe('entity-id');
    expect(fieldKind(haSource('state', 'light.example'), 'entityId/value')).toBe('entity-id');
  });

  it('keeps a source id a source id and a plain literal text', () => {
    expect(fieldKind({ props: { sourceId: 'a', providerId: 'b', titleSourceId: 'c' } }, 'props/sourceId')).toBe('source-id');
    expect(fieldKind({ props: { providerId: 'b' } }, 'props/providerId')).toBe('source-id');
    expect(fieldKind({ props: { value: lit('x') } }, 'props/value/value')).toBe('text');
    expect(fieldKind({ target: { other: lit('x') } }, 'target/other/value')).toBe('text');
  });

  it('classifies a stateId as a state id', () => {
    expect(fieldKind(tabsBody() as CompositionNode, 'props/stateId')).toBe('state-id');
    expect(fieldKind({ action: { type: 'set-local', stateId: 'panel' } }, 'action/stateId')).toBe('state-id');
  });

  it('classifies no field that is not a string', () => {
    expect(fieldKind(haSource('state', 'light.example'), 'entityId')).toBeUndefined();
    expect(fieldKind(haSource('state', 'light.example'), 'kind')).toBeUndefined();
  });
});

describe('entity and state arguments (D1, D3)', () => {
  it('fills a service target and keeps the other use\'s entity', () => {
    const document = fixture([ref('a', 'fan-button', { args: { fan: 'fan.demo_a' } }), ref('b', 'fan-button', { args: { fan: 'fan.demo_b' } })], [fanEntry()]);
    expect(issuesOf(document)).toEqual([]);
    const [a, b] = expandDocument(document).pages[2].components as J[];
    expect(a.action.target.entity_id.value).toBe('fan.demo_a');
    expect(b.action.target.entity_id.value).toBe('fan.demo_b');
  });

  it('reports a malformed entity at the argument', () => {
    for (const bad of ['Fan A', 'demo_a', 'fan.', '.demo', 'Fan.demo']) {
      expect(first(fixture([ref('a', 'fan-button', { args: { fan: bad } })], [fanEntry()]))).toEqual({ code: 'invalid_value', pointer: `${ROOT}/0/args/fan` });
    }
  });

  it('reports a binding of the wrong kind in either direction', () => {
    const at = (kind: string) => first(fixture([], [fanEntry({ params: [{ name: 'fan', kind }] })]));
    for (const kind of ['text', 'source-id', 'page-id', 'state-id']) expect(at(kind)).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(first(fixture([], [entry('door', tile('cmp-open'), { params: [{ name: 'p', kind: 'entity-id' }], bindings: [{ param: 'p', nodeId: 'cmp-open', field: 'props/subtitle/value' }] })])))
      .toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
  });

  it('checks a state argument against the document\'s local state, as the tab container needs it', () => {
    const tabbed = entry('tabbed', tabsBody(), { params: [{ name: 'tabs', kind: 'state-id' }], bindings: [{ param: 'tabs', nodeId: 'cmp-tabs', field: 'props/stateId' }] });
    const state = [choice('panel'), choice('panel-2')];
    expect(issuesOf(withState([ref('a', 'tabbed', { args: { tabs: 'panel' } }), ref('b', 'tabbed', { args: { tabs: 'panel-2' } })], [tabbed], state))).toEqual([]);
    expect(first(withState([ref('a', 'tabbed', { args: { tabs: 'gone' } })], [tabbed], state))).toEqual({ code: 'invalid_reference', pointer: `${ROOT}/0/args/tabs` });
    expect(first(withState([ref('a', 'tabbed', { args: { tabs: 'other' } })], [tabbed], [choice('panel'), choice('other', ['x', 'y'])])))
      .toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/args/tabs` });
    expect(first(withState([ref('a', 'tabbed', { args: { tabs: 'count' } })], [tabbed], [choice('panel'), { id: 'count', type: 'number', initial: 1, minimum: 0, maximum: 3, step: 1 }])))
      .toEqual({ code: 'binding_type', pointer: `${ROOT}/0/args/tabs` });
    expect(first(withState([ref('a', 'tabbed', { args: { tabs: 'not an id' } })], [tabbed], state))).toEqual({ code: 'invalid_value', pointer: `${ROOT}/0/args/tabs` });
  });

  it('checks an argument inside a nested body, which the expanded copy only holds under derived ids', () => {
    const wrapped = entry('wrapped', section('cmp-section', [tabsBody()]), { params: [{ name: 'tabs', kind: 'state-id' }], bindings: [{ param: 'tabs', nodeId: 'cmp-tabs', field: 'props/stateId' }] });
    expect(first(withState([ref('a', 'wrapped', { args: { tabs: 'other' } })], [wrapped], [choice('panel'), choice('other', ['x', 'y'])])))
      .toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/args/tabs` });
  });
});

describe('labels, origin and limits (D4, D5)', () => {
  const door = (extra: J = {}) => entry('door', tile('cmp-open'), {
    params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }], ...extra,
  });
  const library = (value: J) => first(fixture([], [value]));

  it('exports the raised limits', () => {
    expect(COMPONENT_LIMITS).toEqual({ entries: 100, params: 16, bindings: 128, sources: 8, flows: 8, values: 16, valueBytes: 8192 });
  });

  it('accepts a label and an origin and reads no meaning from them', () => {
    const plain = door();
    const marked = door({ params: [{ name: 'target', kind: 'page-id', label: 'Where it goes' }], origin: { id: 'kit.door-row', version: 2 } });
    expect(issuesOf(fixture([ref('a', 'door', { args: { target: 'page-orbit' } })], [marked]))).toEqual([]);
    const use = ref('a', 'door', { args: { target: 'page-orbit' } }) as ComponentRefNode;
    expect(JSON.stringify(expandRef(use, marked as ComponentEntry))).toBe(JSON.stringify(expandRef(use, plain as ComponentEntry)));
  });

  it('refuses an empty, long or control-character label and an unknown parameter field', () => {
    const params = (extra: J) => [{ name: 'target', kind: 'page-id', ...extra }];
    expect(library(door({ params: params({ label: '' }) }))).toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/params/0/label' });
    expect(library(door({ params: params({ label: 'x'.repeat(81) }) }))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/params/0/label' });
    expect(library(door({ params: params({ label: 'a\u0007' }) }))).toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/params/0/label' });
    expect(library(door({ params: params({ default: 'x' }) }))).toEqual({ code: 'unknown_field', pointer: '/document/componentLibrary/0/params/0/default' });
  });

  it('refuses a bad origin', () => {
    expect(library(door({ origin: { id: 'kit.x', version: 0 } }))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/origin/version' });
    expect(library(door({ origin: { id: 'kit.x' } }))).toEqual({ code: 'missing_required', pointer: '/document/componentLibrary/0/origin/version' });
    expect(library(door({ origin: { id: 'not an id', version: 1 } }))).toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/origin/id' });
    expect(library(door({ origin: { id: 'kit.x', version: 1, extra: 1 } }))).toEqual({ code: 'unknown_field', pointer: '/document/componentLibrary/0/origin/extra' });
  });

  it('holds 16 parameters, 128 bindings and 16 arguments, and not one more', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `p${index}`, kind: 'text' }));
    expect(issuesOf(fixture([ref('a', 'door', { args: Object.fromEntries(many(16).map(item => [item.name, 'x'])) })], [door({ params: many(16), bindings: [] })]))).toEqual([]);
    expect(library(door({ params: many(17), bindings: [] }))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/params' });
    const rows = (count: number) => section('cmp-section', Array.from({ length: count }, (_, index) => text(`cmp-row-${index}`)));
    const bindings = (count: number) => Array.from({ length: count }, (_, index) => [
      { param: 'words', nodeId: `cmp-row-${index}`, field: 'props/value/value' }, { param: 'words', nodeId: `cmp-row-${index}`, field: 'title' }]).flat();
    const rowsEntry = (count: number) => entry('rows', rows(count), { params: [{ name: 'words', kind: 'text' }], bindings: bindings(count) });
    expect(issuesOf(fixture([ref('a', 'rows', { args: { words: 'Hi' } })], [rowsEntry(64)]))).toEqual([]);
    expect(library(rowsEntry(65))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/bindings' });
    const seventeen = Object.fromEntries(many(17).map(item => [item.name, 'x']));
    expect(first(fixture([ref('a', 'door', { args: seventeen })], [door({ params: many(16), bindings: [] })]))).toEqual({ code: 'limit_exceeded', pointer: `${ROOT}/0/args` });
  });
});

describe('template-owned sources (D2)', () => {
  const lamp = (extra: J = {}, body: J = readText('cmp-state', 'state')) => entry('lamp-row', body, {
    params: [{ name: 'lamp', kind: 'entity-id' }], sources: [haSource('state', 'light.example_lamp')],
    bindings: [{ param: 'lamp', sourceId: 'state', field: 'entityId/value' }], ...extra,
  });
  const use = (id: string, entity: string) => ref(id, 'lamp-row', { args: { lamp: entity } });
  const library = (value: J) => first(fixture([], [value]));

  it('gives each use its own copy of a source, named <reference id>~<source id>, filled from the argument', () => {
    const document = fixture([use('lamp-a', 'light.demo_a'), use('lamp-b', 'light.demo_b')], [lamp()]);
    expect(issuesOf(document)).toEqual([]);
    const expanded = expandDocument(document);
    const added = expanded.dataSources.slice(document.dataSources.length) as J[];
    expect(added).toEqual([haSource('lamp-a~state', 'light.demo_a'), haSource('lamp-b~state', 'light.demo_b')]);
    expect(expanded.dataSources.slice(0, document.dataSources.length)).toEqual(document.dataSources);
    const [a, b] = expanded.pages[2].components as J[];
    expect(a.props.value.from.sourceId).toBe('lamp-a~state');
    expect(b.props.value.from.sourceId).toBe('lamp-b~state');
  });

  it('keeps the default entity when a binding has no argument, and never rewrites the library entry', () => {
    const owner = lamp({ params: [], bindings: [] });
    const before = JSON.stringify(owner);
    const out = expandSources(ref('lamp-a', 'lamp-row') as ComponentRefNode, owner as ComponentEntry);
    expect(out).toEqual([haSource('lamp-a~state', 'light.example_lamp')]);
    expandRef(ref('lamp-a', 'lamp-row') as ComponentRefNode, owner as ComponentEntry);
    expect(JSON.stringify(owner)).toBe(before);
    expect(expandSources(ref('x', 'lamp-row') as ComponentRefNode, entry('plain', text('cmp-copy')) as ComponentEntry)).toEqual([]);
  });

  it('rewrites every source key that names a private source: reads, rules, lists and providers', () => {
    const body = section('cmp-section', [readText('cmp-state', 'state', { visibleWhen: { type: 'state', sourceId: 'state', path: ['state'], in: ['on'] } })]);
    (body.props as J).presentationProviderId = 'state';
    const out = expandRef(ref('lamp-a', 'lamp-row') as ComponentRefNode, lamp({}, body) as ComponentEntry) as J;
    expect(out.props.presentationProviderId).toBe('lamp-a~state');
    expect(out.children[0].visibleWhen.sourceId).toBe('lamp-a~state');
    expect(out.children[0].props.value.from.sourceId).toBe('lamp-a~state');
    expect(JSON.stringify(out)).not.toContain('"state","path":["state"]},"as"');
  });

  it('rewrites a list of source ids, and leaves a copySourceId and other ids alone', () => {
    const body = { id: 'cmp-x', type: 'room-card', props: { alternate: { subtitleSourceIds: ['state', 'other'] }, copySourceId: 'state' }, binding: { sourceId: 'other' } } as unknown as CompositionNode;
    const out = expandRef(ref('lamp-a', 'lamp-row') as ComponentRefNode, lamp({}, body as unknown as J) as ComponentEntry) as unknown as J;
    expect(out.props.alternate.subtitleSourceIds).toEqual(['lamp-a~state', 'other']);
    expect(out.props.copySourceId).toBe('state');
    expect(out.binding.sourceId).toBe('other');
  });

  it('does not rewrite an argument that happens to equal a private id', () => {
    const named = entry('lamp-row', section('cmp-section', [readText('cmp-own', 'state'), readText('cmp-other', 'state')]), {
      params: [{ name: 'other', kind: 'source-id' }], sources: [haSource('state', 'light.example_lamp')],
      bindings: [{ param: 'other', nodeId: 'cmp-other', field: 'props/value/from/sourceId' }],
    });
    const out = expandRef(ref('lamp-a', 'lamp-row', { args: { other: 'state' } }) as ComponentRefNode, named as ComponentEntry) as J;
    expect(out.children.map((child: J) => child.props.value.from.sourceId)).toEqual(['lamp-a~state', 'state']);
    const document = fixture([ref('lamp-a', 'lamp-row', { args: { other: 'state' } })], [named]);
    expect(first(document)).toEqual({ code: 'invalid_reference', pointer: `${ROOT}/0/args/other` });
  });

  it('lets a private source shadow a document source of the same id inside the body only', () => {
    const shadow = entry('lamp-row', readText('cmp-state', 'source-entity'), { sources: [haSource('source-entity', 'light.example_lamp')] });
    const document = fixture([ref('lamp-a', 'lamp-row'), readText('outside', 'source-entity')], [shadow]);
    expect(issuesOf(document)).toEqual([]);
    const [inside, outside] = expandDocument(document).pages[2].components as J[];
    expect(inside.props.value.from.sourceId).toBe('lamp-a~source-entity');
    expect(outside.props.value.from.sourceId).toBe('source-entity');
  });

  it('fills a source and a node field from one argument', () => {
    const both = entry('fan-row', section('cmp-section', [readText('cmp-state', 'state'), call('cmp-go')]), {
      params: [{ name: 'fan', kind: 'entity-id' }], sources: [haSource('state', 'fan.example_fan')],
      bindings: [{ param: 'fan', sourceId: 'state', field: 'entityId/value' }, { param: 'fan', nodeId: 'cmp-go', field: 'action/target/entity_id/value' }],
    });
    const document = fixture([ref('fan-a', 'fan-row', { args: { fan: 'fan.demo_a' } })], [both]);
    expect(issuesOf(document)).toEqual([]);
    const expanded = expandDocument(document);
    expect((expanded.dataSources.at(-1) as J).entityId.value).toBe('fan.demo_a');
    expect((expanded.pages[2].components[0] as J).children[1].action.target.entity_id.value).toBe('fan.demo_a');
    expect(first(fixture([ref('fan-a', 'fan-row', { args: { fan: 'Fan A' } })], [both]))).toEqual({ code: 'invalid_value', pointer: `${ROOT}/0/args/fan` });
  });

  it('checks a binding: a node or a source, one that exists, a field that exists, a kind that fits, once', () => {
    const at = (bindings: J[], extra: J = {}) => library(lamp({ bindings, ...extra }));
    const base = { param: 'lamp', sourceId: 'state', field: 'entityId/value' };
    expect(at([{ ...base, nodeId: 'cmp-state' }])).toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/0/bindings/0/sourceId' });
    expect(at([{ param: 'lamp', field: 'entityId/value' }])).toEqual({ code: 'missing_required', pointer: '/document/componentLibrary/0/bindings/0/nodeId' });
    expect(at([{ ...base, sourceId: 'gone' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/sourceId' });
    expect(at([{ ...base, field: 'entityId/nowhere' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(at([base], { params: [{ name: 'lamp', kind: 'text' }] })).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(at([{ ...base, field: 'id' }], { params: [{ name: 'lamp', kind: 'source-id' }] })).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(at([base, { ...base, param: 'again' }], { params: [{ name: 'lamp', kind: 'entity-id' }, { name: 'again', kind: 'entity-id' }] }))
      .toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/0/bindings/1/field' });
  });

  it('checks the sources an entry owns: unique ids, an entity id, a literal, an entity source and at most 8', () => {
    expect(library(lamp({ sources: [haSource('state', 'light.demo_a'), haSource('state', 'light.demo_b')] }))).toEqual({ code: 'duplicate_id', pointer: '/document/componentLibrary/0/sources/0/id' });
    expect(library(lamp({ sources: [haSource('state', 'Lamp')] }))).toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/sources/0/entityId/value' });
    expect(library(lamp({ sources: [{ ...haSource('state', 'light.demo_a'), extra: 1 }] }))).toEqual({ code: 'unknown_field', pointer: '/document/componentLibrary/0/sources/0/extra' });
    expect(library(lamp({ sources: [{ id: 'state', kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_a') } }] }))?.code).toBe('missing_required');
    expect(library(lamp({ sources: Array.from({ length: 9 }, (_, index) => haSource(`state-${index}`, 'light.demo_a')) }))).toEqual({ code: 'limit_exceeded', pointer: '/document/componentLibrary/0/sources' });
    expect(library(lamp({}, readText('cmp-state', 'gone')))).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/node/props/value/from/sourceId' });
  });

  it('requires the argument of a parameter that only fills a source', () => {
    expect(first(fixture([ref('lamp-a', 'lamp-row', { args: {} })], [lamp()]))).toEqual({ code: 'missing_required', pointer: `${ROOT}/0/args/lamp` });
    expect(first(fixture([use('lamp-a', 'Lamp A')], [lamp()]))).toEqual({ code: 'invalid_value', pointer: `${ROOT}/0/args/lamp` });
  });

  it('adds the owned sources to the document\'s 1,000', () => {
    const eight = lamp({ params: [], bindings: [], sources: Array.from({ length: 8 }, (_, index) => haSource(`state-${index}`, 'light.demo_a')) }, text('cmp-state'));
    const uses = Array.from({ length: 100 }, (_, index) => ref(`lamp-${index}`, 'lamp-row'));
    const document = fixture(uses, [eight]);
    document.modals[0].components = Array.from({ length: 26 }, (_, index) => ref(`lamp-m${index}`, 'lamp-row')) as CompositionNode[];
    const [issue] = issuesOf(document);
    expect(issue.code).toBe('limit_exceeded');
    expect(issue.pointer).toBe('/document/modals/0/components/24/componentId');
  });

  it('adds no source for an entry without sources, and returns the same sources array', () => {
    const plain = fixture([ref('a', 'guests')], [entry('guests', text('cmp-copy'))]);
    expect(expandDocument(plain).dataSources).toBe(plain.dataSources);
  });
});

describe('the handshake for sh.component-values@1', () => {
  const corpus = (name: string) => readFileSync(`contract/corpus/${name}`);
  const pending: string[] = JSON.parse(corpus('capabilities.pending.json').toString('utf8'));
  const cases = (JSON.parse(corpus('index.json').toString('utf8')) as { cases: { file: string; outcome: string; pending?: boolean; issue?: { code: string }; studioIssue?: { code: string } }[] }).cases
    .filter(item => /component-values-/.test(item.file));

  it('is pending, so every case is held back by the shipped list and the Studio gives its own answer', () => {
    expect(pending).toContain('sh.component-values@1');
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.every(item => item.outcome === 'reject' && item.pending && item.issue?.code === 'unsupported_capability')).toBe(true);
    expect(cases.filter(item => !item.studioIssue).map(item => item.file.replace(/^.*component-values-|\.json$/g, '')).sort())
      .toEqual(['absent-default', 'at-limit', 'color', 'null', 'private-source', 'rule', 'two-fields', 'with-args']);
  });

  it('names the Studio\'s first issue for each refusal', () => {
    const issue = (name: string) => cases.find(item => item.file.endsWith(`component-values-${name}.json`))?.studioIssue?.code;
    expect(['overlap', 'overlap-string-under-value'].map(issue)).toEqual(['invalid_value', 'invalid_value']);
    expect(['unknown-key'].map(issue)).toEqual(['unknown_field']);
    expect(['for-text-param', 'args-for-value-param'].map(issue)).toEqual(['invalid_combination', 'invalid_combination']);
    expect(['too-many', 'too-large'].map(issue)).toEqual(['limit_exceeded', 'limit_exceeded']);
    expect(issue('null-on-required')).toBe('missing_required');
    expect(['capability-missing', 'key-capability-missing'].map(issue)).toEqual(['capability_manifest_mismatch', 'capability_manifest_mismatch']);
  });
});

describe('the handshake for sh.component-ref@1', () => {
  const corpus = (name: string) => readFileSync(`contract/corpus/${name}`);
  const shipped: string[] = JSON.parse(corpus('capabilities.json').toString('utf8'));
  const pending: string[] = JSON.parse(corpus('capabilities.pending.json').toString('utf8'));
  const cases = (JSON.parse(corpus('index.json').toString('utf8')) as { cases: { file: string; outcome: string; pending?: boolean; issue?: { code: string }; studioIssue?: unknown }[] }).cases
    .filter(item => /\/(pending-)?component-/.test(item.file) && !/component-values-/.test(item.file));

  it('lists the capability as shipped and not as pending', () => {
    expect(pending).not.toContain('sh.component-ref@1');
    expect(shipped).toContain('sh.component-ref@1');
    expect(supportedCompositionCapabilities).toContain('sh.component-ref@1');
  });

  it('has both accepted and rejected cases; none is held back by a pending flow', () => {
    expect(cases.filter(item => item.outcome === 'accept').length).toBeGreaterThan(30);
    expect(cases.filter(item => item.outcome === 'reject' && !item.pending).length).toBeGreaterThan(60);
    expect(cases.filter(item => item.pending)).toEqual([]);
    for (const file of ['reject/component-capability-missing.json', 'reject/component-empty-library-capability-missing.json']) expect(cases.find(item => item.file === file)?.issue?.code).toBe('capability_manifest_mismatch');
  });

  it('compiles the four template examples and expands them into plain nodes over declared sources', () => {
    const examples = cases.filter(item => /accept\/component-example-/.test(item.file));
    expect(examples.map(item => item.file.replace(/^.*component-example-|\.json$/g, '')).sort()).toEqual(['bed-sheet', 'humidifier-sheet', 'light-button', 'vent-tile']);
    for (const item of examples) {
      const document = JSON.parse(corpus(item.file).toString('utf8')).document as CompositionDocument;
      expect(() => compileCompositionDocument(document)).not.toThrow();
      const expanded = expandDocument(document);
      const text = JSON.stringify(expanded);
      expect(text).not.toContain('component-ref');
      const ids = new Set(expanded.dataSources.map(source => source.id));
      const named = [...text.matchAll(/"sourceId":"([^"]+)"/g)].map(match => match[1]);
      expect(named.filter(name => !ids.has(name))).toEqual([]);
      for (const entry of document.componentLibrary ?? []) expect(entry.origin?.id).toMatch(/^kit\./);
    }
  });

  it('decodes every accepted case, and the shipped list holds back only a case that declares a pending id', () => {
    for (const item of cases.filter(entry => entry.outcome === 'accept')) {
      const envelope = JSON.parse(corpus(item.file).toString('utf8'));
      expect((envelope.capabilities as string[]).filter(name => !shipped.includes(name))).toEqual([]);
      expect(() => decodeCompositionPublication(corpus(item.file))).not.toThrow();
    }
  });
});
