/**
 * The corpus cases of `sh.fold-sides@1`: an optional `layout.foldSides: 'auto'` on a page and an optional `layout.foldSide` (`span`, `leading` or `trailing`) on a
 * page's top-level components, a `component-ref` among them.
 *
 *   tsx scripts/generate-fold-sides-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}fold-sides-*.json and their index entries
 *
 * Accepted cases are `accept/fold-sides-*` (the id is shipped, so the Studio compiles them and the app's list accepts them, `contract/corpus/README.md`, Promotion);
 * refusals are `reject/fold-sides-*` with the Studio's first issue written here by hand. A document with none of the fields needs no id and is an ordinary accept.
 * Demo ids only. The automatic rule these documents rely on is `src/shared/composition/fold-sides.ts` (decision D1 of `studio-duo-sim`); `tests/fold-sides.test.ts` pins its answers.
 */
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { foldSidesEvaluations } from './fold-sides-evaluations';
import { at, lit, node, PAGE, root, writeFamily, type J, type TileCase } from './tilecontract-lib';

const cases: TileCase[] = [];
const accept = (name: string, note: string, components: J[], tweak?: TileCase['tweak']) => cases.push({ name: `pending-fold-sides-${name}`, note, needs: ['fold-sides'], components, reject: false, tweak });
const plain = (name: string, note: string, components: J[], tweak?: TileCase['tweak']) => cases.push({ name: `fold-sides-${name}`, note, needs: [], components, reject: false, tweak });
const reject = (name: string, note: string, components: J[], expect: TileCase['expect'], tweak?: TileCase['tweak']) => cases.push({ name: `fold-sides-${name}`, note, needs: ['fold-sides'], components, reject: true, expect, tweak });

// MARK: Builders
const words = (id: string, side?: string, rest: J = {}): J => node(id, 'text', {
  props: { value: lit(`Words of ${id}`), style: 'body', unavailableText: 'None' }, ...rest, ...(side ? { layout: { span: 1, foldSide: side } } : {}),
});
const strip = (id: string, side?: string): J => node(id, 'status-rail', { props: {}, children: [], ...(side ? { layout: { span: 1, foldSide: side } } : {}) });
const library = (...bodies: J[]) => (envelope: J) => { envelope.document.componentLibrary = bodies.map(body => ({ id: `lib-${body.id}`, name: `Library ${body.id}`, node: body })); };
const ref = (id: string, componentId: string, side?: string): J => ({ id, type: 'component-ref', componentId, layout: { span: 1, ...(side ? { foldSide: side } : {}) } });
/** Turns the page switch on for the page the cases fill. */
const auto = (envelope: J) => { envelope.document.pages[PAGE].layout.foldSides = 'auto'; };
const autoWith = (...more: ((envelope: J) => void)[]) => (envelope: J) => { auto(envelope); more.forEach(step => step(envelope)); };
const sidePath = (index: number) => at(index, '/layout/foldSide');
const four = (): J[] => [words('s1'), words('s2'), words('s3'), words('s4')];

// MARK: Accepted
accept('auto-strip-and-four-sections', 'The page switch on, a status strip and four sections: the strip spans, the sections lead and trail in turn.', [strip('rail'), ...four()], auto);
accept('auto-one-override', 'The page switch on with the third section pinned to the trailing side: the rest keep their turns.', [strip('rail'), words('s1'), words('s2'), words('s3', 'trailing'), words('s4')], auto);
accept('explicit-sides-no-switch', 'Two sections pinned to sides and no page switch: a placed component alone turns the two sides on.', [words('s1', 'leading'), words('s2', 'trailing'), words('s3')]);
accept('one-side-only', 'Every section pinned leading: the trailing side stays empty.', [words('s1', 'leading'), words('s2', 'leading')]);
accept('switch-alone', 'The page switch on a page of one section: the section leads and the trailing side stays empty.', [words('only')], auto);
accept('span-across-the-top', 'Across the Top on the first components, before any section takes a side.', [words('banner', 'span'), strip('rail', 'span'), words('s1'), words('s2')], auto);
accept('hidden-keeps-its-slot', 'A section a rule hides at run time keeps its slot, so the sections after it keep their sides.', [
  words('s1'), words('s2', undefined, { visibleWhen: { type: 'state', sourceId: 'blinds', path: ['state'], in: ['open'] } }), words('s3'),
], auto);
accept('component-ref-carries-a-side', 'A use of a saved component says its own side: the place says where it sits, the body does not.', [ref('place-a', 'lib-body', 'trailing'), ref('place-b', 'lib-body'), words('s3')],
  autoWith(library(words('body'))));
