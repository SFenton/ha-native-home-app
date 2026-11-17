import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENT_VALUES_CAPABILITY, expandDocument, expandRef, expandSources, fieldsOverlap, writeValue } from '../src/shared/composition/components';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { canonicalCompositionJSON, CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import type { ComponentEntry, ComponentRefNode, CompositionDocument } from '../src/shared/composition/schema';

/** `sh.component-values@1`: a parameter of the kind `value` and a `values` key on a use (templates spec, "any field", section 2). Every colour and id is a placeholder. */
type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const rgb = (red: number, green: number, blue: number) => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, props: J = {}, extra: J = {}): J => node(id, 'text', { props: { value: lit('Hello'), style: 'body', unavailableText: 'None', ...props }, ...extra });
const ref = (id: string, rest: J = {}): J => ({ id, type: 'component-ref', componentId: 'note', layout: { span: 1 }, ...rest });
const isOn = { type: 'state', sourceId: 'source-entity', path: ['state'], in: ['on'] };
const value = (name: string) => ({ name, kind: 'value' });
const entry = (body: J, params: J[], bindings: J[], rest: J = {}): ComponentEntry => ({ id: 'note', name: 'Note', node: body, params, bindings, ...rest }) as ComponentEntry;

function fixture(components: J[], library: ComponentEntry[]): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.pages[2].components = components;
  document.componentLibrary = library;
  return document as CompositionDocument;
}
function compile(document: CompositionDocument): { issues: CompositionIssue[]; capabilities: string[] } {
  try { return { issues: [], capabilities: compileCompositionDocument(document).capabilities }; }
  catch (error) { if (error instanceof CompositionValidationError) return { issues: error.issues, capabilities: [] }; throw error; }
}
const first = (document: CompositionDocument) => { const [issue] = compile(document).issues; return issue && { code: issue.code, pointer: issue.pointer }; };
const ROOT = '/document/pages/2/components';
const inkEntry = () => entry(text('cmp', { ink: rgb(10, 20, 30) }), [value('ink')], [{ param: 'ink', nodeId: 'cmp', field: 'props/ink' }]);
const ink = (document: J, index: number) => (document.pages[2].components[index] as J).props.ink;

