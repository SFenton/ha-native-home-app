import { AlertTriangle, CheckCircle2, ChevronDown, Redo2, Undo2 } from 'lucide-react';
import { Icon } from '../ui';
import { Overlay, PushStack, Tag } from './kit';
import PagesPanel from './PagesPanel';
import ChecksPanel from './ChecksPanel';
import type { CheckRow } from './checks';
import ProjectMenu from './ProjectMenu';
import type { PreviewWindow } from './preview';
import { NavigationHost } from './navigation/NavigationDialogs';
import { WindowMenu } from './navigation/WindowMenu';
import type { DialogKey } from './projectDialogs';
import type { PanelKind, Workspace2 } from './useWorkspace2';

/** Edit and Use. */
export function ModeSegment({ mode, onChange }: { mode: 'edit' | 'use'; onChange: (mode: 'edit' | 'use') => void }) {
  return <div className="w2-segment-pill" role="group" aria-label="Mode">
    {(['edit', 'use'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => onChange(item)}>{item === 'edit' ? 'Edit' : 'Use'}</button>)}
  </div>;
}

/** The Checks pill (spec 5.8): "No Problems" or "<n> Problem(s)", opening Checks. */
export function ChecksPill({ ws, narrow, onOpenChange, open, onGo, showPill = true }: { ws: Workspace2; narrow: boolean; open: boolean; onOpenChange: (open: boolean) => void; onGo: (row: CheckRow) => void; showPill?: boolean }) {
  // Narrow, problems and a failed save live in the bar's status tag; the pill keeps only the note a simulated tap leaves.
  const count = ws.problemCount, failing = ws.failedSave;
  const bad = !narrow && (count > 0 || failing);
  const label = count > 0 ? `${count} Problem${count === 1 ? '' : 's'}` : failing ? 'Not Saved' : 'No Problems';
  const simulated = ws.flash || undefined;
  const pill = <button type="button" className={`w2-pill ${bad ? 'w2-pill-error' : simulated ? 'w2-pill-note' : ''}`} data-testid="checks-pill" hidden={!showPill} onClick={narrow ? () => onOpenChange(true) : undefined}>
    {bad ? <AlertTriangle size={14} aria-hidden/> : <CheckCircle2 size={14} aria-hidden/>}<span role={simulated && !bad ? 'status' : undefined}>{bad ? label : simulated ?? label}</span></button>;
  // Narrow: the pill is a plain button and the sheet opens on its own, so the Not Saved tag can open it while a properties sheet hides the pill.
  return <>{narrow && pill}<Overlay narrow={narrow} open={open} onOpenChange={onOpenChange} trigger={narrow ? undefined : pill} label="Checks" className="w2-checks-pop" popupWidth={360}>
    <PushStack rootTitle="Checks" root={<ChecksPanel checks={ws.checks} saveFailure={ws.failedSave ? ws.saveReason || 'Try again.' : undefined}
      onRetry={() => {
        // A conflict has no retry: it needs the choice again, so Try Again brings the dialog back.
        if (ws.studio.conflict) { ws.reopenConflict(); onOpenChange(false); return; }
        ws.retrySave(); ws.saveNow();
      }} onPick={row => { onGo(row); onOpenChange(false); }}/>}/>
  </Overlay></>;
}

const DRAFT = 'Draft · ';

export interface TopBarProps {
  ws: Workspace2; narrow: boolean; window: PreviewWindow; onWindow: (window: PreviewWindow) => void;
  pagesOpen: boolean; onPagesOpen: (open: boolean) => void; projectOpen: boolean; onProjectOpen: (open: boolean) => void;
  dialog: DialogKey | undefined; onDialog: (dialog: DialogKey | undefined) => void; onPanel: (panel: PanelKind) => void; onError: (message: string) => void;
  onChecks: () => void;
  /** Goes to what a Checks row names. */
  onGo: (row: CheckRow) => void;
}

