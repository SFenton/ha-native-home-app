/**
 * The cost of the first edit after a structural change, when the edit boundary has no dependency index for the revision
 * and builds one. Index building memoizes per-owner and per-root work by the identity of the committed objects it reads
 * (see `documentEdit.ts`), so a rebuild after a structural edit costs what the edit changed, not the whole document.
 *
 * The fixture is the binding invariant suite's per-edit overhead document (copied tiles, each with an automatic binding
 * and a canvas root; at 256, half are component parameters on a forked template). Medians print as
 * `Edit boundary cost: ...`; the 256-binding first edit after a single-tile insert is gated, everything else reports.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { replaceAt, valueAt } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { encodeStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import type { CompositionDocument, CompositionNode } from '../../../src/shared/composition/schema';
import { MAX_LOGIC_USE_BINDINGS, studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import { documentEdit } from '../../../src/workspace2/editors/documentEdit';
import { copySubtree, editSubtrees } from '../../../src/workspace2/editors/provenance';
import { fieldPointer, liftField } from '../../../src/workspace2/logic-fields/registry';
import { certifiedAnswers, CERTIFIED_PER_HOLDER } from '../../../src/workspace2/logic-fields/layout';
import { resolveLogicAnchor } from '../../../src/shared/composition/studio-logic/anchors';
import type { StoredStudioCanvasMetadata } from '../../../src/shared/composition/studio-logic/schemas';
import { forkPlace } from '../../../src/workspace2/linked';
import { toastManager } from '../../../src/workspace2/toasts';
import { sameJson } from '../../../src/sameJson';
import { draftDocument, tile } from '../draft/fixtures';
import { meaningFixture, withMeaningCanvas } from './meaning-fixtures';
import { documentEdit as oracleEdit } from './oracle/documentEdit';

type Doc = CompositionDocument;

/** The per-edit overhead document of `binding-invariant.test.tsx` with `count` bindings. */
function document(count: number): Doc {
  const fixture = meaningFixture('page tile');
  let before: Doc = withMeaningCanvas(fixture.document, fixture.slot);
  const root = ['pages', 0, 'components', 0], copied = [], pages = before.pages.map(page => ({ ...page, components: [...page.components] }));
  const automaticCount = Math.min(count, MAX_LOGIC_USE_BINDINGS);
  for (let index = before.logicUseBindings!.length; index < automaticCount; index++) {
    const page = index < 64 ? 0 : 1, nodes = pages[page].components;
    copied.push({ from: root, to: ['pages', page, 'components', nodes.length] });
    nodes.push({ ...copySubtree(before.pages[0].components[0]), id: `perf-copy-${index}` });
  }
  if (copied.length) before = documentEdit(before, { ...before, pages }, { copied });
  expect(before.logicUseBindings).toHaveLength(automaticCount);
  if (count > automaticCount) {
    const childrenPath = ['componentLibrary', before.componentLibrary!.length - 1, 'node', 'children'];
    const children = [...valueAt(before, childrenPath) as CompositionNode[]];
    for (let index = 1; index < (count - automaticCount) / 2; index++) children.push({ ...copySubtree(children[0]), id: `perf-parameter-${index}` });
    before = editSubtrees(before, replaceAt(before, childrenPath, children));
    const placement = before.pages[0].components.find(node => node.type === 'component-ref' && node.componentId === before.componentLibrary!.at(-1)!.id)!;
    before = forkPlace(before, placement.id, 'Performance parameters').document;
  }
  return before;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const spacer = (id: string) => ({ ...tile(id, 'source-a'), props: { family: 'neutral', selected: 'navigation-path', titleProviderId: 'source-a' } }) as unknown as CompositionNode;
/** Run `measure` 5 times to warm up, then 15 times; the median of the last 15. */
function sample(measure: (index: number) => number): number {
  const samples: number[] = [];
  for (let index = -5; index < 15; index++) {
    const elapsed = measure(index);
    if (index >= 0) samples.push(elapsed);
  }
  return median(samples);
}
function timed<T>(run: () => T): [T, number] {
  const start = performance.now(), result = run();
  return [result, performance.now() - start];
}

describe('edit boundary cost after structural edits', () => {
  let toast: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { toast = vi.spyOn(toastManager, 'add').mockImplementation(() => ''); });
  afterAll(() => toast.mockRestore());

  it.each([3, 18, 66, 256])('reports the first edit after a structural change (%i bindings)', count => {
    let before = document(count);
    before = documentEdit(before, { ...before, name: 'Indexed' });
    const roots = studioCanvasMetadataSchema.parse(before.studioCanvas).canvases.flatMap(canvas => canvas.roots).length;
    const report = (edit: string, value: number, gate?: number) => process.stdout.write(`Edit boundary cost: ${count} bindings (${roots} canvas roots); ${edit}; median ${value.toFixed(4)} ms; ${gate === undefined ? 'report-only' : `<=${gate}ms gate`}.\n`);

    // A revision nothing indexed, sharing every owner with an indexed one.
    report('first edit of an unindexed revision', sample(index => {
      const from = { ...before, name: `Unindexed ${index}` }, proposed = { ...from, name: `Edited ${index}` };
      const [result, elapsed] = timed(() => documentEdit(from, proposed));
      expect(result).toBe(proposed);
      return elapsed;
    }));

    // A tile inserted at the end of the bound page (accepted), then the next edit, which indexes the inserted revision.
    let current = before;
    const inserts: number[] = [], firsts: number[] = [];
    for (let index = -5; index < 15; index++) {
      const proposed = replaceAt(current, ['pages', 0, 'components'], [...current.pages[0].components, spacer(`appended-${count}-${index}`)]);
      const [inserted, insert] = timed(() => documentEdit(current, proposed));
      expect(inserted).toBe(proposed);
      const renamed = { ...inserted, name: `After insert ${index}` };
      const [result, first] = timed(() => documentEdit(inserted, renamed));
      expect(result).toBe(renamed);
      current = result;
      if (index >= 0) { inserts.push(insert); firsts.push(first); }
    }
    report('single-tile insert at the end of the bound page', median(inserts));
    const gate = count === 256 ? 5 * (Number(process.env.EDIT_BOUNDARY_SLOWDOWN) || 1) : undefined;
    report('first edit after a single-tile insert', median(firsts), gate);

    // A tile inserted at the top of the bound page (shifting every bound tile there), then the next edit.
    const tops: number[] = [], afterTops: number[] = [];
    current = before;
    for (let index = -5; index < 15; index++) {
      const proposed = replaceAt(current, ['pages', 0, 'components'], [spacer(`top-${count}-${index}`), ...current.pages[0].components]);
      const [inserted, insert] = timed(() => documentEdit(current, proposed));
      expect(inserted).toBe(proposed);
      const renamed = { ...inserted, name: `After top insert ${index}` };
      const [result, first] = timed(() => documentEdit(inserted, renamed));
      expect(result).toBe(renamed);
      current = result;
      if (index >= 0) { tops.push(insert); afterTops.push(first); }
    }
    report('insert before every bound tile', median(tops));
    report('first edit after inserting before every bound tile', median(afterTops));
    if (gate !== undefined) expect(median(firsts)).toBeLessThanOrEqual(gate);
  }, 60_000);

  it('the memoized index agrees with the whole-document reconciliation across structural edits at 66 bindings', () => {
    let before = document(66), oracleBefore = before;
    for (let index = 0; index < 6; index++) {
      const at = index % 2 ? 0 : before.pages[0].components.length;
      const components = [...before.pages[0].components];
      components.splice(at, 0, spacer(`agree-${index}`));
      const proposed = replaceAt(before, ['pages', 0, 'components'], components);
      const scoped = documentEdit(before, proposed), oracle = oracleEdit(oracleBefore, proposed);
      expect(scoped === before).toBe(oracle === oracleBefore);
      expect(sameJson(scoped, oracle)).toBe(true);
      before = scoped; oracleBefore = oracle;
      // An undeclared rebuild of a slot (bound or not) on the rebuilt index: both decide alike.
      const slot = ['pages', 0, 'components', index % 3, 'props', 'subtitle'];
      const rebuilt = replaceAt(before, slot, structuredClone(valueAt(before, slot)));
      const scopedRebuild = documentEdit(before, rebuilt), oracleRebuild = oracleEdit(before, rebuilt);
      expect(scopedRebuild === before).toBe(oracleRebuild === before);
      expect(sameJson(scopedRebuild, oracleRebuild)).toBe(true);
    }
  });

  /**
   * A canvas root over one slot whose own lifted graph has `2 * depth` nodes (a chain of sums), saved with every node, and
   * the index primed. Then the field editor's declared typing in that slot: a carried rebase of that one root, then its
   * certification against the result. Counts the origin lookups (`Set.prototype.has` of a pointer) during that edit: every
   * check of a lifted node's origin against a saved node's.
   */
  function rootOriginChecks(depth: number): number {
    let value: unknown = { type: 'literal', value: 0 };
    for (let at = 1; at < depth; at++) value = { type: 'math', op: 'add', args: [{ type: 'literal', value: at }, value] };
    const base = { ...compileCompositionDocument(draftDocument()).document, logicUseBindings: [] } as Doc;
    const node = tile('large-root', 'source-a'), path = ['pages', 0, 'components', 0, 'props', 'subtitle'];
    let document = replaceAt(base, ['pages', 0, 'components'], [{ ...node, props: { ...node.props, subtitle: { type: 'expr', value, fallback: 'Fallback' } } }]);
    const graph = liftField(document, path, 'slot').graph;
    expect(graph.nodes).toHaveLength(2 * depth);
    document = { ...document, studioCanvas: encodeStudioCanvas(document, [{ id: 'large', roots: [{ anchor: graph.roots[0].anchor,
      nodes: graph.nodes.map((lifted, at) => ({ id: lifted.id, origins: lifted.origins, x: at * 40, y: 0 })) }] }]) };
    const before = documentEdit(document, { ...document, name: 'Primed' }), pointer = fieldPointer(path);
    const proposed = replaceAt(before, [...path, 'fallback'], 'Typed');
    const has = Set.prototype.has;
    let calls = 0;
    // Origins are pointers below the root's field ('' for the field itself); other set lookups (schema keys, say) are not.
    Set.prototype.has = function (this: Set<unknown>, value: unknown) {
      if (typeof value === 'string' && (value === '' || value.startsWith('/'))) calls++;
      return has.call(this, value);
    };
    let result: Doc;
    try { result = documentEdit(before, proposed, { fields: new Map([[pointer, [pointer]]]) }); } finally { Set.prototype.has = has; }
    // Accepted, with the root's typed node carried to its new lifted ID, exactly as the whole-document rebase does.
    expect(result).not.toBe(before);
    expect(sameJson(result, oracleEdit(before, proposed, { fields: new Map([[pointer, [pointer]]]) }))).toBe(true);
    return calls;
  }

  it('keeps a bounded number of certification answers for a root moved again and again', () => {
    const fixture = meaningFixture('page tile');
    let before: Doc = withMeaningCanvas(fixture.document, fixture.slot), oracleBefore = before;
    const stored = before.studioCanvas as StoredStudioCanvasMetadata, root = stored.canvases[0].roots[0];
    const holder = resolveLogicAnchor(before, root.anchor)!.node!.value;
    for (let move = 1; move <= 200; move++) {
      // Each move drags the root's first node; the next one indexes (and certifies) the revision this one made.
      const layout = before.studioCanvas as StoredStudioCanvasMetadata;
      const proposed = { ...before, studioCanvas: { ...layout, canvases: layout.canvases.map((canvas, at) => at ? canvas
        : { ...canvas, nodes: canvas.nodes.map(node => node.rootId === root.id && node.id === canvas.nodes[0].id ? { ...node, x: node.x + 1 } : node) }) } };
      const references = { layout: [fixture.slot] };
      const scoped = documentEdit(before, proposed, references);
      expect(scoped).toBe(proposed);
      if (move % 50 === 0) expect(sameJson(scoped, oracleEdit(oracleBefore, proposed, references))).toBe(true);
      before = scoped; oracleBefore = scoped;
    }
    // The tile itself was never rebuilt: every move's certification was memoized against it.
    expect(resolveLogicAnchor(before, root.anchor)!.node!.value).toBe(holder);
    const kept = certifiedAnswers(holder);
    process.stdout.write(`Edit boundary cost: 200 layout moves of one root; ${kept} certification answers kept for its node.\n`);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThanOrEqual(CERTIFIED_PER_HOLDER);
  });

  it('matches the stored nodes of a large canvas root by origin, linearly in the root\'s own graph', () => {
    const small = rootOriginChecks(10), large = rootOriginChecks(20);
    process.stdout.write(`Edit boundary cost: one canvas root of 20 and of 40 lifted nodes; declared slot typing; ${small} and ${large} origin lookups.\n`);
    // Matching every saved node against every lifted node (in the rebase, then again in certification) is 2 * 40 * 40
    // lookups for 40 nodes; by origin, each saved node checks only the lifted nodes sharing an origin with it.
    expect(large).toBeLessThanOrEqual(4 * 40);
    expect(large).toBeLessThan(2.5 * small);
  });
});