describe('expansion with values', () => {
  it('writes a place\'s value into the bound field after the strings, and leaves a place with no entry on the template\'s value', () => {
    const library = entry(text('cmp', { ink: rgb(10, 20, 30) }), [{ name: 'words', kind: 'text' }, value('ink')],
      [{ param: 'words', nodeId: 'cmp', field: 'title' }, { param: 'ink', nodeId: 'cmp', field: 'props/ink' }]);
    const document = expandDocument(fixture([ref('a', { args: { words: 'Back Door' }, values: { ink: rgb(200, 10, 10) } }), ref('b', { args: { words: 'Front Door' } })], [library]));
    expect(ink(document, 0)).toEqual(rgb(200, 10, 10));
    expect(ink(document, 1)).toEqual(rgb(10, 20, 30));
    expect((document.pages[2].components[0] as J).title).toBe('Back Door');
  });

  it('removes the field for null, and only where the object that holds it is a record', () => {
    const library = entry(text('cmp', {}, { visibleWhen: isOn }), [value('shown')], [{ param: 'shown', nodeId: 'cmp', field: 'visibleWhen' }]);
    const out = expandRef(ref('a', { values: { shown: null } }) as ComponentRefNode, library) as J;
    expect('visibleWhen' in out).toBe(false);
    expect((library.node as J).visibleWhen).toEqual(isOn);
    expect(writeValue({ list: [1, 2] }, 'list/0', null)).toEqual({ list: [1, 2] });
    expect(writeValue({ list: [1, 2] }, 'list/0', 9)).toEqual({ list: [9, 2] });
    expect(writeValue({ list: [1, 2] }, 'list/5', 9)).toEqual({ list: [1, 2] });
  });

  it('creates a field the body does not hold, and a missing holder leaves the node as it was', () => {
    const library = entry(text('cmp'), [value('lines')], [{ param: 'lines', nodeId: 'cmp', field: 'props/lines' }]);
    expect(expandRef(ref('a', { values: { lines: 2 } }) as ComponentRefNode, library)).toHaveProperty('props.lines', 2);
    expect(expandRef(ref('b') as ComponentRefNode, library)).not.toHaveProperty('props.lines');
    const node = text('x');
    expect(writeValue(node, 'props/nowhere/deeper', 1)).toBe(node);
  });

  it('fills two fields from one value', () => {
    const body = node('cmp-section', 'section', { props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: [text('one', { ink: rgb(1, 1, 1) }), text('two', { ink: rgb(1, 1, 1) })] });
    const library = entry(body, [value('ink')], [{ param: 'ink', nodeId: 'one', field: 'props/ink' }, { param: 'ink', nodeId: 'two', field: 'props/ink' }]);
    const out = expandRef(ref('a', { values: { ink: rgb(9, 9, 9) } }) as ComponentRefNode, library) as J;
    expect(out.children.map((child: J) => child.props.ink)).toEqual([rgb(9, 9, 9), rgb(9, 9, 9)]);
  });

  it('names this use\'s copy of a private source inside a value, as the body\'s own keys are named', () => {
    const body = text('cmp', {}, { visibleWhen: { type: 'state', sourceId: 'state', path: ['state'], in: ['on'] } });
    const library = entry(body, [value('shown')], [{ param: 'shown', nodeId: 'cmp', field: 'visibleWhen' }], { sources: [{ id: 'state', kind: 'ha-entity', entityId: lit('light.demo_lamp') }] });
    const use = ref('lamp-a', { values: { shown: { type: 'state', sourceId: 'state', path: ['state'], in: ['off'] } } }) as ComponentRefNode;
    expect((expandRef(use, library) as J).visibleWhen).toEqual({ type: 'state', sourceId: 'lamp-a~state', path: ['state'], in: ['off'] });
    expect(expandSources(use, library).map(source => source.id)).toEqual(['lamp-a~state']);
  });

  it('is memoised by the values too, so two places with different values are two expansions', () => {
    const library = inkEntry();
    const one = expandRef(ref('a', { values: { ink: rgb(1, 2, 3) } }) as ComponentRefNode, library);
    const two = expandRef(ref('a', { values: { ink: rgb(4, 5, 6) } }) as ComponentRefNode, library);
    expect(one).not.toBe(two);
    expect(expandRef(ref('a', { values: { ink: rgb(1, 2, 3) } }) as ComponentRefNode, library)).toBe(one);
  });

  it('knows when two field paths overlap', () => {
    expect(fieldsOverlap('props/ink', 'props/ink/red')).toBe(true);
    expect(fieldsOverlap('props/ink/red', 'props/ink')).toBe(true);
    expect(fieldsOverlap('props/ink', 'props/inkwell')).toBe(false);
    expect(fieldsOverlap('props/ink', 'title')).toBe(false);
  });
});

