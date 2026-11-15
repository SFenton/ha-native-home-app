import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { compositionSourceText } from '../composition-editor';
import { Modal, Overlay, PushStack, usePush, type PushedPage } from './kit';
import { DialogBody, dialogTitles, type DialogKey } from './projectDialogs';
import { useProjectRows } from './dialogs/parts';
import { RowsProvider } from './rows';
import ChecksPanel from './ChecksPanel';
import { windowLabel } from '../preview2';
import { WindowChoices } from './navigation/WindowMenu';
import type { PreviewWindow } from './preview';
import type { PanelKind, Workspace2 } from './useWorkspace2';

type Entry =
  | { id: string; label: string; kind: 'dialog'; dialog: DialogKey }
  | { id: string; label: string; kind: 'panel'; panel: PanelKind }
  | { id: string; label: string; kind: 'action'; run: () => void };

function exportJson(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = 'studio-project.json'; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The menu's rows in the spec's order, in three sections (5.7). */
function sections(ws: Workspace2): Entry[][] {
  const dialog = (id: DialogKey, label = dialogTitles[id]): Entry => ({ id, label, kind: 'dialog', dialog: id });
  const panel = (id: PanelKind, label: string): Entry => ({ id, label, kind: 'panel', panel: id });
  return [
    [panel('tabs', 'Tabs'), panel('header', 'Header Buttons'), panel('wallpaper', 'Wallpaper')],
    [dialog('data'), dialog('local-state'), dialog('links'), dialog('launch'), dialog('live')],
    [dialog('history'), dialog('import', 'Import…'), { id: 'export', label: 'Export', kind: 'action', run: () => ws.document && exportJson(compositionSourceText(ws.document)) }, dialog('json', 'Edit as JSON…')],
    [dialog('activity'), dialog('about'), dialog('help')],
  ];
}

export { windowLabel };

/** The narrow Project sheet's rows. Selecting one pushes its page inside the sheet. */
function SheetList({ ws, narrowOnly, onPanel, onClose, window: current, onWindow, onError }: {
  ws: Workspace2; narrowOnly: boolean; onPanel: (panel: PanelKind) => void; onClose: () => void; window: PreviewWindow; onWindow: (window: PreviewWindow) => void; onError: (message: string) => void;
}) {
  const push = usePush();
  const page = (title: string, body: PushedPage['body']) => push?.push({ title, body });
  const row = (entry: Entry) => <li key={entry.id}><button type="button" className="w2-list-row" onClick={() => {
    if (entry.kind === 'panel') { onPanel(entry.panel); onClose(); }
    else if (entry.kind === 'action') entry.run();
    else page(dialogTitles[entry.dialog], <DialogBody dialog={entry.dialog} ws={ws} close={() => push?.pop()} onError={onError}/>);
  }}>{entry.label}</button></li>;
  return <div className="w2-project-sheet">
    <h2 className="w2-sheet-title">Project</h2>
    <ul className="w2-list">
      <li><button type="button" className="w2-list-row" onClick={() => page('Rename', <DialogBody dialog="rename" ws={ws} close={() => push?.pop()} onError={onError}/>)}>{ws.document?.name || 'Untitled project'}</button></li>
    </ul>
    {narrowOnly && <ul className="w2-list">
      <li><button type="button" className="w2-list-row" disabled={!ws.studio.canRedo} onClick={ws.studio.redo}>Redo</button></li>
      <li><button type="button" className="w2-list-row" onClick={() => page('Window', <WindowChoices window={current} onWindow={onWindow}/>)}>Window</button></li>
      <li><button type="button" className="w2-list-row" onClick={() => page('Checks', <ChecksPanel checks={ws.checks} saveFailure={ws.failedSave ? ws.saveReason : undefined} onRetry={() => { ws.retrySave(); ws.saveNow(); }} onPick={row2 => { if (row2.select) ws.selectAnywhere(row2.select); onClose(); }}/>)}>Checks</button></li>
    </ul>}
    {sections(ws).map((group, at) => <ul className="w2-list" key={at}>{group.map(row)}</ul>)}
    <p className="w2-caption w2-ha-line">{ws.houseStates.status === 'ready' ? 'Home Assistant: connected' : 'Home Assistant: not connected'}</p>
  </div>;
}

/**
 * The Project button and everything it opens: a menu with dialogs when wide, a sheet whose rows push pages when narrow.
 * `onPanel` opens Tabs, Header Buttons or Wallpaper in the properties surface.
 */
export default function ProjectMenu({ ws, narrow, onPanel, window: current, onWindow, onError, open, onOpenChange, dialog, onDialog }: {
  ws: Workspace2; narrow: boolean; onPanel: (panel: PanelKind) => void; window: PreviewWindow; onWindow: (window: PreviewWindow) => void; onError: (message: string) => void;
  open: boolean; onOpenChange: (open: boolean) => void; dialog: DialogKey | undefined; onDialog: (dialog: DialogKey | undefined) => void;
}) {
  const trigger = <button type="button" className="w2-icon-button" aria-label="Project"><MoreHorizontal size={18} aria-hidden/></button>;
  const context = useProjectRows(ws, onError);
  // The rows a dialog pushes are drawn by this stack, so the live document is provided above it.
  if (narrow) return <Overlay narrow open={open} onOpenChange={onOpenChange} trigger={trigger} label="Project" fullHeight>
    {context ? <RowsProvider value={context}><PushStack rootTitle="Project" root={<SheetList ws={ws} narrowOnly onPanel={onPanel} onClose={() => onOpenChange(false)} window={current} onWindow={onWindow} onError={onError}/>}/></RowsProvider> : null}
  </Overlay>;
  const groups = sections(ws);
  return <>
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger render={trigger}/>
      <Menu.Portal><Menu.Positioner sideOffset={8} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-project-menu">
        <Menu.Item className="w2-menu-item w2-menu-name" onClick={() => onDialog('rename')}>{ws.document?.name || 'Untitled project'}</Menu.Item>
        {groups.map((group, at) => <div key={at} role="group"><Menu.Separator className="w2-menu-sep"/>
          {group.map(entry => <Menu.Item key={entry.id} className="w2-menu-item" onClick={() => {
            if (entry.kind === 'panel') onPanel(entry.panel); else if (entry.kind === 'dialog') onDialog(entry.dialog); else entry.run();
          }}>{entry.label}</Menu.Item>)}</div>)}
        <Menu.Separator className="w2-menu-sep"/>
        <div className="w2-menu-note" role="note">{ws.houseStates.status === 'ready' ? 'Home Assistant: connected' : 'Home Assistant: not connected'}</div>
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
    {dialog && <Modal open onOpenChange={next => { if (!next) onDialog(undefined); }} title={dialogTitles[dialog]}>
      <DialogBody dialog={dialog} ws={ws} close={() => onDialog(undefined)} onError={onError}/>
    </Modal>}
  </>;
}