/** The top bar: wide shows nine controls, narrow four (spec 3). Before the draft loads only the wordmark shows. */
export default function TopBar({ ws, narrow, window: current, onWindow, pagesOpen, onPagesOpen, projectOpen, onProjectOpen, dialog, onDialog, onPanel, onError, onChecks, onGo }: TopBarProps) {
  const document = ws.document, surface = ws.surface;
  const title = document && surface ? (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id) : undefined;
  const blocked = ws.problemCount > 0;
  const pageTrigger = <button type="button" className="w2-page-button" aria-label="Pages"><Icon name={title?.icon.name ?? 'grid'} size={18}/><span>{title?.title ?? ''}</span><ChevronDown size={14} aria-hidden/></button>;
  if (!document) return <header className="w2-topbar"><span className="w2-wordmark">S+H Studio</span></header>;
  // Narrow, "Draft · " gives way so the page name keeps its room: the tag reads "Saved".
  // With problems and nothing unsaved the tag is what says so, and it opens Checks like the wide pill does.
  const status = narrow && ws.problemCount > 0 && ws.status.tone !== 'error' ? { text: `${ws.problemCount} Problem${ws.problemCount === 1 ? '' : 's'}`, tone: 'error' as const } : ws.status;
  const words = narrow ? status.text.replace(DRAFT, '') : status.text;
  const tag = (className?: string) => status.tone === 'error'
    ? <button type="button" className={`w2-tag w2-tag-error w2-tag-button ${className ?? ''}`} data-testid="status-tag" onClick={ws.studio.conflict ? ws.reopenConflict : onChecks}>{words}</button>
    : <Tag tone={status.tone} role="status" data-testid="status-tag" className={className}>{words}</Tag>;
  return <header className="w2-topbar">
    {!narrow && <span className="w2-wordmark">S+H Studio</span>}
    <Overlay narrow={narrow} open={pagesOpen} onOpenChange={onPagesOpen} trigger={pageTrigger} label="Pages" popupWidth={320} fullHeight className="w2-pages-pop">
      <PushStack rootTitle="Pages" rootHeader={narrow ? <div className="w2-sheet-bar"><h2 className="w2-sheet-title">Pages</h2><button type="button" onClick={() => onPagesOpen(false)}>Done</button></div> : undefined}
        root={<PagesPanel ws={ws} document={document} current={surface} onPick={next => { ws.setSurface(next); ws.select(undefined); onPagesOpen(false); }}
          actions={{ onDismiss: () => onPagesOpen(false), onSettings: next => ws.selectAnywhere(`${next.kind}:${next.id}`), onTabs: () => onPanel('tabs'), onChange: ws.studio.apply, onShow: next => { ws.setSurface(next); ws.select(undefined); } }}/>}/>
    </Overlay>
    {!narrow && <div className="w2-center">
      <ModeSegment mode={ws.mode} onChange={ws.setMode}/>
      <WindowMenu window={current} onWindow={onWindow}/>
    </div>}
    <div className="w2-trailing">
      <button type="button" className="w2-icon-button" aria-label="Undo" data-keeps-sheet="" disabled={!ws.studio.canUndo} onClick={ws.studio.undo}><Undo2 size={18} aria-hidden/></button>
      {!narrow && <button type="button" className="w2-icon-button" aria-label="Redo" data-keeps-sheet="" disabled={!ws.studio.canRedo} onClick={ws.studio.redo}><Redo2 size={18} aria-hidden/></button>}
      {!narrow && tag()}
      <button type="button" className="w2-primary" disabled={!narrow && blocked || ws.studio.conflict || ws.studio.busy && ws.phase === 'idle'}
        title={!narrow && blocked ? `Fix ${ws.problemCount} problem${ws.problemCount === 1 ? '' : 's'} to publish.` : undefined} onClick={ws.openPublish}>Publish</button>
      <ProjectMenu ws={ws} narrow={narrow} onPanel={onPanel} onGo={onGo} window={current} onWindow={onWindow} onError={onError}
        open={projectOpen} onOpenChange={onProjectOpen} dialog={dialog} onDialog={onDialog}/>
    </div>
    {narrow && tag('w2-status-narrow')}
    <NavigationHost ws={ws}/>
  </header>;
}
