import type { Json } from '../../shared/types';
import CompositionFields from '../../CompositionFields';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { fieldOptions, useRows } from '../rows';
import type { Workspace2 } from '../useWorkspace2';
import { newerAppCaption, PAGE_WIDE_OPEN_CAPABILITY, setWideOpen, wideChoices, wideFooters, wideOpenOf, type WideOpen } from './chromeRules';
import { SwitchRow } from './SwitchRow';

/**
 * "In a wide window" (proposal section 5): "Open pages beside this one" with its empty-side text, then "Opens: Automatic · Full width · Beside" with the footer of the choice. The
 * setting is on the destination page, so every link to it follows. "Start a new column set here" is gone: it is Full width plus Open pages beside this one.
 */
export function WideWindow({ ws, path, index }: { ws: Workspace2; path: EditorPath; index: number }) {
  const { document, onChange } = useRows();
  const page = valueAt(document, path) as typeof document.pages[number];
  const columns = page.navigation.type === 'navigation-columns';
  const options = fieldOptions('page', path);
  const value = wideOpenOf(page);
  const waiting = newerAppCaption(PAGE_WIDE_OPEN_CAPABILITY);
  return <section className="w2-group" aria-label="In a wide window"><h3 className="w2-group-title">In a wide window</h3>
    <SwitchRow label="Open pages beside this one" path={[...path, 'navigation', 'type'].join('/')} checked={columns} caption="Used when the window is wide enough for two."
      onChange={on => onChange(replaceAt(document, [...path, 'navigation'], (on ? { type: 'navigation-columns', placeholder: 'Select an item', standalone: false } : { type: 'stack' }) as Json))}/>
    {columns && <CompositionFields schema={{ type: 'string', maxLength: 240 }} value={(page.navigation as { placeholder: string }).placeholder} path={[...path, 'navigation', 'placeholder']}
      label="Empty side text" document={document} onChange={onChange} onError={ws.studio.setError} options={options}/>}
    {/* The label on its own line and the three choices across the panel, each on one line. */}
    <div className="w2-opens" data-field-path={`pages/${index}/wideOpen`}><span className="w2-row-label">Opens</span>
      <div className="w2-segment-field" role="group" aria-label="Opens">{wideChoices.map(choice => <button type="button" key={choice.value} aria-pressed={choice.value === value}
        onClick={() => choice.value !== value && onChange(setWideOpen(document, index, choice.value as WideOpen))}>{choice.label}</button>)}</div></div>
    <p className="w2-caption" data-wide-footer>{wideFooters[value]}</p>
    {waiting && <p className="w2-caption" data-needs-newer-app>{waiting}</p>}
  </section>;
}
