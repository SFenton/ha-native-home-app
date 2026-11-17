import { Link2 } from 'lucide-react';
import { replaceAt } from '../../composition-editor';
import { LabeledRow, Switch, TextInput } from '../editors/controls';
import { Tag } from '../kit';
import { useEntityNames, useRows } from '../rows';
import { sourceName } from '../dialogs/sources';
import { mapNodeAt, vacuumSourceOf, withFlips } from './mapControls';
import type { EditorPath } from '../../composition-editor';

/**
 * The map's Orientation group: Flip Horizontally and Flip Vertically (both on is the owner's "invert") beside the vacuum's Rotation. It edits the
 * vacuum source, the one piece every map, area editor and report of that vacuum reads, so it is set once; a Linked tag names that source
 * (`sh.surface-orientation@1`, `build/design/vacuum-map-ctl.md`, Orientation).
 */
export default function MapOrientation({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const names = useEntityNames();
  const map = mapNodeAt(document, path), source = map && vacuumSourceOf(document, map);
  if (!map || !source) return null;
  const flip = source.inputs.orientation;
  const horizontal = flip?.flipHorizontal === true, vertical = flip?.flipVertical === true;
  const rotationPath: EditorPath = ['dataSources', map.sourceIndex, 'inputs', 'mapRotationDegrees'];
  return <section className="w2-group" data-group="orientation" aria-label="Orientation">
    <h3 className="w2-group-title">Orientation <Tag className="w2-mc-linked"><Link2 size={12} aria-hidden/> Linked: {sourceName(source, names)}</Tag></h3>
    <div className="w2-row"><Switch label="Flip Horizontally" checked={horizontal} onChange={on => onChange(withFlips(document, map, on, vertical))}/></div>
    <div className="w2-row"><Switch label="Flip Vertically" checked={vertical} onChange={on => onChange(withFlips(document, map, horizontal, on))}/></div>
    <div className="w2-row"><LabeledRow label="Rotation"><TextInput number label="Rotation" value={String(source.inputs.mapRotationDegrees)}
      onCommit={text => { const value = Number(text); if (text.trim() !== '' && Number.isFinite(value) && value >= -360 && value <= 360) onChange(replaceAt(document, rotationPath, value)); }}/></LabeledRow></div>
    <p className="w2-caption">Applies everywhere this vacuum's map shows. Badges and buttons never mirror.</p>
  </section>;
}