accept('component-ref-without-a-side', 'A use of a saved component with no side takes the automatic one.', [ref('place-a', 'lib-body'), ref('place-b', 'lib-body')], autoWith(library(words('body'))));
plain('no-fields-needs-no-id', 'A page with no side field is today\'s page and needs no new id.', four());

// MARK: Refused
reject('nested-in-a-grid', 'Only a page\'s top-level components take a side: a tile grid\'s child does not.', [
  node('grid', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' }, children: [words('nested', 'trailing')] }),
], { code: 'invalid_combination', pointer: at(0, '/children/0/layout/foldSide') }, auto);
reject('nested-in-a-section', 'A section\'s own child is nested too.', [
  node('box', 'section', { props: { header: 'Box', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: [words('inner', 'leading')] }),
], { code: 'invalid_combination', pointer: at(0, '/children/0/layout/foldSide') });
reject('in-a-sheet', 'A sheet\'s components take no side: the sides belong to a page.', [words('s1')], { code: 'invalid_combination', pointer: '/document/modals/0/components/0/layout/foldSide' },
  envelope => { envelope.document.modals[0].components = [words('sheet-words', 'leading')]; });
reject('span-after-a-placed-section', 'Across the Top has to come before the first section that takes a side.', [words('s1'), words('s2', 'span'), words('s3')], { code: 'invalid_combination', pointer: sidePath(1) }, auto);
reject('span-after-an-explicit-side', 'A section pinned to a side ends the top: a later Across the Top is refused.', [words('s1', 'leading'), strip('rail', 'span')], { code: 'invalid_combination', pointer: sidePath(1) });
reject('span-after-a-plain-section', 'A plain section ends the top, as a placed one does.', [strip('rail'), words('s1'), strip('late', 'span')], { code: 'invalid_combination', pointer: sidePath(2) }, auto);
reject('side-word-unknown', 'The sides are span, leading and trailing.', [words('s1', 'middle')], { code: 'unknown_variant', pointer: sidePath(0) }, auto);
reject('switch-word-unknown', 'The page switch has one word, auto.', [words('s1')], { code: 'unknown_variant', pointer: `/document/pages/${PAGE}/layout/foldSides` },
  envelope => { envelope.document.pages[PAGE].layout.foldSides = 'always'; });
reject('switch-on-a-sheet', 'A sheet has no page switch.', [words('s1')], { code: 'unknown_field', pointer: '/document/modals/0/layout/foldSides' },
  envelope => { envelope.document.modals[0].layout.foldSides = 'auto'; });
reject('body-names-a-side', 'A saved component\'s body does not say where it sits: each use does.', [ref('place', 'lib-body')], { code: 'invalid_combination', pointer: '/document/componentLibrary/0/node/layout/foldSide' },
  library(words('body', 'leading')));
reject('capability-not-declared', 'A page with a side whose manifest lacks `sh.fold-sides@1` does not match.', [words('s1', 'trailing')], { code: 'capability_manifest_mismatch', pointer: '/capabilities' });
cases[cases.length - 1].finish = envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.fold-sides@1'); };
reject('switch-capability-not-declared', 'A page switch whose manifest lacks `sh.fold-sides@1` does not match.', [words('s1')], { code: 'capability_manifest_mismatch', pointer: '/capabilities' }, auto);
cases[cases.length - 1].finish = envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.fold-sides@1'); };

writeFamily('fold-sides', cases, { 'fold-sides': 'sh.fold-sides@1' });

// MARK: Evaluation
// `scripts/generate-expression-corpus.ts` owns the folder and lists these too; this writes only the family's own files so it can run alone.
const evaluationRoot = path.join(root, 'evaluation');
mkdirSync(evaluationRoot, { recursive: true });
for (const name of readdirSync(evaluationRoot)) if (name.startsWith('fold-sides-') && name.endsWith('.json')) unlinkSync(path.join(evaluationRoot, name));
for (const { name, ...rest } of foldSidesEvaluations) writeFileSync(path.join(evaluationRoot, `${name}.json`), `${JSON.stringify({ format: 1, name, ...rest }, null, 2)}\n`);
console.log(`fold-sides: wrote ${foldSidesEvaluations.length} evaluation cases`);
