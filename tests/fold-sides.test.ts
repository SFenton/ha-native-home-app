import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { expandRef } from '../src/shared/composition/components';
import { foldSideAt, holdsSlot, lateSpans, resolveFoldSides, stripTypes, usesFoldSides, type FoldAnswer, type FoldSide, type FoldSlotInput } from '../src/shared/composition/fold-sides';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import type { ComponentEntry, ComponentRefNode, CompositionDocument } from '../src/shared/composition/schema';

const corpus = path.resolve(import.meta.dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: { code: string; pointer: string }; issue?: { code: string; pointer: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const ours = index.cases.filter(item => /^(accept|reject)\/(pending-)?fold-sides-/.test(item.file));
const bytes = (file: string) => readFileSync(path.join(corpus, file));
const envelope = (file: string) => JSON.parse(bytes(file).toString('utf8'));

describe('sh.fold-sides@1 corpus', () => {
  it('is pending and sorted, and holds the cases of the design: 10 compile (nine pending) and 12 are refused', () => {
    expect(pendingCompositionCapabilities).toContain('sh.fold-sides@1');
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toContain('sh.fold-sides@1');
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
    expect(ours.filter(item => item.pending && !item.studioIssue).length).toBe(9);
    expect(ours.filter(item => item.outcome === 'accept').length).toBe(1);
    expect(ours.filter(item => item.studioIssue || (item.outcome === 'reject' && !item.pending)).length).toBe(12);
  });
  it('is not in the app\'s list yet: the shipped list does not name it', () => {
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.json'), 'utf8'))).not.toContain('sh.fold-sides@1');
  });
  it.each(ours.filter(item => item.pending && !item.studioIssue))('compiles $file and declares the id; the shipped list refuses it first', item => {
    const document = envelope(item.file);
    expect(() => decodeCompositionPublication(bytes(item.file))).not.toThrow();
    expect(document.capabilities).toContain('sh.fold-sides@1');
    expect(legacyManifest(compileCompositionDocument(document.document).capabilities)).toEqual(legacyManifest(document.capabilities));
    expect(item.issue?.code).toBe('unsupported_capability');
  });
  it.each(ours.filter(item => item.studioIssue || (item.outcome === 'reject' && !item.pending)).map(item => ({ ...item, expected: item.studioIssue ?? item.issue! })))('refuses $file with its own code at its own pointer', item => {
    let first: { code: string; pointer: string } | undefined;
    try { decodeCompositionPublication(bytes(item.file)); } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      first = error.issues[0];
    }
    expect({ code: first?.code, pointer: first?.pointer }).toEqual({ code: item.expected.code, pointer: item.expected.pointer });
    if (item.pending) expect(item.issue?.code).toBe('unsupported_capability');
  });
  it('declares the id exactly when a page names a side or the switch', () => {
    const plain = envelope('accept/fold-sides-no-fields-needs-no-id.json');
    expect(plain.capabilities).not.toContain('sh.fold-sides@1');
    const switched = structuredClone(plain);
    switched.document.pages[2].layout.foldSides = 'auto';
    expect(compileCompositionDocument(switched.document).capabilities).toContain('sh.fold-sides@1');
    const pinned = structuredClone(plain);
    pinned.document.pages[2].components[0].layout.foldSide = 'trailing';
    expect(compileCompositionDocument(pinned.document).capabilities).toContain('sh.fold-sides@1');
    // Taking the fields off again gives the plain document back.
    delete pinned.document.pages[2].components[0].layout.foldSide;
    expect(JSON.stringify(pinned.document)).toBe(JSON.stringify(plain.document));
  });
});

// MARK: The automatic rule

const item = (type: string, foldSide?: FoldSide): FoldSlotInput => ({ type, layout: foldSide ? { foldSide } : {} });
const rail = (side?: FoldSide) => item('status-rail', side), section = (side?: FoldSide) => item('section', side);
const sides = (items: FoldSlotInput[]) => resolveFoldSides(items).map(placed => placed.side[0].toUpperCase());

describe('the automatic rule (decision D1)', () => {
  const table: { name: string; items: FoldSlotInput[]; expected: string }[] = [
    { name: 'sections alternate, the first leads', items: [section(), section(), section(), section()], expected: 'LTLT' },
    { name: 'a leading status strip spans and the sections after it alternate from the first', items: [rail(), section(), section(), section(), section()], expected: 'SLTLT' },
    { name: 'two strips in a row both span', items: [rail(), item('notification-permission-banner'), rail(), section(), section()], expected: 'SSLT' },
    { name: 'a strip after a section is a section', items: [section(), rail(), section()], expected: 'LTL' },
    { name: 'one section leads and the trailing side stays empty', items: [section()], expected: 'L' },
    { name: 'a strip alone spans', items: [rail()], expected: 'S' },
    { name: 'a pinned side wins and still holds its place in the count', items: [section(), section(), section('trailing'), section()], expected: 'LTTT' },
    { name: 'a section pinned leading in the second place', items: [section(), section('leading'), section(), section()], expected: 'LLLT' },
    { name: 'a pin on the first section moves nothing after it', items: [section('trailing'), section(), section()], expected: 'TTL' },
    { name: 'Across the Top inside the run spans, and the strip after it too', items: [section('span'), rail(), section(), section()], expected: 'SSLT' },
    { name: 'a strip pinned to a side ends the top', items: [rail('leading'), section(), section()], expected: 'LTL' },
    { name: 'a hidden-by-rule section is not known here: it holds its place like any other', items: [section(), section(), section()], expected: 'LTL' },
    { name: 'the statically hidden banner holds no place', items: [item('notification-permission-banner'), section(), section()], expected: 'LT' },
    { name: 'a pinned action bar holds no place', items: [section(), item('pinned-actions'), section()], expected: 'LT' },
  ];
  it.each(table)('$name', ({ items, expected }) => {
    expect(sides(items).join('')).toBe(expected);
  });
  it('answers by index, leaving out what holds no slot', () => {
    const placements = resolveFoldSides([item('notification-permission-banner'), rail(), item('pinned-actions'), section(), section()]);
    expect(placements.map(placed => placed.index)).toEqual([1, 3, 4]);
    expect(foldSideAt(placements, 3)).toBe('leading');
    expect(foldSideAt(placements, 4)).toBe('trailing');
    expect(foldSideAt(placements, 0)).toBeUndefined();
    expect(foldSideAt(placements, 2)).toBeUndefined();
  });
  it('decides what holds a slot', () => {
    expect(holdsSlot({ type: 'section' })).toBe(true);
    expect(holdsSlot({ type: 'pinned-actions' })).toBe(false);
    expect(holdsSlot({ type: 'notification-permission-banner' })).toBe(false);
  });
  it('lays a page out in two sides when its switch is on or a section is pinned to a side', () => {
    expect(usesFoldSides({ layout: {}, components: [section(), section()] })).toBe(false);
    expect(usesFoldSides({ layout: { foldSides: 'auto' }, components: [] })).toBe(true);
    expect(usesFoldSides({ layout: {}, components: [section(), section('trailing')] })).toBe(true);
    expect(usesFoldSides({ layout: {}, components: [section('leading')] })).toBe(true);
    // Across the Top alone is not a place on a side.
    expect(usesFoldSides({ layout: {}, components: [section('span')] })).toBe(false);
    expect(usesFoldSides({ layout: {}, components: [item('pinned-actions', 'leading')] })).toBe(false);
  });
});

describe('Across the Top comes first', () => {
  it.each([
    { name: 'after a section', items: [section(), section('span')], late: [1] },
    { name: 'after a section pinned to a side', items: [section('leading'), rail('span')], late: [1] },
    { name: 'after a plain section that follows a strip', items: [rail(), section(), rail('span')], late: [2] },
    { name: 'in the run', items: [rail(), section('span'), rail('span'), section()], late: [] },
    { name: 'two at the top', items: [section('span'), section('span'), section()], late: [] },
    { name: 'a pinned bar and a hidden banner do not end the top', items: [item('pinned-actions'), item('notification-permission-banner'), section('span'), section()], late: [] },
  ])('flags $name', ({ items, late }) => {
    expect(lateSpans(items)).toEqual(late);
  });
});

// MARK: The compiler and the expansion of a saved component

const base = (): CompositionDocument => envelope('accept/fold-sides-no-fields-needs-no-id.json').document;
const compileIssues = (document: unknown) => {
  try { compileCompositionDocument(document as CompositionDocument); return []; } catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; }
};

