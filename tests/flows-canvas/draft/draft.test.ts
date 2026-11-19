import { describe, expect, it } from 'vitest';
import { compileCompositionDocument, compileCompositionDocumentWithOrigins, compositionDependencies, CompositionExpansionError } from '../../../src/shared/composition/compiler';
import { expandDocument } from '../../../src/shared/composition/components';
import { lift } from '../../../src/shared/composition/graph/lift';
import { canonicalCompositionJSON, CompositionValidationError } from '../../../src/shared/composition/json';
import { assertNoLogic, publishedDocument, usesLogic } from '../../../src/shared/composition/logic-library';
import { atPointer, bindLogicUse, encodeStudioCanvas, MAX_LOGIC_USE_BINDINGS, readStudioCanvas, replacePointer, unbindLogicUse } from '../../../src/shared/composition/studio-logic';
import { binding, componentDocument, draftDocument, labelTemplate, read, tile } from './fixtures';

const prepared = (document: unknown) => compileCompositionDocument(document).expanded;
const get = (document: unknown, pointer: string) => atPointer(document, pointer);
const failure = (document: unknown) => {
  try { compileCompositionDocument(document); throw new Error('Expected refusal'); }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return error.issues; }
};

describe('D-layout: presentation is expendable, authored JSON is not', () => {
  it.each([null, 'unusable', { version: 22, future: ['keep me'] }, { version: 1, canvases: [{ nodes: 'bad' }] }])('retains invalid/unknown layout %j without changing compilation', studioCanvas => {
    const document = { ...draftDocument(), studioCanvas };
    const result = compileCompositionDocumentWithOrigins(document);
    expect(result.compiled.document).toEqual(document);
    expect(result.compiled.expanded).toEqual(prepared(draftDocument()));
    expect(result.compiled.capabilities).toEqual(compileCompositionDocument(draftDocument()).capabilities);
    expect(result.layout).toMatchObject({ raw: studioCanvas, warnings: [{ code: 'invalid_layout', message: "Saved layout can't be used." }] });
  });

  it('retains valid anchored positions; stale owners/origins and ambiguous associations warn and fall back', () => {
    const document = draftDocument();
    const anchor = { kind: 'logic', id: 'tile-label', field: '/body' } as const;
    const graph = lift(labelTemplate.body, { kind: 'operand', anchor }).graph;
    const stored = encodeStudioCanvas(document, [{
      id: 'layout', roots: [{ anchor, nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 384, y: 240 })) }],
    }]);
    const layout = readStudioCanvas({ ...document, studioCanvas: stored });
    expect(layout).toMatchObject({ raw: stored, warnings: [] });
    expect(layout.metadata?.canvases[0].roots).toEqual([anchor]);
    expect(lift(labelTemplate.body, { kind: 'operand', anchor, metadata: layout.metadata }).graph.nodes[0].position).toEqual({ x: 384, y: 240 });
    for (const metadata of [
      { ...stored, canvases: [stored.canvases[0], stored.canvases[0]] },
      { ...stored, canvases: [{ ...stored.canvases[0], roots: [{ ...stored.canvases[0].roots[0], anchor: { ...anchor, id: 'removed' } }] }] },
      { ...stored, canvases: [{ ...stored.canvases[0], roots: [{ ...stored.canvases[0].roots[0], ownerId: 'another-owner' }] }] },
      { ...stored, canvases: [{ ...stored.canvases[0], roots: [{ ...stored.canvases[0].roots[0], originFrame: 'document-absolute' }] }] },
      { ...stored, canvases: [{ ...stored.canvases[0], nodes: [{ ...stored.canvases[0].nodes[0], origins: ['/removed-node'] }] }] },
      { ...stored, canvases: [{ ...stored.canvases[0], nodes: [{ ...stored.canvases[0].nodes[0], id: 'not-canvas-wide' }] }] },
      { ...stored, canvases: [{ ...stored.canvases[0], nodes: [{ ...stored.canvases[0].nodes[0], rootId: 'missing-root' }] }] },
    ]) {
      expect(readStudioCanvas({ ...document, studioCanvas: metadata })).toMatchObject({ raw: metadata, warnings: [{ code: 'invalid_layout' }] });
      expect(prepared({ ...document, studioCanvas: metadata })).toEqual(prepared(document));
    }
    expect(() => encodeStudioCanvas(document, [{ id: 'invalid', roots: [{ anchor, nodes: [{ id: 'node', origins: ['/removed-node'], x: 0, y: 0 }] }] }])).toThrow(CompositionValidationError);
  });

  it('never applies an old array position to a different lifted node', () => {
    const original = { type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] };
    const anchor = { kind: 'logic', id: 'sum', field: '/body' } as const;
    const first = lift(original, { kind: 'operand', anchor });
    const metadata = { version: 1, canvases: [{ id: 'sum', roots: [anchor], nodes: first.graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 999, y: 999 })) }] };
    const reordered = lift({ ...original, args: [...original.args].reverse() }, { kind: 'operand', anchor, metadata });
    expect(reordered.warnings.some(warning => warning.code === 'invalid_layout')).toBe(true);
    expect(reordered.graph.nodes.every(node => node.position?.x !== 999)).toBe(true);
  });

  it('still refuses invalid AST and unsafe/oversized outer JSON', () => {
    expect(failure({ ...draftDocument(), studioCanvas: { version: 99 }, name: 7 })).toContainEqual({ code: 'invalid_value', pointer: '/document/name' });
    expect(failure({ ...draftDocument(), studioCanvas: { unsafe: Number.POSITIVE_INFINITY } })).toContainEqual({ code: 'invalid_value', pointer: '/studioCanvas/unsafe' });
    expect(failure({ ...draftDocument(), studioCanvas: { large: 'x'.repeat(2_097_152) } })).toContainEqual({ code: 'limit_exceeded', pointer: '/document' });
  });
});

