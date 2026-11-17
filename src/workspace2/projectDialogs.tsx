import { useState, type ReactNode } from 'react';
import { compositionSourceText, importCompositionText } from '../composition-editor';
import { CompositionValidationError } from '../shared/composition/json';
import { formatCompositionIssue } from '../shared/composition/workspace';
import { TextField } from '../ui';
import About from './dialogs/About';
import Activity from './dialogs/Activity';
import Data from './dialogs/Data';
import Help from './dialogs/Help';
import History from './dialogs/History';
import Import from './dialogs/Import';
import Launch from './dialogs/Launch';
import Live from './dialogs/Live';
import ReplaceDraft from './dialogs/ReplaceDraft';
import LocalState from './dialogs/LocalState';
import { DialogFrame, useProjectRows } from './dialogs/parts';
import { LinksList } from './navigation/Links';
import { LinkPrefixes } from './navigation/LinkPrefixes';
import { useRows } from './rows';
import type { Workspace2 } from './useWorkspace2';

/** Every dialog the Project menu opens (spec 5.7). Tabs, Header Buttons and Wallpaper open the properties surface instead. */
export type DialogKey = 'rename' | 'data' | 'local-state' | 'links' | 'launch' | 'live' | 'history' | 'import' | 'json' | 'activity' | 'about' | 'help' | 'start-published' | 'restore-draft';
export const dialogTitles: Record<DialogKey, string> = {
  rename: 'Rename', data: 'Data', 'local-state': 'Local State', links: 'Links', launch: 'App Launch', live: 'Live Activities', history: 'Publish History',
  import: 'Import', json: 'Edit as JSON', activity: 'Activity', about: 'About', help: 'Help',
  'start-published': 'Start from Published?', 'restore-draft': 'Restore Previous Draft?',
};

function Rename() {
  const { document, onChange } = useRows();
  return <TextField label="Name" value={document.name} maxLength={160} onChange={name => onChange({ ...document, name })}/>;
}

function Links() {
  return <>
    <LinksList/>
    <LinkPrefixes/>
  </>;
}

/** The document as text: the one place the generated shape is shown. */
function JsonEditor({ close }: { close: () => void }) {
  const { document, onChange } = useRows();
  const [text, setText] = useState(() => compositionSourceText(document, true)), [error, setError] = useState('');
  return <>
    <textarea className="w2-code w2-code-tall" aria-label="Document" value={text} onChange={event => setText(event.target.value)}/>
    {error && <pre role="alert" className="w2-error-text w2-pre">{error}</pre>}
    <div className="w2-actions">
      <button type="button" onClick={close}>Cancel</button>
      <button type="button" className="w2-primary" onClick={() => {
        try { onChange(importCompositionText(text, document.id)); close(); }
        catch (reason) { setError(reason instanceof CompositionValidationError ? reason.issues.map(formatCompositionIssue).join('\n') : reason instanceof Error ? reason.message : String(reason)); }
      }}>Apply</button>
    </div>
  </>;
}

/** The body of one Project dialog. `close` closes the dialog (on narrow: pops the pushed page). */
export function DialogBody({ dialog, ws, close, onError }: { dialog: DialogKey; ws: Workspace2; close: () => void; onError: (message: string) => void }): ReactNode {
  const context = useProjectRows(ws, onError);
  if (!context) return null;
  const body = {
    rename: <Rename/>, data: <Data ws={ws}/>, 'local-state': <LocalState/>, links: <Links/>, launch: <Launch/>, live: <Live/>, history: <History ws={ws}/>,
    import: <Import ws={ws} close={close}/>, json: <JsonEditor close={close}/>, activity: <Activity ws={ws}/>, about: <About ws={ws}/>, help: <Help/>,
    'start-published': <ReplaceDraft kind="start-published" ws={ws} close={close}/>, 'restore-draft': <ReplaceDraft kind="restore-draft" ws={ws} close={close}/>,
  }[dialog];
  return <DialogFrame context={context} title={dialogTitles[dialog]}><div className="w2-form" data-dialog={dialog}>{body}</div></DialogFrame>;
}
