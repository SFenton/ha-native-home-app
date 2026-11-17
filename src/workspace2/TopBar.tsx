import { useUndo } from './expr/useUndo';
import { words } from './expr/words';
import { AlertTriangle, CheckCircle2, Redo2, Undo2 } from 'lucide-react';
import { Overlay, PushStack, Tag, useMedia } from './kit';
import { ModeSegment } from './ModeSegment';
import { PhoneTopBar } from './phone/PhoneBars';
import ChecksPanel from './ChecksPanel';
import type { CheckRow } from './checks';
import ProjectMenu from './ProjectMenu';
import type { PreviewWindow } from './preview';
import { NavigationHost } from './navigation/NavigationDialogs';
import { WindowMenu } from './navigation/WindowMenu';
import type { DialogKey } from './projectDialogs';
import type { PanelKind, Workspace2 } from './useWorkspace2';

export { ModeSegment } from './ModeSegment';

/** The Checks pill (spec 5.8): "No Problems" or "<n> Problem(s)", opening Checks. */
export function ChecksPill({ ws, narrow, onOpenChange, open, onGo, showPill = true, away = false }: { ws: Workspace2; narrow: boolean; open: boolean; onOpenChange: (open: boolean) => void; onGo: (row: CheckRow) => void; showPill?: boolean; /** The canvas is too narrow for the pill: it stays laid out (the Checks popover anchors to it) but cannot be seen or reached; the top bar's status tag opens Checks. */ away?: boolean }) {
  // Narrow, problems and a failed save live in the bar's status tag; the pill keeps only the note a simulated tap leaves.
  const count = ws.problemCount, failing = ws.failedSave;
  const bad = !narrow && (count > 0 || failing);
  const label = count > 0 ? `${count} Problem${count === 1 ? '' : 's'}` : failing ? 'Not Saved' : 'No Problems';
  const simulated = ws.flash || undefined;
  const pill = <button type="button" className={`w2-pill ${bad ? 'w2-pill-error' : simulated ? 'w2-pill-note' : ''} ${away ? 'w2-pill-away' : ''}`} data-testid="checks-pill" hidden={!showPill} tabIndex={away ? -1 : undefined} aria-hidden={away || undefined} onClick={narrow ? () => onOpenChange(true) : undefined}>
    {bad ? <AlertTriangle size={14} aria-hidden/> : <CheckCircle2 size={14} aria-hidden/>}<span role={simulated && !bad ? 'status' : undefined}>{bad ? label : simulated ?? label}</span></button>;
  // Narrow: the pill is a plain button and the sheet opens on its own, so the Not Saved tag can open it while a properties sheet hides the pill.
  const test = !narrow && !away && ws.tried.count > 0 ? <span className="w2-pill w2-pill-test" data-testid="test-values-pill" role="status">{words.testValues}</span> : null;
  return <>{narrow && pill}{test}<Overlay narrow={narrow} open={open} onOpenChange={onOpenChange} trigger={narrow ? undefined : pill} label="Checks" className="w2-checks-pop" popupWidth={360}>
    <PushStack rootTitle="Checks" root={<ChecksPanel checks={ws.checks} saveFailure={ws.failedSave ? ws.saveReason || 'Try again.' : undefined}
      onRetry={() => {
        // A conflict has no retry: it needs the choice again, so Try Again brings the dialog back.
        if (ws.studio.conflict) { ws.reopenConflict(); onOpenChange(false); return; }
        ws.retrySave(); ws.saveNow();
      }} onPick={row => { onGo(row); onOpenChange(false); }}/>}/>
  </Overlay></>;
}

const DRAFT = 'Draft · ';
/** Below this width "Draft · Saved" reads "Saved" and, below {@link SHORT_WORDMARK}, the wordmark reads "S+H" (Studio spec, Rule 2). */
export const SHORT_STATUS = 1000, SHORT_WORDMARK = 940;

export interface TopBarProps {
  ws: Workspace2; narrow: boolean; window: PreviewWindow; onWindow: (window: PreviewWindow) => void;
  pagesOpen: boolean; onPagesOpen: (open: boolean) => void; projectOpen: boolean; onProjectOpen: (open: boolean) => void;
  dialog: DialogKey | undefined; onDialog: (dialog: DialogKey | undefined) => void; onPanel: (panel: PanelKind) => void; onError: (message: string) => void;
  onChecks: () => void;
  /** Goes to what a Checks row names. */
  onGo: (row: CheckRow) => void;
}

/** Below this width the wordmark gives way and the device menu shows its glyph and chevron only. */
export const COMPACT_BAR = 720;

/**
 * The top bar. A phone gets {@link PhoneTopBar}. Wider windows get three groups: the wordmark (Pages lives on the library rail), Edit and Use
 * with the device menu, and the trailing controls. Before the draft loads only the wordmark shows.
 */
export default function TopBar(props: TopBarProps) {
  const { ws, narrow, window: current, onWindow, projectOpen, onProjectOpen, dialog, onDialog, onPanel, onError, onChecks, onGo } = props;
  const document = ws.document;
  const shortStatus = useMedia(`(max-width: ${SHORT_STATUS - 1}px)`), shortWordmark = useMedia(`(max-width: ${SHORT_WORDMARK - 1}px)`), compact = useMedia(`(max-width: ${COMPACT_BAR - 1}px)`);
  const blocked = ws.problemCount > 0;
  const undo = useUndo(ws);
  if (!document) return <header className="w2-topbar"><span className="w2-wordmark">S+H Studio</span></header>;
  if (narrow) return <PhoneTopBar {...props}/>;
  const status = ws.status;
  const words = shortStatus ? status.text.replace(DRAFT, '') : status.text;
  const tag = status.tone === 'error'
    ? <button type="button" className="w2-tag w2-tag-error w2-tag-button" data-testid="status-tag" onClick={ws.studio.conflict ? ws.reopenConflict : onChecks}>{words}</button>
    : <Tag tone={status.tone} role="status" data-testid="status-tag">{words}</Tag>;
  return <header className="w2-topbar">
    <div className="w2-leading">{!compact && <span className="w2-wordmark">{shortWordmark ? 'S+H' : 'S+H Studio'}</span>}</div>
    <div className="w2-center">
      <ModeSegment mode={ws.mode} onChange={ws.setMode}/>
      <WindowMenu window={current} onWindow={onWindow} compact={compact}/>
    </div>
    <div className="w2-trailing">
      <button type="button" className="w2-icon-button" aria-label="Undo" title={undo.undoTitle} data-keeps-sheet="" disabled={!undo.canUndo} onClick={undo.undo}><Undo2 size={18} aria-hidden/></button>
      <button type="button" className="w2-icon-button" aria-label="Redo" title={undo.redoTitle} data-keeps-sheet="" disabled={!undo.canRedo} onClick={undo.redo}><Redo2 size={18} aria-hidden/></button>
      {tag}
      <button type="button" className="w2-primary" disabled={blocked || ws.studio.conflict || ws.studio.busy && ws.phase === 'idle'}
        title={blocked ? `Fix ${ws.problemCount} problem${ws.problemCount === 1 ? '' : 's'} to publish.` : undefined} onClick={ws.openPublish}>Publish</button>
      <ProjectMenu ws={ws} narrow={false} onPanel={onPanel} onGo={onGo} window={current} onWindow={onWindow} onError={onError}
        open={projectOpen} onOpenChange={onProjectOpen} dialog={dialog} onDialog={onDialog}/>
    </div>
    <NavigationHost ws={ws}/>
  </header>;
}
