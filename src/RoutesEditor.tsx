import { useState } from 'react';
import type { CompositionDocument } from './shared/composition/schema';
import { importLegacyAliases, legacyAliases, updateRoute, words } from './routes-editor';
import { TextField } from './ui';

/**
 * Edits how the app opens each authored route: aliases (older links), keywords and the Siri suggestion for the
 * route, plus the link prefixes. Routes were once edited under Live Activities; page, tab and anchors stay in the generic field.
 */
export default function RoutesEditor({ document, onChange }: { document: CompositionDocument; onChange: (next: CompositionDocument) => void }) {
  const [note, setNote] = useState('');
  const extensions = document.extensions;
  if (!extensions) {
    return <button onClick={() => onChange({ ...document, extensions: { type: 'native-extensions@1', watch: 'stub@1', routes: [], cameras: [] } })}>Add extensions</button>;
  }
  const apply = (next: typeof extensions) => onChange({ ...document, extensions: next });
  return <>
    <p>A path that opens a page from a notification, Siri, Spotlight or a Live Activity link.</p>
    <button onClick={() => {
      const result = importLegacyAliases(extensions);
      apply(result.extensions);
      setNote(`Added ${result.added.length}${result.skipped.length ? `, skipped ${result.skipped.length} already used (${result.skipped.join(', ')})` : ''}. Seeded from ${Object.keys(legacyAliases).join(', ')}.`);
    }}>Import legacy aliases</button>
    {note && <p role="status">{note}</p>}
    <TextField label="Link prefixes (comma separated)" value={(extensions.linkPrefixes ?? []).join(', ')}
      onChange={text => apply({ ...extensions, linkPrefixes: words(text).length ? words(text) : undefined })}/>
    {extensions.routes.map((route, index) => <fieldset key={route.id}>
      <legend>{route.title} <code>/{route.path}</code></legend>
      <TextField label="Aliases" value={(route.aliases ?? []).join(', ')} onChange={text => apply(updateRoute(extensions, index, { aliases: words(text) }))}/>
      <TextField label="Keywords" value={(route.keywords ?? []).join(', ')} onChange={text => apply(updateRoute(extensions, index, { keywords: words(text) }))}/>
      <label><input type="checkbox" checked={route.siri ?? false} onChange={event => apply(updateRoute(extensions, index, { siri: event.target.checked }))}/> Suggest in Siri and Shortcuts</label>
    </fieldset>)}
  </>;
}
