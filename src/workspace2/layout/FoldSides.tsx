import { useState } from 'react';
import { valueAt, type EditorPath } from '../../composition-editor';
import { foldSideWords, holdsSlot, type FoldSide } from '../../shared/composition/fold-sides';
import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { SelectField } from '../../ui';
import { SegmentRow } from '../SegmentRow';
import { useRows } from '../rows';
import { useSimulatorWindow } from '../simulatorWindow';
import {
  automaticSideAt, foldSidesShipped, isTopLevelPageComponent, overrideCount, pagesWithoutSides, partlyFoldedWindow, resetSides, setFoldSide, setPageSides, showsPartlyFolded, twoSidesOnEveryPage,
} from './fold-sides-edit';

/** The caption under the component row. */
export const SIDE_CAPTION = 'Where this section sits when iPhone Duo is partly folded sideways. Other windows are unchanged.';
/** Why the row is dimmed on a component that is not at the top of a page. */
export const NESTED_CAPTION = 'Only a page’s top-level sections take a side.';
/** Why the row is dimmed on a bar pinned over the page. */
export const PINNED_CAPTION = 'A bar pinned over the page takes no side.';
/** The caption under the page row. */
export const SIDES_CAPTION = 'Sections take a side of the fold when iPhone Duo is partly folded sideways.';

/** Said under the rows until the app ships `sh.fold-sides@1`: a publication that uses it is refused by the app, and the Studio warns when saving and publishing. */
export const WAITING_CAPTION = 'The app can’t show this yet. Publishing it waits for an app update.';

/** The words the Automatic choice names its side in: "Automatic (Leading)". */
const autoWords: Record<FoldSide, string> = { span: 'Across the Top', leading: 'Leading', trailing: 'Trailing' };
const choiceWords: Record<FoldSide, string> = { span: 'Across the Top', leading: 'Leading Side', trailing: 'Trailing Side' };

/**
 * The Partly Folded row of a component (`sh.fold-sides@1`): Automatic, Across the Top, Leading Side or Trailing Side, written to `layout.foldSide`. Automatic names the side it
 * resolves to. On a component that is not at the top of a page the row is dimmed and says why. The caption carries "Show Partly Folded" while the simulator is in another pose.
 * Off a page (a template's root in `componentLibrary`, a sheet) there is no side to take, so no row is drawn.
 * `path` is the component's own path (a place of a saved component, for its root).
 */
export function FoldSideRow({ path }: { path: EditorPath }) {
  const { document, onChange, problems } = useRows();
  const simulator = useSimulatorWindow();
  const node = valueAt(document, path) as CompositionNode | undefined;
  if (!node || path[0] !== 'pages') return null;
  const top = isTopLevelPageComponent(path), takesSide = top && holdsSlot(node);
  const said = (node.layout as { foldSide?: FoldSide }).foldSide;
  const resolved = automaticSideAt(document, path);
  const options = [
    { value: 'auto', label: resolved ? `Automatic (${autoWords[resolved]})` : 'Automatic' },
    ...foldSideWords.map(word => ({ value: word, label: choiceWords[word] })),
  ];
  const field = [...path, 'layout', 'foldSide'].join('/');
  const caption = !top ? NESTED_CAPTION : !takesSide ? PINNED_CAPTION : SIDE_CAPTION;
  return <div className="w2-row w2-fold-side" data-field-path={field}>
    <SelectField label="Partly Folded" value={said ?? 'auto'} options={options} disabled={!takesSide}
      onChange={next => onChange(setFoldSide(document, path, next === 'auto' ? undefined : next as FoldSide))}/>
    {problems?.get(field) && <p className="w2-error-text" data-field-problem={field}>{problems.get(field)}</p>}
    <p className="w2-caption" data-fold-caption>{caption}{takesSide && !foldSidesShipped() && <> {WAITING_CAPTION}</>}
      {takesSide && simulator && !showsPartlyFolded(simulator.window) && <> <button type="button" className="w2-link-button w2-inline-link" onClick={() => simulator.move(partlyFoldedWindow(simulator.window))}>Show Partly Folded</button></>}
    </p>
  </div>;
}

/** Where the one-time offer is remembered: it is made once, taken or not. */
const OFFER_KEY = 'studio.foldSides.everyPageOffered';
const offerTaken = (): boolean => { try { return globalThis.localStorage?.getItem(OFFER_KEY) === '1'; } catch { return false; } };
const markOffer = () => { try { globalThis.localStorage?.setItem(OFFER_KEY, '1'); } catch { /* a browser with no storage offers it again, which is harmless */ } };

/**
 * The Partly Folded row of a page: Two Sides (`layout.foldSides: 'auto'`) or One Column (the field gone), then "Reset Sides", which clears every section's own side in one undo step, and,
 * once, "Use two sides on every page".
 */
export function FoldSidesRow({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const [taken, setTaken] = useState(offerTaken);
  const page = valueAt(document, path) as CompositionDocument['pages'][number] | undefined;
  if (!page) return null;
  const on = page.layout.foldSides === 'auto', overrides = overrideCount(page);
  // Offered only once the app has shipped the id: until then a page on two sides would make the app refuse the publication.
  const offer = foldSidesShipped() && !taken && pagesWithoutSides(document).length > 0;
  return <div className="w2-row w2-fold-sides" data-field-path={[...path, 'layout', 'foldSides'].join('/')}>
    <SegmentRow label="Partly Folded" value={on ? 'auto' : 'off'} choices={[{ value: 'auto', label: 'Two Sides' }, { value: 'off', label: 'One Column' }]}
      onPick={next => onChange(setPageSides(document, path, next === 'auto'))}/>
    <p className="w2-caption">{SIDES_CAPTION}{!foldSidesShipped() && <> {WAITING_CAPTION}</>}</p>
    <div className="w2-fold-actions">
      <button type="button" className="w2-link-button" disabled={overrides === 0} onClick={() => onChange(resetSides(document, path))}>Reset Sides</button>
      {offer && <button type="button" className="w2-link-button" onClick={() => { markOffer(); setTaken(true); onChange(twoSidesOnEveryPage(document)); }}>Use Two Sides on Every Page</button>}
    </div>
  </div>;
}
