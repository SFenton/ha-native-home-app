import { valueAt, type EditorPath } from '../../composition-editor';
import ValueField from '../expr/ValueField';
import { useRows } from '../rows';

/** A readout's Tone: one of six words, or Rules that pick one by state (the value field's Rules mode, writing a `conditional`). Tone changes the color only. */
export default function ToneField({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const node = valueAt(document, path) as { title?: string } | undefined;
  return <div className="w2-row">
    <ValueField label="Tone" path={[...path, 'props', 'tone']} kind="color" look="tone" itemName={node?.title ?? 'Readout'} modes={['fixed', 'rules']}/>
    <p className="w2-caption">Tone changes the color only. Say the same thing in the icon or the text.</p>
  </div>;
}
