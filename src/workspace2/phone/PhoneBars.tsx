import { useUndo } from '../expr/useUndo';
import { ChevronDown, List, Plus, Redo2, Undo2 } from 'lucide-react';
import { GlyphByName } from '../../preview2/nodes/shared';
import { ModeSegment } from '../ModeSegment';
import { Overlay, PushStack, useMedia } from '../kit';
import PagesPanel from '../PagesPanel';
import ProjectMenu from '../ProjectMenu';
import { NavigationHost } from '../navigation/NavigationDialogs';
import { useAdd } from '../add/AddHost';
import type { TopBarProps } from '../TopBar';
import type { Workspace2 } from '../useWorkspace2';
import { surfaceWordOf } from '../levels';
import { listedSurface, surfaceAfterMove } from '../selection';

const DRAFT = 'Draft · ';
/** Below this width the top bar drops Redo (it stays in the Project sheet) so every slot keeps its size. */
export const NO_REDO_BELOW = 360;

/** What the status line says, how it is toned, and what the Project sheet's first row reports (the same words), if anything. */
export function phoneStatus(ws: Workspace2): { text: string; tone: 'neutral' | 'success' | 'warning' | 'error'; report?: string } {
  const problems = ws.problemCount > 0 ? `${ws.problemCount} Problem${ws.problemCount === 1 ? '' : 's'}` : undefined;
  // "Draft · " gives way so the page name keeps its room: the line reads "Saved". A failed save outranks the problem count.
  if (ws.status.tone === 'error') { const text = ws.status.text.replace(DRAFT, ''); return { text, tone: 'error', report: text }; }
  if (problems) return { text: problems, tone: 'error', report: problems };
  return { text: ws.status.text.replace(DRAFT, ''), tone: ws.status.tone };
}

/**
 * The phone top bar (studio-ux2 pick 3A, under 600 px wide): five slots that never move and never overlap. Slot 1 is the page
 * button, which opens Pages and carries the status line under the page's name; then Undo, Redo (gone under 360 px wide), Publish
 * and More. A control that cannot be used is dimmed where it stands. The status line is not a button: with problems or a failed save
 * More carries an error dot and the Project sheet's first row reads "Checks · n Problems".
 */
export function PhoneTopBar({ ws, window: current, onWindow, pagesOpen, onPagesOpen, projectOpen, onProjectOpen, dialog, onDialog, onPanel, onError, onGo }: TopBarProps) {
  const document = ws.document!, surface = ws.surface;
  const title = surface ? (surface.kind === 'page' ? document.pages : surface.kind === 'level' ? document.levels ?? [] : document.modals).find(item => item.id === surface.id) : undefined;
  const tight = useMedia(`(max-width: ${NO_REDO_BELOW - 1}px)`);
  const status = phoneStatus(ws);
  const undo = useUndo(ws);
  const pageTrigger = <button type="button" className="w2-page-button" aria-label="Pages"><GlyphByName name={title?.icon.name ?? 'grid'} size={20}/><span className="w2-page-name">{title?.title ?? ''}</span><ChevronDown size={14} aria-hidden/></button>;
  return <header className="w2-topbar">
    <div className="w2-page-slot">
      <Overlay narrow open={pagesOpen} onOpenChange={onPagesOpen} trigger={pageTrigger} label="Pages" popupWidth={320} fullHeight className="w2-pages-pop">
        <PushStack rootTitle="Pages" rootHeader={<div className="w2-sheet-bar"><h2 className="w2-sheet-title">Pages</h2><button type="button" onClick={() => onPagesOpen(false)}>Done</button></div>}
          root={<PagesPanel ws={ws} document={document} current={listedSurface(surface, document)} currentLevel={surface?.kind === 'level' ? surface.id : undefined} onPick={next => { ws.setSurface(next); ws.select(undefined); onPagesOpen(false); }}
            onPickLevel={(id, sheetId) => { ws.setSurface({ kind: 'level', id, ...(sheetId ? { sheetId } : {}) }); ws.select(undefined); onPagesOpen(false); }}
            actions={{ onDismiss: () => onPagesOpen(false), onSettings: next => ws.selectAnywhere(`${next.kind}:${next.id}`), onTabs: () => onPanel('tabs'), onChange: next => { const moved = surfaceAfterMove(next, surface); ws.studio.apply(next); if (moved) ws.setSurface(moved); }, onShow: next => { ws.setSurface(next); ws.select(undefined); } }}/>}/>
      </Overlay>
      <span className="w2-page-status" role="status" data-testid="status-tag" data-tone={status.tone}>{status.text}</span>
    </div>
    <button type="button" className="w2-icon-button w2-slot-undo" aria-label="Undo" title={undo.undoTitle} data-keeps-sheet="" disabled={!undo.canUndo} onClick={undo.undo}><Undo2 size={20} aria-hidden/></button>
    {!tight && <button type="button" className="w2-icon-button w2-slot-redo" aria-label="Redo" title={undo.redoTitle} data-keeps-sheet="" disabled={!undo.canRedo} onClick={undo.redo}><Redo2 size={20} aria-hidden/></button>}
    <button type="button" className="w2-primary w2-slot-publish" disabled={ws.studio.conflict || ws.studio.busy && ws.phase === 'idle'} onClick={ws.openPublish}>Publish</button>
    <ProjectMenu ws={ws} narrow onPanel={onPanel} onGo={onGo} window={current} onWindow={onWindow} onError={onError}
      open={projectOpen} onOpenChange={onProjectOpen} dialog={dialog} onDialog={onDialog} report={status.report}/>
    <NavigationHost ws={ws}/>
  </header>;
}

/** Add: after the selection, else at the end of the page being shown (spec 5.4). Dimmed in Use, where it stands. */
function BottomAdd({ disabled }: { disabled: boolean }) {
  const add = useAdd();
  return <button type="button" className="w2-bottom-add" disabled={disabled} onClick={event => add?.openDefault(event.currentTarget)}><Plus size={18} aria-hidden/><span>Add</span></button>;
}

/**
 * The phone bottom bar (studio-ux2 pick 3A): three slots, Edit and Use on the leading edge, This Page in the middle (a glyph alone
 * under 360 px wide) and Add on the trailing edge. In Use, This Page and Add stay in place, dimmed. Hidden by the caller while a
 * properties sheet covers it. Pages is not here: it opens from the page button.
 */
export function PhoneBottomBar({ ws, onThisPage }: { ws: Workspace2; onThisPage: () => void }) {
  const edit = ws.mode === 'edit';
  const sheet = ws.surface && ws.surface.kind !== 'page' ? `This ${ws.document && ws.index ? surfaceWordOf(ws.document, ws.index, `${ws.surface.kind}:${ws.surface.id}`) || 'Sheet' : 'Sheet'}` : 'This Page';
  return <nav className="w2-bottombar" aria-label="Mode">
    <ModeSegment mode={ws.mode} onChange={ws.setMode}/>
    <button type="button" className="w2-bottom-page" aria-label={sheet} disabled={!edit} onClick={onThisPage}><List size={18} aria-hidden/><span className="w2-bottom-label">{sheet}</span></button>
    <BottomAdd disabled={!edit}/>
  </nav>;
}
