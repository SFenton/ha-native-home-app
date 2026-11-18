/**
 * The evaluation cases of `sh.fold-sides@1` (`contract/corpus/evaluation/fold-sides-*`): for a page's top-level components, the side of each and its width. The native app runs the same
 * files with its own rule and must agree on every one. The rule is `src/shared/composition/fold-sides.ts` (decision D1 of `studio-duo-sim`); the geometry is the iPhone Duo's partly folded
 * content (868 pt after the rail: 455.3 leading, a 40.4 band, 372.3 trailing) and the page's 16 pt padding kept at both edges of each side. Written by `scripts/generate-fold-sides-corpus.ts`
 * and listed by `scripts/generate-expression-corpus.ts`, which owns the folder.
 */
import { foldSidesAnswer, type FoldAnswerInput, type FoldAnswerItem } from '../src/shared/composition/fold-sides';

export interface FoldSidesEvaluation { name: string; note: string; subject: { foldsides: FoldAnswerInput }; env: Record<string, never>; expected: { foldsides: ReturnType<typeof foldSidesAnswer> } }
export const foldSidesEvaluations: FoldSidesEvaluation[] = [];

const duo = { leading: 455.3, band: 40.4, trailing: 372.3 };
const strip = (id: string, foldSide?: FoldAnswerItem['foldSide']): FoldAnswerItem => ({ id, type: 'status-rail', ...(foldSide ? { foldSide } : {}) });
const section = (id: string, foldSide?: FoldAnswerItem['foldSide'], more: Partial<FoldAnswerItem> = {}): FoldAnswerItem => ({ id, type: 'section', ...(foldSide ? { foldSide } : {}), ...more });
/** One case: the expected answer is computed by the shared rule, and `tests/fold-sides.test.ts` pins the few that matter by hand as well. */
const answerOf = (name: string, note: string, input: FoldAnswerInput) => {
  const subject = { foldsides: { geometry: duo, inset: 16, ...input } };
  foldSidesEvaluations.push({ name: `fold-sides-${name}`, note, subject, env: {}, expected: { foldsides: foldSidesAnswer(subject.foldsides) } });
};

answerOf('strip-and-four-sections', 'A status strip spans the top; the four sections lead and trail in turn, each side 16 pt in from both edges.', { foldSides: 'auto', items: [strip('rail'), section('s1'), section('s2'), section('s3'), section('s4')] });
answerOf('two-strips-span', 'The run of strips at the top all span.', { foldSides: 'auto', items: [strip('rail-a'), strip('rail-b'), section('s1'), section('s2')] });
answerOf('strip-after-a-section-is-a-section', 'A strip after a section ends no run: it takes its turn like any section.', { foldSides: 'auto', items: [section('s1'), strip('rail'), section('s2')] });
answerOf('override-holds-its-count', 'The second section pinned leading still holds its position in the count: the third, at position two, leads and the fourth trails.', { foldSides: 'auto', items: [strip('rail'), section('s1'), section('s2', 'leading'), section('s3'), section('s4')] });
answerOf('span-before-any-section', 'Across the Top on the first components, before any section takes a side.', { foldSides: 'auto', items: [section('banner', 'span'), strip('rail'), section('s1'), section('s2')] });
answerOf('explicit-sides-no-switch', 'A section pinned to a side turns the two sides on with no page switch; the others alternate.', { items: [section('s1', 'leading'), section('s2', 'trailing'), section('s3')] });
answerOf('all-leading', 'Every section pinned leading: the trailing side stays empty.', { foldSides: 'auto', items: [section('s1', 'leading'), section('s2', 'leading')] });
answerOf('switch-off-is-one-column', 'No switch and no side: the page is one column, whatever else it holds.', { items: [strip('rail'), section('s1'), section('s2')] });
answerOf('hidden-keeps-its-slot', 'A section a rule hides at run time keeps its slot, so the sections after it keep their sides.', { foldSides: 'auto', items: [section('s1'), section('s2', undefined, { hiddenByRule: true }), section('s3')] });
answerOf('component-ref-reads-its-body', 'A use of a saved component counts by its body: a strip body spans, a section body takes its turn.', { foldSides: 'auto', items: [{ id: 'place-rail', type: 'component-ref', bodyType: 'status-rail' }, { id: 'place-a', type: 'component-ref', bodyType: 'section' }, { id: 'place-b', type: 'component-ref', bodyType: 'section', foldSide: 'leading' }, section('s3')] });
answerOf('banner-holds-no-slot', 'The notification banner is filtered out statically: it holds no slot, so the first section leads.', { foldSides: 'auto', items: [{ id: 'alerts', type: 'notification-permission-banner' }, section('s1'), section('s2')] });
answerOf('pinned-bar-holds-no-slot', 'A pinned bar takes no side and holds no slot, and a `foldSide` on it is ignored.', { foldSides: 'auto', items: [section('s1'), { id: 'bar', type: 'pinned-actions', foldSide: 'leading' }, section('s2')] });