describe('compiling sides', () => {
  it('takes a side on a top-level component of a page', () => {
    const document = base();
    document.pages[2].components[1].layout = { span: 1, foldSide: 'trailing' };
    expect(compileIssues(document)).toEqual([]);
  });
  it('names the nested component, with a pointer at the field', () => {
    const document = envelope('reject/fold-sides-nested-in-a-grid.json').document;
    expect(compileIssues(document).map(issue => [issue.code, issue.pointer])).toContainEqual(['invalid_combination', '/document/pages/2/components/0/children/0/layout/foldSide']);
  });
  it('refuses Across the Top after a section, and names that component', () => {
    const document = base();
    // The first section is plain, which ends the top; the second says Across the Top.
    document.pages[2].components[1].layout = { span: 1, foldSide: 'span' };
    const issues = compileIssues(document);
    expect(issues.map(issue => issue.pointer)).toEqual(['/document/pages/2/components/1/layout/foldSide']);
  });
  it('reads a saved component\'s side from the place, and refuses one the body names', () => {
    const body = envelope('reject/pending-fold-sides-component-ref-carries-a-side.json').document;
    expect(compileIssues(body)).toEqual([]);
    expect(compileCompositionDocument(body).capabilities).toContain('sh.fold-sides@1');
    const named = envelope('reject/fold-sides-body-names-a-side.json').document;
    expect(compileIssues(named).map(issue => issue.pointer)).toContain('/document/componentLibrary/0/node/layout/foldSide');
  });
  it('lets a saved component that is a status strip span at the top', () => {
    const document = base();
    document.componentLibrary = [{ id: 'lib-rail', name: 'Chips', node: { id: 'body-rail', title: 'Chips', type: 'status-rail', layout: { span: 1 }, props: {}, children: [] } } as ComponentEntry];
    document.pages[2].layout.foldSides = 'auto';
    document.pages[2].components = [{ id: 'chips', type: 'component-ref', componentId: 'lib-rail', layout: { span: 1, foldSide: 'span' } } as ComponentRefNode, ...document.pages[2].components];
    expect(compileIssues(document)).toEqual([]);
    // After a section the same use is too late.
    document.pages[2].components = [document.pages[2].components[1], document.pages[2].components[0]];
    expect(compileIssues(document).map(issue => issue.code)).toEqual(['invalid_combination']);
  });
});

