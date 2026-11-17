import { valueAt, type EditorPath } from '../../composition-editor';
import type { OverlayAnchor } from '../../shared/composition/schema';
import { overlayInsets, setOverlayPosition } from '../nodeActions';
import { ChoiceRow } from '../SegmentRow';
import { useRows } from '../rows';

/** The five places and where each sits in the picture (column, row of a 3 by 3 grid), with the words a screen reader says. */
const points: readonly { anchor: OverlayAnchor; label: string; at: [number, number] }[] = [
  { anchor: 'top-leading', label: 'Top Leading', at: [1, 1] }, { anchor: 'top-trailing', label: 'Top Trailing', at: [3, 1] },
  { anchor: 'center', label: 'Center', at: [2, 2] },
  { anchor: 'bottom-leading', label: 'Bottom Leading', at: [1, 3] }, { anchor: 'bottom-trailing', label: 'Bottom Trailing', at: [3, 3] },
];

type OverlayLike = { type?: string; children: { id: string }[]; props: { anchors: { childId: string; anchor: OverlayAnchor; inset: { type: string; value?: number } }[] } };

/**
 * The Position group of a control on top of an Overlay: a picture with five points (a radio group, 132 by 88 with 28 px points, larger on a
 * coarse pointer), and an Inset pop-up. Shown for a child of an Overlay other than its base.
 */
export default function ChildPosition({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const parentPath = path.slice(0, -2), index = Number(path.at(-1));
  const parent = path.at(-2) === 'children' ? valueAt(document, parentPath) as OverlayLike | undefined : undefined;
  if (!parent || parent.type !== 'overlay' || index < 1) return null;
  const child = parent.children[index];
  const kept = parent.props.anchors.find(item => item.childId === child.id);
  const anchor = kept?.anchor ?? 'top-trailing', inset = kept?.inset.type === 'points' ? kept.inset.value ?? 12 : 12;
  const choose = (next: OverlayAnchor, points?: number) => onChange(setOverlayPosition(document, parentPath, child.id, next, points));
  return <section className="w2-group" data-group="position" aria-label="Position">
    <h3 className="w2-group-title">Position</h3>
    <div className="w2-position-picker" role="radiogroup" aria-label="Place on the base">
      {points.map(point => <button key={point.anchor} type="button" role="radio" aria-checked={anchor === point.anchor} aria-label={point.label} className="w2-position-point"
        style={{ gridColumn: point.at[0], gridRow: point.at[1] }} onClick={() => choose(point.anchor)}/>)}
    </div>
    <ChoiceRow label="Inset" value={String(inset)} options={overlayInsets.map(item => ({ value: String(item.value), label: item.label }))} onChange={next => choose(anchor, Number(next))}/>
    <p className="w2-caption">Left and right swap in right-to-left languages.</p>
  </section>;
}