describe('the capability', () => {
  it('is pending, so the shipped app refuses it until a native lane ships it', () => {
    expect(pendingCompositionCapabilities).toContain(COMPONENT_VALUES_CAPABILITY);
  });

  it('is required when a parameter has the kind value, or a use holds a values key, and not otherwise', () => {
    const named = entry(text('cmp'), [{ name: 'words', kind: 'text' }], [{ param: 'words', nodeId: 'cmp', field: 'title' }]);
    expect(compile(fixture([ref('a', { args: { words: 'Back' } })], [named])).capabilities).not.toContain(COMPONENT_VALUES_CAPABILITY);
    expect(compile(fixture([ref('a')], [inkEntry()])).capabilities).toContain(COMPONENT_VALUES_CAPABILITY);
    expect(compile(fixture([ref('a')], [inkEntry()])).capabilities).toContain('sh.component-ref@1');
    expect(compile(fixture([ref('a', { values: {} })], [entry(text('cmp'), [], [])])).capabilities).toContain(COMPONENT_VALUES_CAPABILITY);
    expect(compile(fixture([ref('a')], [entry(text('cmp'), [], [])])).capabilities).not.toContain(COMPONENT_VALUES_CAPABILITY);
  });

  it('leaves a document that uses no values exactly as it was: the same output, and no new id', () => {
    const named = entry(text('cmp'), [{ name: 'words', kind: 'text' }], [{ param: 'words', nodeId: 'cmp', field: 'title' }]);
    const document = fixture([ref('a', { args: { words: 'Back' } }), ref('b', { args: { words: 'Front' } })], [named]);
    const result = compileCompositionDocument(document);
    expect(result.capabilities).not.toContain(COMPONENT_VALUES_CAPABILITY);
    expect(canonicalCompositionJSON(result.document)).toBe(canonicalCompositionJSON(document));
    expect(JSON.stringify(expandDocument(document).pages[2].components)).toContain('"title":"Back"');
    expect(JSON.stringify(expandDocument(document))).not.toContain('values');
  });
});

