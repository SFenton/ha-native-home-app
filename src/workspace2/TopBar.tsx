import { Menu } from '@base-ui/react/menu';
import { AlertTriangle, CheckCircle2, ChevronDown, Redo2, Undo2 } from 'lucide-react';
import { Icon } from '../ui';
import { Overlay, PushStack, Tag } from './kit';
import PagesPanel from './PagesPanel';
import ChecksPanel from './ChecksPanel';
import ProjectMenu, { windowLabel } from './ProjectMenu';
import { previewWindows, type PreviewWindow } from './preview';
import type { DialogKey } from './projectDialogs';
import type { PanelKind, Workspace2 } from './useWorkspace2';

/** Edit and Use. */
export function ModeSegment({ mode, onChange }: { mode: 'edit' | 'use'; onChange: (mode: 'edit' | 'use') => void }) {
  return <div className="w2-segment-pill" role="group" aria-label="Mode">
    {(['edit', 'use'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => onChange(item)}>{item === 'edit' ? 'Edit' : 'Use'}</button>)}
  </div>;
}

/** The Checks pill (spec 5.8): "No Problems" or "<n> Problem(s)", opening Checks. */
export function ChecksPill({ ws, narrow, onOpenChange, open, showPill = true }: { ws: Workspace2; narrow: boolean; open: boolean; onOpenChange: (open: boolean) => void; showPill?: boolean }) {
  const count = ws.problemCount, failing = ws.failedSave;
  const bad = count > 0 || failing;
  const label = count > 0 ? `${count} Problem${count === 1 ? '' : 's'}` : failing ? 'Not Saved' : 'No Problems';
  const simulated = ws.activity[0]?.text.startsWith('Simulated') ? ws.activity[0].text : undefined;
  const pill = <button type="button" className={`w2-pill ${bad ? 'w2-pill-error' : ''}`} data-testid="checks-pill" hidden={!showPill} onClick={narrow ? () => onOpenChange(true) : undefined}>
    {bad ? <AlertTriangle size={14} aria-hidden/> : <CheckCircle2 size={14} aria-hidden/>}<span>{simulated ?? label}</span></button>;
  // Narrow: the pill is a plain button and the sheet opens on its own, so the Not Saved tag can open it while a properties sheet hides the pill.
  return <>{narrow && pill}<Overlay narrow={narrow} open={open} onOpenChange={onOpenChange} trigger={narrow ? undefined : pill} label="Checks" className="w2-checks-pop" popupWidth={360}>
    <PushStack rootTitle="Checks" root={<ChecksPanel checks={ws.checks} saveFailure={ws.failedSave ? ws.saveReason || 'Try again.' : undefined}
      onRetry={() => { ws.retrySave(); ws.saveNow(); }} onPick={row => { if (row.select) ws.selectAnywhere(row.select); onOpenChange(false); }}/>}/>
  </Overlay></>;
}

export interface TopBarProps {
  ws: Workspace2; narrow: boolean; window: PreviewWindow; onWindow: (window: PreviewWindow) => void;
  pagesOpen: boolean; onPagesOpen: (open: boolean) => void; projectOpen: boolean; onProjectOpen: (open: boolean) => void;
  dialog: DialogKey | undefined; onDialog: (dialog: DialogKey | undefined) => void; onPanel: (panel: PanelKind) => void; onOpen1: () => void; onError: (message: string) => void;
  onChecks: () => void;
}

/** The top bar: wide shows nine controls, narrow four (spec 3). Before the draft loads only the wordmark shows. */
export default function TopBar({ ws, narrow, window: current, onWindow, pagesOpen, onPagesOpen, projectOpen, onProjectOpen, dialog, onDialog, onPanel, onOpen1, onError, onChecks }: TopBarProps) {
  const document = ws.document, surface = ws.surface;
  const title = document && surface ? (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id) : undefined;
  const blocked = ws.problemCount > 0;
  const pageTrigger = <button type="button" className="w2-page-button" aria-label="Pages"><Icon name={title?.icon.name ?? 'grid'} size={18}/><span>{title?.title ?? ''}</span><ChevronDown size={14} aria-hidden/></button>;
  if (!document) return <header className="w2-topbar"><span className="w2-wordmark">S+H Studio</span></header>;
  const tag = (className?: string) => ws.status.tone === 'error'
    ? <button type="button" className={`w2-tag w2-tag-error w2-tag-button ${className ?? ''}`} data-testid="status-tag" onClick={onChecks}>{ws.status.text}</button>
    : <Tag tone={ws.status.tone} role="status" data-testid="status-tag" className={className}>{ws.status.text}</Tag>;
  return <header className="w2-topbar">
    {!narrow && <span className="w2-wordmark">S+H Studio</span>}
    <Overlay narrow={narrow} open={pagesOpen} onOpenChange={onPagesOpen} trigger={pageTrigger} label="Pages" popupWidth={320} fullHeight className="w2-pages-pop">
      <PushStack rootTitle="Pages" rootHeader={narrow ? <div className="w2-sheet-bar"><h2 className="w2-sheet-title">Pages</h2><button type="button" onClick={() => onPagesOpen(false)}>Done</button></div> : undefined}
        root={<PagesPanel document={document} current={surface} onPick={next => { ws.setSurface(next); ws.select(undefined); onPagesOpen(false); }}/>}/>
    </Overlay>
    {!narrow && <div className="w2-center">
      <ModeSegment mode={ws.mode} onChange={ws.setMode}/>
      <Menu.Root>
        <Menu.Trigger className="w2-window-button" aria-label="Window">{windowLabel(current)}<ChevronDown size={14} aria-hidden/></Menu.Trigger>
        <Menu.Portal><Menu.Positioner sideOffset={8} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
          <Menu.RadioGroup value={current.name} onValueChange={name => { const next = previewWindows.find(item => item.name === name); if (next) onWindow(next); }}>
            {previewWindows.map(item => <Menu.RadioItem key={item.name} value={item.name} className="w2-menu-item">{windowLabel(item)}</Menu.RadioItem>)}
          </Menu.RadioGroup>
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
    </div>}
    <div className="w2-trailing">
      <button type="button" className="w2-icon-button" aria-label="Undo" disabled={!ws.studio.canUndo} onClick={ws.studio.undo}><Undo2 size={18} aria-hidden/></button>
      {!narrow && <button type="button" className="w2-icon-button" aria-label="Redo" disabled={!ws.studio.canRedo} onClick={ws.studio.redo}><Redo2 size={18} aria-hidden/></button>}
      {!narrow && tag()}
      <button type="button" className="w2-primary" disabled={!narrow && blocked || ws.studio.conflict || ws.studio.busy && ws.phase === 'idle'}
        title={!narrow && blocked ? `Fix ${ws.problemCount} problem${ws.problemCount === 1 ? '' : 's'} to publish.` : undefined} onClick={ws.openPublish}>Publish</button>
      <ProjectMenu ws={ws} narrow={narrow} onPanel={onPanel} onOpen1={onOpen1} window={current} onWindow={onWindow} onError={onError}
        open={projectOpen} onOpenChange={onProjectOpen} dialog={dialog} onDialog={onDialog}/>
    </div>
    {narrow && tag('w2-status-narrow')}
  </header>;
}