describe('a use of a saved component carries its side', () => {
  const entry = (side?: FoldSide): ComponentEntry => ({ id: 'lib-body', name: 'Body', node: { id: 'body', title: 'Body', type: 'text', layout: { span: 1, ...(side ? { foldSide: side } : {}) }, props: { value: { type: 'literal', value: 'x' }, style: 'body', unavailableText: 'None' } } } as ComponentEntry);
  const ref = (side?: FoldSide): ComponentRefNode => ({ id: 'place', type: 'component-ref', componentId: 'lib-body', layout: { span: 1, ...(side ? { foldSide: side } : {}) } } as ComponentRefNode);
  it('gives the root the place\'s side', () => {
    expect((expandRef(ref('trailing'), entry()).layout as { foldSide?: string }).foldSide).toBe('trailing');
  });
  it('leaves Automatic automatic: the body\'s own word is not read', () => {
    expect((expandRef(ref(), entry('leading')).layout as { foldSide?: string }).foldSide).toBeUndefined();
  });
  it('is not mixed up between two places that differ only by side', () => {
    const library = entry();
    const a = expandRef({ ...ref('leading'), id: 'same' } as ComponentRefNode, library), b = expandRef({ ...ref('trailing'), id: 'same' } as ComponentRefNode, library);
    expect([(a.layout as { foldSide?: string }).foldSide, (b.layout as { foldSide?: string }).foldSide]).toEqual(['leading', 'trailing']);
  });
});

describe('the evaluation corpus pins the answers the app has to match', () => {
  const read = (name: string) => JSON.parse(readFileSync(path.join(corpus, `evaluation/fold-sides-${name}.json`), 'utf8')) as { expected: { foldsides: FoldAnswer } };
  const pairs = (name: string) => read(name).expected.foldsides.sides.map(item => `${item.id}:${item.side}`);
  it('writes a file for each case, with the sides the rule gives and the app\'s widths', () => {
    expect(pairs('strip-and-four-sections')).toEqual(['rail:span', 's1:leading', 's2:trailing', 's3:leading', 's4:trailing']);
    expect(read('strip-and-four-sections').expected.foldsides.sides.map(item => item.width)).toEqual([836, 423.3, 340.3, 423.3, 340.3]);
    expect(pairs('override-holds-its-count')).toEqual(['rail:span', 's1:leading', 's2:leading', 's3:leading', 's4:trailing']);
    expect(pairs('hidden-keeps-its-slot')).toEqual(['s1:leading', 's2:trailing', 's3:leading']);
    expect(pairs('component-ref-reads-its-body')).toEqual(['place-rail:span', 'place-a:leading', 'place-b:leading', 's3:leading']);
  });
  it('holds no slot for the banner or a pinned bar, and answers one column for a page that does not use the sides', () => {
    expect(pairs('banner-holds-no-slot')).toEqual(['s1:leading', 's2:trailing']);
    expect(pairs('pinned-bar-holds-no-slot')).toEqual(['s1:leading', 's2:trailing']);
    expect(read('switch-off-is-one-column').expected.foldsides).toEqual({ active: false, sides: [] });
  });
  it('lists the banner among no strips: it never holds a slot', () => {
    expect(stripTypes).toEqual(['status-rail']);
  });
});
