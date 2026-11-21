import { describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { compositionSourceText, moveCompositionNode, valueAt } from '../src/composition-editor';
import { importCompositionText } from '../src/workspace2/editors/importDocument';
import { buildDocumentIndex } from '../src/preview2/model';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { normaliseFoldSides } from '../src/shared/composition/fold-sides-normalise';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { endOf } from '../src/workspace2/add/insert';
import { moveToSlot } from '../src/workspace2/dnd/moves';
import { setFoldSide } from '../src/workspace2/layout/fold-sides-edit';
import { deleteComponent, forkPlace, insertPlace, saveAsComponent, unlinkPlace } from '../src/workspace2/linked';
import { duplicateNode, moveNodeBy, moveNodeTo, putControlsOnTop, takeOffOverlay } from '../src/workspace2/nodeActions';
import { insertMade } from '../src/workspace2/add/insert';

const home = homeDomains.document as unknown as CompositionDocument;
const h = home.pages.findIndex(page => page.id === 'page-home');
const top = (at: number) => ['pages', h, 'components', at];
/** The home page with a side on its weather panel (1) and on its Cameras section (3). */
const pinned = setFoldSide(setFoldSide(home, top(1), 'leading'), top(3), 'trailing');
const idAt = (at: number) => (pinned.pages[h].components[at] as CompositionNode).id;
const sideOf = (node: unknown) => (node as { layout?: { foldSide?: string } }).layout?.foldSide;

/** Every node that holds a side must be a top-level component of a page. */
function stray(document: CompositionDocument): string[] {
  const out: string[] = [];
  for (const entry of buildDocumentIndex(document).entries.values()) {
    if (!entry.node || sideOf(entry.node) === undefined) continue;
    if (!(entry.path.length === 4 && entry.path[0] === 'pages' && entry.path[2] === 'components')) out.push(entry.node.id);
  }
  for (const entry of document.componentLibrary ?? []) if (JSON.stringify(entry.node).includes('"foldSide"')) out.push(entry.id);
  return out;
}

const operations: [string, () => CompositionDocument][] = [
  ['move down', () => moveNodeBy(pinned, top(1), 1)],
  ['move into a section (menu)', () => moveNodeTo(pinned, idAt(1), { kind: 'section', id: idAt(3) })],
  ['move into a sheet (menu)', () => moveNodeTo(pinned, idAt(1), { kind: 'surface', id: 'hc-weather-sheet' })],
  ['move into a section (drag)', () => { const e = buildDocumentIndex(pinned).get(`node:${idAt(1)}`)!; return moveToSlot(pinned, e.key, { ...endOf(pinned, `node:${idAt(3)}`)!, index: 0 }).document; }],
  ['move into a sheet (drag)', () => { const e = buildDocumentIndex(pinned).get(`node:${idAt(1)}`)!; return moveToSlot(pinned, e.key, { ...endOf(pinned, 'modal:hc-weather-sheet')!, index: 0 }).document; }],
  ['put controls on top (overlay)', () => putControlsOnTop(pinned, top(1))],
  ['put controls on top of a section', () => putControlsOnTop(pinned, top(3))],
  ['take the overlay off again', () => takeOffOverlay(putControlsOnTop(pinned, top(1)), top(1))],
  ['duplicate a section', () => duplicateNode(pinned, top(3)).document],
  ['paste a copy into a section', () => { const copy = structuredClone(pinned.pages[h].components[1]) as CompositionNode; copy.id = 'pasted-copy'; return insertMade(pinned, { ...endOf(pinned, `node:${idAt(3)}`)!, index: 0 }, { node: copy, sources: [] } as never).document; }],
  ['paste a copy into a sheet', () => { const copy = structuredClone(pinned.pages[h].components[1]) as CompositionNode; copy.id = 'pasted-copy'; return insertMade(pinned, { ...endOf(pinned, 'modal:hc-weather-sheet')!, index: 0 }, { node: copy, sources: [] } as never).document; }],
  ['save as template', () => saveAsComponent(pinned, top(3), 'Side Template').document],
  ['unlink a place', () => unlinkPlace(saveAsComponent(pinned, top(3), 'Side Template').document, top(3))],
  ['delete a template', () => { const s = saveAsComponent(pinned, top(3), 'Side Template'); return deleteComponent(s.document, s.entryId); }],
  ['place a template in a section', () => { const s = saveAsComponent(pinned, top(1), 'Weather Template'); return insertPlace(s.document, s.entryId, { ...endOf(s.document, `node:${idAt(3)}`)!, index: 0 }).document; }],
  ['fork a place', () => { const s = saveAsComponent(pinned, top(3), 'Side Template'); return forkPlace(s.document, idAt(3), 'Forked').document; }],
  ['import', () => importCompositionText(compositionSourceText(pinned), pinned.id)],
];

describe('every structural edit leaves no side where the compiler refuses one (sh.fold-sides@1)', () => {
  it('starts from a document with two sides that compiles', () => {
    expect(stray(pinned)).toEqual([]);
    expect(() => compileCompositionDocument(pinned)).not.toThrow();
  });
  it.each(operations)('%s: once normalised, nothing is stray and the document compiles', (_name, run) => {
    const result = normaliseFoldSides(run());
    expect(stray(result)).toEqual([]);
    expect(() => compileCompositionDocument(result)).not.toThrow();
  });
  it('keeps the sides of components that stay at the top of the page', () => {
    const moved = normaliseFoldSides(moveNodeBy(pinned, top(1), 1));
    expect(moved.pages[h].components.map(sideOf).filter(Boolean)).toEqual(['leading', 'trailing']);
    const placed = normaliseFoldSides(saveAsComponent(pinned, top(3), 'Side Template').document);
    expect(sideOf(valueAt(placed, top(3)))).toBe('trailing');
  });
  it('puts the side on the overlay when controls go on top, and back on the base when it is taken off', () => {
    const wrapped = putControlsOnTop(pinned, top(1));
    expect(sideOf(valueAt(wrapped, top(1)))).toBe('leading');
    expect(sideOf((valueAt(wrapped, top(1)) as { children: unknown[] }).children[0])).toBeUndefined();
    expect(sideOf(valueAt(takeOffOverlay(wrapped, top(1)), top(1)))).toBe('leading');
  });
  it('compiles the Put Controls on Top of a section that has a side, with the side on the overlay', () => {
    const wrapped = normaliseFoldSides(putControlsOnTop(pinned, top(3)));
    expect(sideOf(valueAt(wrapped, top(3)))).toBe('trailing');
    expect(() => compileCompositionDocument(wrapped)).not.toThrow();
  });
  it('returns the same document when there is nothing to remove, so untouched parts keep their identity', () => {
    expect(normaliseFoldSides(pinned)).toBe(pinned);
    const nested = moveCompositionNode(pinned, idAt(1), { kind: 'surface', id: 'hc-weather-sheet' });
    expect(normaliseFoldSides(nested).pages).toBe(nested.pages);
  });
});