describe('what a use may hold in values', () => {
  const document = (values: J, library = inkEntry()) => fixture([ref('a', { values })], [library]);

  it('accepts a value that fits the field it fills, and a use that sets nothing', () => {
    expect(compile(document({ ink: rgb(200, 10, 10) })).issues).toEqual([]);
    expect(compile(fixture([ref('a')], [inkEntry()])).issues).toEqual([]);
  });

  it('refuses a key that is no parameter, a value for a string parameter and an argument for a value parameter', () => {
    expect(first(document({ colour: rgb(1, 2, 3) }))).toEqual({ code: 'unknown_field', pointer: `${ROOT}/0/values/colour` });
    const named = entry(text('cmp'), [{ name: 'words', kind: 'text' }], [{ param: 'words', nodeId: 'cmp', field: 'title' }]);
    expect(first(fixture([ref('a', { args: { words: 'x' }, values: { words: 'x' } })], [named]))).toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/values/words` });
    expect(first(fixture([ref('a', { args: { ink: 'red' } })], [inkEntry()]))).toEqual({ code: 'invalid_combination', pointer: `${ROOT}/0/args/ink` });
  });

  it('holds a use to 16 values and a value to 8,192 bytes of canonical JSON, and accepts both limits themselves', () => {
    const params = Array.from({ length: 16 }, (_, at) => value(`p${at}`));
    const nodes = params.map((param, at) => text(`n${at}`));
    const body = node('cmp-section', 'section', { props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: nodes });
    const library = entry(body, params, params.map((param, at) => ({ param: param.name, nodeId: `n${at}`, field: 'props/value' })));
    const exact = (bytes: number) => lit('x'.repeat(bytes - JSON.stringify(lit('')).length));
    const full = Object.fromEntries(params.map(param => [param.name, lit('y')]));
    expect(compile(fixture([ref('a', { values: { ...full, p0: exact(8192) } })], [library])).issues).toEqual([]);
    expect(first(fixture([ref('a', { values: { ...full, p0: exact(8193) } })], [library]))).toEqual({ code: 'limit_exceeded', pointer: `${ROOT}/0/values/p0` });
    expect(first(fixture([ref('a', { values: { ...full, extra: lit('y') } })], [library]))).toEqual({ code: 'limit_exceeded', pointer: `${ROOT}/0/values` });
  });

  it('checks a value as the field it fills and reports it once, at values/<name>, with the field\'s own code', () => {
    expect(first(document({ ink: { type: 'no-such-colour' } }))).toEqual({ code: 'unknown_variant', pointer: `${ROOT}/0/values/ink` });
    const body = node('cmp-section', 'section', { props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: [text('one'), text('two')] });
    const two = entry(body, [value('ink')], [{ param: 'ink', nodeId: 'one', field: 'props/ink' }, { param: 'ink', nodeId: 'two', field: 'props/ink' }]);
    const issues = compile(fixture([ref('a', { values: { ink: { type: 'no-such-colour' } } })], [two])).issues;
    expect(issues.filter(issue => issue.pointer === `${ROOT}/0/values/ink`)).toHaveLength(1);
  });

  it('refuses null on a required field and a value that makes a rule name a missing source', () => {
    const style = entry(text('cmp'), [value('style')], [{ param: 'style', nodeId: 'cmp', field: 'props/style' }]);
    expect(first(fixture([ref('a', { values: { style: null } })], [style]))).toEqual({ code: 'missing_required', pointer: `${ROOT}/0/values/style` });
    const rule = entry(text('cmp', {}, { visibleWhen: isOn }), [value('shown')], [{ param: 'shown', nodeId: 'cmp', field: 'visibleWhen' }]);
    expect(first(fixture([ref('a', { values: { shown: { ...isOn, sourceId: 'no-such-source' } } })], [rule]))).toEqual({ code: 'invalid_reference', pointer: `${ROOT}/0/values/shown` });
  });
});

describe('the bindings of a value parameter', () => {
  const library = (params: J[], bindings: J[]) => first(fixture([], [entry(text('cmp', { ink: rgb(10, 20, 30) }), params, bindings)]));

  it('refuses two bindings of one node when one path lies under the other and either is a value', () => {
    expect(library([value('ink'), value('red')], [{ param: 'ink', nodeId: 'cmp', field: 'props/ink' }, { param: 'red', nodeId: 'cmp', field: 'props/ink/red' }]))
      .toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/bindings/1/field' });
    expect(library([value('red'), value('ink')], [{ param: 'red', nodeId: 'cmp', field: 'props/ink/red' }, { param: 'ink', nodeId: 'cmp', field: 'props/ink' }]))
      .toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/bindings/1/field' });
    expect(library([{ name: 'words', kind: 'text' }, value('shown')], [{ param: 'words', nodeId: 'cmp', field: 'props/value/value' }, { param: 'shown', nodeId: 'cmp', field: 'props/value' }]))
      .toEqual({ code: 'invalid_value', pointer: '/document/componentLibrary/0/bindings/1/field' });
  });

  it('keeps the old answer for a field bound twice, and accepts two value fields side by side', () => {
    expect(library([value('ink'), value('again')], [{ param: 'ink', nodeId: 'cmp', field: 'props/ink' }, { param: 'again', nodeId: 'cmp', field: 'props/ink' }]))
      .toEqual({ code: 'invalid_combination', pointer: '/document/componentLibrary/0/bindings/1/field' });
    expect(library([value('ink'), value('lines')], [{ param: 'ink', nodeId: 'cmp', field: 'props/ink' }, { param: 'lines', nodeId: 'cmp', field: 'props/lines' }])).toBeUndefined();
  });

  it('refuses a field the expansion owns, a source field and a field whose holder is missing', () => {
    expect(library([value('x')], [{ param: 'x', nodeId: 'cmp', field: 'id' }])).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(library([value('x')], [{ param: 'x', nodeId: 'cmp', field: 'children' }])).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    expect(library([value('x')], [{ param: 'x', nodeId: 'cmp', field: 'props/nowhere/ink' }])).toEqual({ code: 'invalid_reference', pointer: '/document/componentLibrary/0/bindings/0/field' });
    const owned = entry(text('cmp'), [value('x')], [{ param: 'x', sourceId: 'state', field: 'entityId/value' }], { sources: [{ id: 'state', kind: 'ha-entity', entityId: lit('light.demo_lamp') }] });
    expect(first(fixture([], [owned]))).toEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
  });
});