describe('D-binding: each use resolves only its source-valued tile field', () => {
  it('resolves two different tiles afresh without mutating their stale cached args', () => {
    const document = draftDocument(), before = structuredClone(document);
    const expanded = prepared(document);
    expect(get(expanded, '/pages/0/components/0/props/subtitle/value/from/sourceId')).toBe('source-a');
    expect(get(expanded, '/pages/0/components/1/props/subtitle/value/from/sourceId')).toBe('source-b');
    expect(document).toEqual(before);
    const reversed = { ...document, pages: document.pages.map(page => ({ ...page, components: [...page.components].reverse() })) };
    expect(get(prepared(reversed), '/pages/0/components/0/props/subtitle/value/from/sourceId')).toBe('source-b');
    const dependencies = compositionDependencies(compileCompositionDocument(document).document);
    expect(dependencies.complete).toBe(true);
    expect(dependencies.issues).toEqual([]);
    expect(dependencies.edges).toContainEqual(expect.objectContaining({
      target: { type: 'source', id: 'source-b' },
      path: ['pages', 0, 'components', 1, 'props', 'subtitle', 'value', 'from', 'sourceId'],
    }));
  });

  it('adds and removes automatic fill in one immutable edit with a current explicit argument', () => {
    const document = { ...draftDocument(), logicUseBindings: [] };
    const { logicId: _expected, ...selector } = binding('tile-b');
    const bound = bindLogicUse(document, selector);
    expect(get(bound, '/pages/0/components/1/props/subtitle/value/args/source')).toBe('source-b');
    expect(get(bound, '/logicUseBindings/0/logicId')).toBe('tile-label');
    const moved = replacePointer(bound, '/pages/0/components/1/props/titleProviderId', 'source-a');
    const unbound = unbindLogicUse(moved, 0);
    expect(get(unbound, '/pages/0/components/1/props/subtitle/value/args/source')).toBe('source-a');
    expect(get(unbound, '/logicUseBindings')).toEqual([]);
    expect(document.logicUseBindings).toEqual([]);
    expect(prepared(unbound)).toBeDefined();
  });

  it('refuses a changed reference even when its replacement declares the same source argument', () => {
    const original = draftDocument(), other = { ...labelTemplate, id: 'different-template' };
    const document = { ...original, logicLibrary: [...original.logicLibrary, other] };
    const changed = replacePointer(document, '/pages/0/components/0/props/subtitle/value/logicId', other.id);
    expect(failure(changed)).toEqual([{ code: 'invalid_reference', pointer: '/document/logicUseBindings/0/logicId' }]);
    const explicit = replacePointer(changed, '/logicUseBindings', [binding('tile-b')]);
    const { logicId: _expected, ...selector } = binding('tile-a');
    const rebound = bindLogicUse(explicit, selector);
    expect(get(rebound, '/logicUseBindings/1/logicId')).toBe(other.id);
    expect(get(prepared(rebound), '/pages/0/components/0/props/subtitle/value/from/sourceId')).toBe('source-a');
    const { logicId: _missing, ...missing } = binding('tile-a');
    expect(failure({ ...original, logicUseBindings: [missing] })).toEqual([{ code: 'invalid_value', pointer: '/document/logicUseBindings/0/logicId' }]);
  });

  it.each([
    ['/logicUseBindings/0/use/nodeId', 'removed', '/document/logicUseBindings/0/use'],
    ['/logicUseBindings/0/use/id', 'removed', '/document/logicUseBindings/0/use'],
    ['/logicUseBindings/0/argument', 'missing', '/document/logicUseBindings/0/argument'],
    ['/logicLibrary/0/params/0/kind', 'text', '/document/logicUseBindings/0/argument'],
    ['/logicUseBindings/0/from/field', '/action/pageId', '/document/logicUseBindings/0/from/field'],
    ['/pages/0/components/0/props/titleProviderId', 12, '/document/logicUseBindings/0/from/field'],
    ['/pages/0/components/0/props/subtitle/value', { type: 'literal', value: 'no longer a ref' }, '/document/logicUseBindings/0/use'],
    ['/pages/0/components/0/props/subtitle/value/logicId', 'removed', '/document/logicUseBindings/0/logicId'],
    ['/pages/0/components/0/props/subtitle/value/args/source', 7, '/document/pages/0/components/0/props/subtitle/value/args/source'],
  ])('refuses stale/invalid binding %s', (path, value, pointer) => {
    expect(failure(replacePointer(draftDocument(), path, value))).toEqual([expect.objectContaining({ pointer })]);
  });

  it('refuses duplicate targets, unknown fields, unsupported selectors, ambiguous IDs and the 129th binding', () => {
    const document = draftDocument();
    expect(failure({ ...document, logicUseBindings: [binding('tile-a'), binding('tile-a')] })).toContainEqual({ code: 'invalid_combination', pointer: '/document/logicUseBindings/1' });
    expect(failure({ ...document, logicUseBindings: [{ ...binding('tile-a'), unexpected: true }] })).toContainEqual({ code: 'unknown_field', pointer: '/document/logicUseBindings/0/unexpected' });
    expect(failure({ ...document, logicUseBindings: [{ ...binding('tile-a'), from: { kind: 'ancestor', field: '/props/titleProviderId' } }] })[0].pointer).toBe('/document/logicUseBindings/0/from/kind');
    expect(failure({ ...document, logicUseBindings: Array.from({ length: MAX_LOGIC_USE_BINDINGS + 1 }, () => binding('tile-a')) })).toContainEqual({ code: 'limit_exceeded', pointer: '/document/logicUseBindings' });
    const duplicate = { ...document, pages: [{ ...document.pages[0], components: [tile('tile-a', 'source-a'), tile('tile-a', 'source-b')] }] };
    expect(failure(duplicate)[0].pointer).toBe('/document/logicUseBindings/0/use');
  });

  it('does not infer a tile from a document pointer, ancestor or literal data', () => {
    const document = draftDocument();
    const field = '/pages/0/components/0/props/subtitle/value';
    const use = { kind: 'document', id: document.id, field, fingerprint: canonicalCompositionJSON(get(document, field)) };
    expect(failure({ ...document, logicUseBindings: [{ ...binding('tile-a'), use }] })[0].pointer).toBe('/document/logicUseBindings/0/use');
    const fakeTile = replacePointer(document, '/pages/0/components/0/type', 'text');
    expect(failure(fakeTile)[0].pointer).toBe('/document/logicUseBindings/0/from/field');
  });

  it.each(['props/titleProviderId', 'props//titleProviderId', '/props/titleProviderId/', '//props///titleProviderId//'])('carries tile settings through component field %s and private-source remapping', field => {
    const document = draftDocument(), doc = componentDocument(document.id, field);
    const component = doc.componentLibrary[0], uses = doc.pages[0].components;
    const compiled = compileCompositionDocument(doc), drawn = expandDocument(compiled.expanded);
    expect(drawn.pages[0].components.map(node => get(node, '/props/subtitle/value/from/sourceId'))).toEqual(['source-a', 'source-b']);
    expect(get(compiled.expanded, '/componentLibrary/0/bindings')).toEqual([
      component.bindings[0], { param: 'source', nodeId: 'inner-tile', field: 'props/subtitle/value/from/sourceId' },
    ]);
    const privateDoc = {
      ...doc,
      componentLibrary: [{ ...component, node: tile('inner-tile', 'private'), params: [], bindings: [], sources: [{ id: 'private', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_private' } }] }],
      pages: [{ ...document.pages[0], components: uses.map(({ args: _args, ...use }) => use) }],
    };
    const privateDrawn = expandDocument(compileCompositionDocument(privateDoc).expanded);
    expect(privateDrawn.pages[0].components.map(node => get(node, '/props/subtitle/value/from/sourceId'))).toEqual(['place-0~private', 'place-1~private']);
    expect(privateDrawn.dataSources.map(source => source.id)).toEqual(expect.arrayContaining(['place-0~private', 'place-1~private']));
    expect(doc.componentLibrary[0].bindings).toEqual(component.bindings);
    const defaults = {
      ...doc,
      componentLibrary: [{ ...component, node: tile('inner-tile', 'source-b') }],
    };
    expect(get(compileCompositionDocument(defaults).expanded, '/componentLibrary/0/node/props/subtitle/value/from/sourceId')).toBe('source-b');
    expect(compileCompositionDocumentWithOrigins(defaults).sourceMap).toContainEqual(expect.objectContaining({
      pointer: '/componentLibrary/0/bindings/1', authoredPointer: '/logicUseBindings/0', usePointer: '/componentLibrary/0/node/props/subtitle/value',
    }));
    const invalidLanding = replacePointer(defaults, '/logicLibrary/0/body', { type: 'literal', value: { type: 'hole', name: 'source' } });
    expect(failure(invalidLanding)).toContainEqual({ code: 'binding_type', pointer: '/document/logicUseBindings/0' });
  });
});

describe('D-strip and compiler provenance', () => {
  it('strips root Studio fields without deleting equally named literal properties', () => {
    const literal = { type: 'literal', value: { studioCanvas: { version: 40 }, logicUseBindings: [], logicLibrary: 'literal data' } };
    const document = { ...draftDocument(), studioCanvas: { version: 50 }, data: literal };
    // The expander is usable for fragments; native document validation still rejects unrelated root fields.
    const stripped = publishedDocument(document);
    expect(get(stripped, '/data')).toEqual(literal);
    expect(get(stripped, '/studioCanvas')).toBeUndefined();
    expect(get(stripped, '/logicUseBindings')).toBeUndefined();
    expect(get(stripped, '/logicLibrary')).toBeUndefined();
    expect(usesLogic({ studioCanvas: { type: 'logic-ref', args: {} } })).toBe(false);
    expect(JSON.stringify(prepared({ ...draftDocument(), studioCanvas: { version: 50 } }))).not.toMatch(/logic-ref|"hole"|logicLibrary|studioCanvas|logicUseBindings/);
    for (const key of ['studioCanvas', 'logicUseBindings']) {
      expect(() => assertNoLogic({ ...prepared(draftDocument()), [key]: [] })).toThrow(CompositionValidationError);
    }
  });

  it('maps every template landing and bound source to the authored use, argument and tile', () => {
    const document = draftDocument();
    const result = compileCompositionDocumentWithOrigins(document);
    const root = '/pages/0/components/1/props/subtitle/value';
    expect(result.sourceMap).toContainEqual({
      pointer: `${root}/from/sourceId`, authoredPointer: `${root}/args/source`, usePointer: root,
      bindingPointer: '/logicUseBindings/1', sourcePointer: '/pages/0/components/1/props/titleProviderId',
    });
    expect(result.sourceMap).toContainEqual({ pointer: root, authoredPointer: '/logicLibrary/0/body', usePointer: root });
    const walk = (value: unknown, path: string) => {
      expect(result.sourceMap.some(location => location.pointer === path)).toBe(true);
      if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, inner]) => walk(inner, `${path}/${key}`));
    };
    walk(get(result.compiled.expanded, root), root);
  });

  it('retains copied-argument origins through nested references and failure landings', () => {
    const document = draftDocument();
    const identity = { id: 'identity', name: 'Identity', kind: 'operand', params: [{ name: 'value', kind: 'operand' }], body: { type: 'math', op: 'add', args: [{ type: 'hole', name: 'value' }, { type: 'hole', name: 'value' }] } };
    const nested = { id: 'nested', name: 'Nested', kind: 'operand', params: [{ name: 'value', kind: 'operand' }], body: { type: 'logic-ref', logicId: 'identity', args: { value: { type: 'hole', name: 'value' } } } };
    const root = '/pages/0/components/0/props/subtitle/value';
    const ref = { type: 'logic-ref', logicId: 'nested', args: { value: { type: 'literal', value: 3 } } };
    const doc = replacePointer({ ...document, logicLibrary: [identity, nested], logicUseBindings: [] }, root, ref);
    // The other use is removed so this fixture only exercises nested argument copies.
    const one = replacePointer(doc, '/pages/0/components/1/props/subtitle/value', { type: 'literal', value: 'unchanged' });
    const result = compileCompositionDocumentWithOrigins(one);
    for (const index of [0, 1]) expect(result.sourceMap).toContainEqual({
      pointer: `${root}/args/${index}/value`, authoredPointer: `${root}/args/value/value`, usePointer: root,
    });
    const invalid = replacePointer(one, `${root}/args/value`, read('removed-source'));
    try { compileCompositionDocumentWithOrigins(invalid); throw new Error('Expected refusal'); }
    catch (error) {
      expect(error).toBeInstanceOf(CompositionExpansionError);
      if (!(error instanceof CompositionExpansionError)) throw error;
      expect(error.issues[0].pointer).toBe(`/document${root}/args`);
      expect(error.sourceMap.some(location => location.authoredPointer === `${root}/args/value`)).toBe(true);
      expect(error.expandedIssues[0].pointer).toContain(`/document${root}/args/`);
    }
  });
});
