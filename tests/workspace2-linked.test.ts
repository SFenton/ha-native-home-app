import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { componentReferences, expandDocument } from '../src/shared/composition/components';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import { replaceAt, valueAt } from '../src/composition-editor';
import {
  captureText, deleteComponent, forkPlace, freeName, insertPlace, nameTaken, otherPlaces, placeName, placesText, renameComponent, saveAsComponent,
  settleHeld, touchedEntries, touchedEntry, unlinkPlace, usesText, defaultArgs,
} from '../src/workspace2/linked';
import { endOf } from '../src/workspace2/add/insert';

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, value = 'Hello', extra: J = {}): J => node(id, 'text', { props: { value: lit(value), style: 'body', unavailableText: 'None' }, ...extra });
const tile = (id: string): J => node(id, 'navigation-tile', {
  icon: symbol('info.circle'), props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Open') },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});
const section = (id: string, children: J[]): J => node(id, 'section', {
  props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children,
});
const ref = (id: string, componentId: string, rest: J = {}): J => ({ id, type: 'component-ref', componentId, layout: { span: 1 }, ...rest });
function fixture(components: J[], library?: J[]): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.pages[2].components = components;
  document.pages[1].components = [...document.pages[1].components];
  if (library) document.componentLibrary = library;
  return document as CompositionDocument;
}
const compiles = (document: CompositionDocument) => compileCompositionDocument(document);
const PAGE = ['pages', 2, 'components'];

describe('saveAsComponent', () => {
  const document = fixture([section('guests', [text('copy'), tile('open')]), text('other')]);

  it('keeps the node\'s id and width on the reference and gives the body a fresh root and width 1', () => {
    const grid = fixture([node('grid', 'tile-grid', {
      props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' },
      children: [{ ...tile('wide'), layout: { span: 2 } }],
    })]);
    const saved = saveAsComponent(grid, [...PAGE, 0, 'children', 0], 'Door Row');
    const place = valueAt(saved.document, [...PAGE, 0, 'children', 0]) as J;
    expect(place).toMatchObject({ id: 'wide', type: 'component-ref', layout: { span: 2 } });
    expect(Object.keys(place).sort()).toEqual(['componentId', 'id', 'layout', 'type']);
    const entry = saved.document.componentLibrary![0];
    expect(entry.id).toBe(place.componentId);
    expect(entry.node.id).not.toBe('wide');
    expect(entry.node.layout.span).toBe(1);
    expect(saved.key).toBe('node:wide');
    compiles(saved.document);
  });

  it('keeps inner ids and captures the whole node', () => {
    const saved = saveAsComponent(document, [...PAGE, 0], 'Guests Staying Over');
    const body = saved.document.componentLibrary![0].node as J;
    expect(body.children.map((child: J) => child.id)).toEqual(['copy', 'open']);
    expect(body.title).toBe('guests');
    expect((valueAt(saved.document, [...PAGE, 1]) as J).id).toBe('other');
    compiles(saved.document);
  });

  it('writes linked components inside it as plain copies', () => {
    const base = saveAsComponent(document, [...PAGE, 1], 'Other Text').document;
    const withUse = replaceAt(base, [...PAGE, 0, 'children', 0], ref('inner-use', base.componentLibrary![0].id));
    const saved = saveAsComponent(withUse, [...PAGE, 0], 'Holder');
    const body = saved.document.componentLibrary!.at(-1)!.node as J;
    expect(JSON.stringify(body)).not.toContain('component-ref');
    expect(body.children[0].id).toBe('inner-use');
    expect(body.children[0].type).toBe('text');
    compiles(saved.document);
  });

  it('refuses a taken name (any case), an empty name and a linked place', () => {
    const saved = saveAsComponent(document, [...PAGE, 0], 'Door Row');
    expect(() => saveAsComponent(saved.document, [...PAGE, 1], 'door row')).toThrow(/already exists/);
    expect(() => saveAsComponent(document, [...PAGE, 1], '  ')).toThrow();
    expect(() => saveAsComponent(saved.document, [...PAGE, 0], 'Another')).toThrow();
  });

  it('is undone by one step: the result is a new document and the old is untouched', () => {
    const before = JSON.stringify(document);
    saveAsComponent(document, [...PAGE, 0], 'X');
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe('unlink, rename and delete', () => {
  const saved = saveAsComponent(fixture([section('guests', [text('copy')])]), [...PAGE, 0], 'Guests');
  const used = replaceAt(saved.document, PAGE, [...(valueAt(saved.document, PAGE) as J[]), ref('second', saved.entryId, { layout: { span: 1 } })]);

  it('unlinks one place into a plain copy: the root keeps the id, inner nodes get fresh ids, the others stay linked', () => {
    const next = unlinkPlace(used, [...PAGE, 1]);
    const plain = valueAt(next, [...PAGE, 1]) as J;
    expect(plain.id).toBe('second');
    expect(plain.type).toBe('section');
    expect(plain.children[0].id).not.toBe('copy');
    expect(plain.children[0].id).not.toContain('~');
    expect((valueAt(next, [...PAGE, 0]) as J).type).toBe('component-ref');
    expect(next.componentLibrary).toHaveLength(1);
    compiles(next);
  });

  it('refuses to unlink a node that is not a place', () => {
    expect(() => unlinkPlace(fixture([text('a')]), [...PAGE, 0])).toThrow();
  });

  it('deletes a component: every place stays, unlinked, and the key leaves the document', () => {
    const next = deleteComponent(used, saved.entryId);
    expect(next.componentLibrary).toBeUndefined();
    expect('componentLibrary' in next).toBe(false);
    expect((valueAt(next, [...PAGE, 0]) as J).type).toBe('section');
    expect((valueAt(next, [...PAGE, 1]) as J).type).toBe('section');
    expect(componentReferences(next)).toEqual([]);
    expect(compiles(next).capabilities).not.toContain('sh.component-ref@1');
  });

  it('deletes only the one entry from a library of several', () => {
    const plain = replaceAt(used, PAGE, [...(valueAt(used, PAGE) as J[]), text('plain-text')]);
    const two = saveAsComponent(plain, [...PAGE, 2], 'Text Row').document;
    const next = deleteComponent(two, saved.entryId);
    expect(next.componentLibrary!.map(entry => entry.name)).toEqual(['Text Row']);
    expect((valueAt(next, [...PAGE, 0]) as J).type).toBe('section');
    compiles(next);
  });

  it('renames, refusing a taken or invalid name', () => {
    const next = renameComponent(used, saved.entryId, '  Guest Suite ');
    expect(next.componentLibrary![0].name).toBe('Guest Suite');
    expect(() => renameComponent(used, saved.entryId, '')).toThrow();
    const other = { ...used, componentLibrary: [...used.componentLibrary!, { id: 'b', name: 'Other', node: text('cmp-b') as CompositionNode }] } as CompositionDocument;
    expect(() => renameComponent(other, saved.entryId, 'other')).toThrow(/already exists/);
    expect(renameComponent(other, saved.entryId, 'Guests').componentLibrary![0].name).toBe('Guests');
  });
});

describe('insertPlace', () => {
  const saved = saveAsComponent(fixture([section('guests', [text('copy')]), text('after')]), [...PAGE, 0], 'Guests');

  it('adds a place with a fresh id and width 1 at the destination', () => {
    const destination = endOf(saved.document, 'page:page-echo')!;
    const result = insertPlace(saved.document, saved.entryId, destination);
    const added = valueAt(result.document, [...PAGE, 2]) as J;
    expect(added).toMatchObject({ type: 'component-ref', componentId: saved.entryId, layout: { span: 1 } });
    expect(result.key).toBe(`node:${added.id}`);
    compiles(result.document);
  });

  it('refuses a destination inside a linked component', () => {
    const inside = { list: ['componentLibrary', 0, 'node', 'children'], index: 1, owner: 'node:guests' as const };
    expect(() => insertPlace(saved.document, saved.entryId, inside)).toThrow(/inside a linked template/);
  });

  it('starts each parameter at its default', () => {
    const entry = { id: 'door', name: 'Door', node: tile('cmp-open') as CompositionNode, params: [{ name: 'target', kind: 'page-id' as const }],
      bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }] };
    expect(defaultArgs(entry)).toEqual({ target: 'page-lattice' });
    const document = { ...fixture([text('a')]), componentLibrary: [entry] } as CompositionDocument;
    const result = insertPlace(document, 'door', endOf(document, 'page:page-echo')!);
    expect((valueAt(result.document, [...PAGE, 1]) as J).args).toEqual({ target: 'page-lattice' });
    compiles(result.document);
  });
});

describe('words and names', () => {
  it('says what the dialog captures', () => {
    const body = section('s', [tile('a'), tile('b'), tile('c')]) as CompositionNode;
    expect(captureText(body)).toBe('Saves this section and the 3 tiles inside it. It stays here, linked to the template.');
    expect(captureText(tile('x') as CompositionNode)).toBe('Saves this navigation tile. It stays here, linked to the template.');
    expect(captureText(section('s', [text('t')]) as CompositionNode)).toContain('1 thing inside it');
    expect(captureText(body, 2)).toContain('The 2 templates inside it are unlinked in the new template.');
    expect(captureText(body, 1)).toContain('The template inside it is unlinked in the new template.');
  });

  it('writes the other places for 1, 2, 3 and 6', () => {
    expect(placesText(['Security'])).toBe('It is also used in 1 other place: Security.');
    expect(placesText(['Security', 'Guest Suite'])).toBe('It is also used in 2 other places: Security and Guest Suite.');
    expect(placesText(['Security', 'Guest Suite', 'Your Summary'])).toBe('It is also used in 3 other places: Security, Guest Suite and Your Summary.');
    expect(placesText(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('It is also used in 6 other places: A, B and 4 more.');
  });

  it('counts uses and cuts a long place name at 24 characters', () => {
    expect([0, 1, 4].map(usesText)).toEqual(['Not used yet', 'Used in 1 place', 'Used in 4 places']);
    const use = { surface: { title: 'A page whose title is far too long to read', kind: 'page' as const, id: 'p', index: 0 } } as Parameters<typeof placeName>[0];
    expect(placeName(use)).toHaveLength(24);
    expect(placeName(use).endsWith('…')).toBe(true);
    expect(placeName({ ...use, tab: { id: 'a', label: 'Guests' } })).toBe('Guests');
  });

  it('finds the first free name and compares without case', () => {
    const document = { componentLibrary: [{ id: 'a', name: 'Guests' }, { id: 'b', name: 'Guests 2' }] } as unknown as CompositionDocument;
    expect(freeName(document, 'Guests')).toBe('Guests 3');
    expect(nameTaken(document, ' guests ')).toBe(true);
    expect(nameTaken(document, 'guests', 'a')).toBe(false);
  });
});

describe('the edit question', () => {
  const saved = saveAsComponent(fixture([section('guests', [text('copy', 'Hello'), tile('open')]), text('plain')]), [...PAGE, 0], 'Guests');
  const base = replaceAt(saved.document, PAGE, [...(valueAt(saved.document, PAGE) as J[]), ref('second', saved.entryId)]) as CompositionDocument;
  const editBody = (document: CompositionDocument, edit: (body: J) => J): CompositionDocument => {
    const library = document.componentLibrary!.map((entry, at) => at === 0 ? { ...entry, node: edit(entry.node) } : entry);
    return { ...document, componentLibrary: library } as CompositionDocument;
  };
  const retitle = (document: CompositionDocument) => editBody(document, body => ({ ...body, children: body.children.map((child: J, at: number) => at === 0 ? { ...child, props: { ...child.props, value: lit('Hello!') } } : child) }));

  it('finds the touched entry by identity and by content, and ignores a rename', () => {
    expect(touchedEntry(base, base)).toBeUndefined();
    expect(touchedEntry(base, retitle(base))).toBe(saved.entryId);
    expect(touchedEntries(base, renameComponent(base, saved.entryId, 'New Name'))).toEqual([]);
    // Same content in a new object is not a change.
    const clone = { ...base, componentLibrary: base.componentLibrary!.map(entry => ({ ...entry, node: structuredClone(entry.node) })) } as CompositionDocument;
    expect(touchedEntry(base, clone)).toBeUndefined();
    expect(touchedEntry(base, { ...base, componentLibrary: undefined } as CompositionDocument)).toBeUndefined();
  });

  it('applies the held change everywhere for Update', () => {
    const next = retitle(base);
    expect(settleHeld(base, next, 'second', { kind: 'update' })).toEqual([next]);
    const expanded = expandDocument(next).pages[2].components as J[];
    expect(JSON.stringify(expanded[0])).toContain('Hello!');
    expect(JSON.stringify(expanded[2])).toContain('Hello!');
  });

  it('forks for a new component: the first document equals current plus a copy, the second holds the change on the copy only', () => {
    const next = retitle(base);
    const [forked, withChange] = settleHeld(base, next, 'second', { kind: 'new', name: 'Guests 2' });
    expect(forked.componentLibrary).toHaveLength(2);
    expect(forked.componentLibrary![0]).toBe(base.componentLibrary![0]);
    const fork = forked.componentLibrary![1];
    expect(fork.name).toBe('Guests 2');
    expect(JSON.stringify(fork.node)).toContain('Hello');
    expect(JSON.stringify(fork.node)).not.toContain('Hello!');
    expect((fork.node as J).children.map((child: J) => child.id)).not.toContain('copy');
    expect(componentReferences(forked).find(use => use.ref.id === 'second')!.ref.componentId).toBe(fork.id);
    expect(componentReferences(forked).find(use => use.ref.id === saved.key.slice(5))!.ref.componentId).toBe(saved.entryId);
    // The held change is on the new entry; the original entry is what it was.
    expect(withChange.componentLibrary![0]).toBe(base.componentLibrary![0]);
    expect(JSON.stringify(withChange.componentLibrary![1].node)).toContain('Hello!');
    expect(componentReferences(withChange).find(use => use.ref.id === 'second')!.ref.componentId).toBe(fork.id);
    compiles(forked); compiles(withChange);
  });

  it('keeps a change outside the body, such as a node dragged in from the page', () => {
    const dragged = replaceAt(editBody(base, body => ({ ...body, children: [...body.children, text('moved-in', 'In')] })), [...PAGE, 1], undefined);
    const withoutPlain = { ...dragged, pages: dragged.pages.map((page, at) => at === 2 ? { ...page, components: page.components.filter(Boolean) } : page) } as CompositionDocument;
    const [, withChange] = settleHeld(base, withoutPlain, 'second', { kind: 'new', name: 'Guests 2' });
    expect(withChange.pages[2].components.some(item => item.id === 'plain')).toBe(false);
    expect(JSON.stringify(withChange.componentLibrary![1].node)).toContain('moved-in');
    expect(JSON.stringify(withChange.componentLibrary![0].node)).not.toContain('moved-in');
    compiles(withChange);
  });

  it('forkPlace maps old inner ids to the copy\'s', () => {
    const { ids, document } = forkPlace(base, 'second', 'Copy');
    expect(ids.get('copy')).toBeDefined();
    expect(ids.get('copy')).not.toBe('copy');
    expect(document.componentLibrary).toHaveLength(2);
    expect(() => forkPlace(base, 'second', 'Guests')).toThrow(/already exists/);
  });

  it('lists the other places that use a component', () => {
    expect(otherPlaces(base, saved.entryId, 'second').map(use => use.ref.id)).toEqual(['guests']);
    expect(otherPlaces(base, saved.entryId).length).toBe(2);
  });

  it('indexes a linked place: the root under the reference id, the inside under derived ids, all editing the body', () => {
    const index = buildDocumentIndex(base);
    const root = index.get('node:guests')!, second = index.get('node:second')!;
    expect(root.component).toBe(saved.entryId);
    expect(root.bodyPath).toEqual(['componentLibrary', 0, 'node']);
    expect(root.path).toEqual([...PAGE, 0]);
    const inner = index.get('node:guests~copy')!, twin = index.get('node:second~copy')!;
    expect(inner.path).toEqual(['componentLibrary', 0, 'node', 'children', 0]);
    expect(twin.path).toEqual(inner.path);
    expect(inner.instance).toBe('node:guests');
    expect(twin.instance).toBe('node:second');
    expect(index.keyAt(inner.path, 'node:second')).toBe('node:second~copy');
    expect(index.keyAt(inner.path)).toBe('node:guests~copy');
    expect(second.node!.id).toBe('second');
    expect(index.get('node:second~copy')!.parent).toBe('node:second');
    expect(index.children('node:second')).toEqual(['node:second~copy', 'node:second~open']);
  });
});
