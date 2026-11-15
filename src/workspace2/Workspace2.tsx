import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Drawer } from '@base-ui/react/drawer';
import { Layers } from 'lucide-react';
import Preview2, { previewWindows, type PreviewWindow } from './preview';
import { useStudioTheme } from './useStudioTheme';
import { useWorkspace2, type PanelKind } from './useWorkspace2';
import { ModeSegment, ChecksPill } from './TopBar';
import AddHost, { useAdd } from './add/AddHost';
import DragLayer from './dnd/DragLayer';
import { SHEET_SNAP_EVENT } from './editors/EditorRow';
import { newPageFlow, newSheetFlow } from './navigation';
import { WorkspaceDataProvider, type CreateFlow } from './pickers/WorkspaceData';
import TopBar from './TopBar';
import PropertiesPanel from './PropertiesPanel';
import HandleSlot from './HandleSlot';
import { PublishDialog, ConflictDialog } from './PublishDialogs';
import { useNarrow } from './kit';
import { ToastHost } from './toasts';
import type { DialogKey } from './projectDialogs';
import './workspace2.css';

const SNAP_PEEK = '88px', SNAP_HALF = 0.5, SNAP_FULL = 1;
const snapPoints = [SNAP_PEEK, SNAP_HALF, SNAP_FULL];
type Snap = typeof snapPoints[number];

/** The pixels of the screen a narrow sheet at `snap` covers. */
/** Whether a dialog is up over the workspace (New Page… from an editor in the sheet); the sheet keeps its height behind it. */
const dialogOpen = () => Boolean(document.querySelector('[role=dialog][data-open]:not(.w2-props-sheet), [role=alertdialog][data-open]'));
const coverage = (snap: Snap | null) => snap === SNAP_PEEK ? 88 : snap === SNAP_FULL ? window.innerHeight : window.innerHeight * SNAP_HALF;

/** Why the draft is not there: loading, not signed in, or could not load (spec 9). */
export function CanvasState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <div className="w2-state" role="status"><div className="w2-device-outline" aria-hidden/><p>Loading…</p></div>;
  const unauthorized = /authentication required|\(401\)|not signed in|unauthori[sz]ed/i.test(error);
  if (unauthorized) {
    const inHomeAssistant = window.parent !== window;
    return <div className="w2-state" role="alert"><h2>Not signed in.</h2>
      <p>{inHomeAssistant ? 'Open S+H Studio from Home Assistant.' : 'Start the Studio with a token. See the README.'}</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button></div>;
  }
  return <div className="w2-state" role="alert"><h2>Couldn’t load the draft.</h2><p className="w2-state-reason">{error}</p><button type="button" onClick={onRetry}>Try Again</button></div>;
}

/** The narrow bottom bar's Add: after the selection, else at the end of the page being shown (spec 5.4). */
function BottomAdd() {
  const add = useAdd();
  return <button type="button" className="w2-bottom-add" onClick={event => add?.openDefault(event.currentTarget)}>Add</button>;
}

/**
 * The 2.0 workspace, direction A "Preview first" (spec `studio-ux`): the preview is the workspace, and everything else is
 * asked for.
 */
export default function Workspace2({ active, onCreatePage, onCreateSheet }: { active: boolean; /** Start the page or sheet creation flow from a picker's "New Page…" or "New Sheet…" row; the row is hidden when absent. */ onCreatePage?: CreateFlow; onCreateSheet?: CreateFlow }) {
  const theme = useStudioTheme(active);
  const ws = useWorkspace2(active);
  const narrow = useNarrow();
  const [window_, setWindow] = useState<PreviewWindow>(previewWindows[0]);
  const [pagesOpen, setPagesOpen] = useState(false), [projectOpen, setProjectOpen] = useState(false), [checksOpen, setChecksOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKey>();
  const [snap, setSnap] = useState<Snap | null>(SNAP_HALF);
  const [notice, setNotice] = useState('');
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const { target, document, studio } = ws;
  const showError = useCallback((message: string) => setNotice(message), []);
  useEffect(() => setNotice(''), [target?.kind, ws.selection]);
  useEffect(() => { if (target) setSnap(SNAP_HALF); }, [target?.kind, ws.selection, ws.panel]);
  // An editor pushed inside the properties sheet takes it to full height, and gives it back to half (spec 5.5).
  useEffect(() => {
    const listener = (event: Event) => { const to = (event as CustomEvent<'full' | 'half' | 'peek'>).detail; setSnap(to === 'full' ? SNAP_FULL : to === 'peek' ? SNAP_PEEK : SNAP_HALF); };
    window.addEventListener(SHEET_SNAP_EVENT, listener);
    return () => window.removeEventListener(SHEET_SNAP_EVENT, listener);
  }, []);
  // One open sheet at a time on narrow widths: a menu, Pages or Checks replaces the properties sheet.
  const overlayOpen = pagesOpen || projectOpen || checksOpen || ws.phase !== 'idle';
  useEffect(() => { if (narrow && overlayOpen && target) { ws.select(undefined); } }, [narrow, overlayOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPanel = useCallback((panel: PanelKind) => { setProjectOpen(false); ws.select(undefined); ws.setPanel(panel); }, [ws]);
  const close = useCallback(() => { ws.select(undefined); ws.setPanel(undefined); }, [ws]);
  const openProjectDialog = useCallback((key: string) => { if (narrow) setProjectOpen(true); else setDialog(key as DialogKey); }, [narrow]);
  const bottomInset = narrow && target ? coverage(snap) : 0;
  const className = `w2 w2-scope ${narrow ? 'w2-narrow' : 'w2-wide'} ${theme.dark ? 'w2-dark' : 'w2-light'}`;
  const stage = useMemo(() => document && ws.surface && ws.previewDocument ? <Preview2
    document={ws.previewDocument} mode={ws.mode} surface={ws.surface} onSurfaceChange={ws.setSurface} selection={ws.mode === 'edit' ? ws.selection : undefined} onSelect={ws.select}
    window={window_} bezel={!narrow} house={ws.houseStates.status === 'loading' ? undefined : ws.houseStates.house} overlay={ws.houseStates.overlay}
    onOverlayChange={ws.houseStates.setOverlay} onSimulatedCall={ws.simulated} revealKey={ws.revealKey} bottomInset={bottomInset}/> : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [ws.previewDocument, ws.mode, ws.surface, ws.selection, ws.houseStates.house, ws.houseStates.overlay, ws.houseStates.status, window_, narrow, ws.revealKey, bottomInset, ws.setSurface, ws.select, ws.houseStates.setOverlay, ws.simulated]);
  const properties = target && document ? <PropertiesPanel ws={ws} onClose={close} onOpenProject={openProjectDialog} notice={notice} onError={showError}/> : null;
  const loadingState = !document ? <CanvasState loading={!studio.error} error={studio.error} onRetry={() => void studio.reload()}/> : undefined;
  return <div className={className} data-testid="workspace2" hidden={!active}>
    <ToastHost>
      <WorkspaceDataProvider document={document} house={ws.houseStates.house} environment={ws.houseStates.environment} onCreatePage={onCreatePage ?? newPageFlow} onCreateSheet={onCreateSheet ?? newSheetFlow}>
      <AddHost ws={ws} narrow={narrow} stage={stageElement} onError={showError}>
      <DragLayer ws={ws} narrow={narrow} stage={stageElement} onError={showError}>
      <TopBar ws={ws} narrow={narrow} window={window_} onWindow={setWindow} pagesOpen={pagesOpen} onPagesOpen={setPagesOpen} projectOpen={projectOpen} onProjectOpen={setProjectOpen}
        dialog={dialog} onDialog={setDialog} onPanel={openPanel} onError={showError} onChecks={() => setChecksOpen(true)}/>
      <main className="w2-canvas" data-card={!narrow && target ? 'open' : undefined}>
        {loadingState ?? <div className="w2-stage" data-mode={ws.mode} ref={setStageElement}>{stage}</div>}
        {!narrow && <HandleSlot ws={ws} stage={stageElement} onError={showError}/>}
        {document && <div className="w2-checks-slot" hidden={narrow && Boolean(target)}><ChecksPill ws={ws} narrow={narrow} open={checksOpen} onOpenChange={setChecksOpen} showPill={!narrow || ws.problemCount > 0 || ws.failedSave}/></div>}
        {!narrow && properties && <aside className="w2-card" aria-label="Properties">{properties}</aside>}
      </main>
      {narrow && document && !target && <nav className="w2-bottombar" aria-label="Mode"><ModeSegment mode={ws.mode} onChange={ws.setMode}/>{ws.mode === 'edit' && <BottomAdd/>}
        <button type="button" className="w2-bottom-pages" aria-label="Pages" onClick={() => setPagesOpen(true)}><Layers size={16} aria-hidden/>Pages</button></nav>}
      {narrow && properties && <Drawer.Root open modal={false} disablePointerDismissal={false} snapPoints={snapPoints} snapPoint={snap} onSnapPointChange={next => { if (!dialogOpen()) setSnap(next); }}
        onOpenChange={(open, details) => {
          // A dialog opened from inside the sheet (New Page…, New Sheet…) sits outside it; pressing in the dialog is not a press outside the sheet.
          if (!open && details.reason === 'outside-press' && (details.event.target as Element | null)?.closest?.('[role=dialog], [role=alertdialog]')) return;
          if (!open) close();
        }}>
        <Drawer.Portal><Drawer.Viewport className="w2-props-viewport"><Drawer.Popup className="w2-scope w2-sheet w2-props-sheet" aria-label="Properties" style={{ '--w2-sheet-hidden': `${Math.max(0, window.innerHeight - coverage(snap))}px` } as CSSProperties}>
          <div className="w2-grabber" aria-hidden/>
          <Drawer.Content className="w2-sheet-content w2-props-content">{properties}</Drawer.Content>
        </Drawer.Popup></Drawer.Viewport></Drawer.Portal>
      </Drawer.Root>}
      {document && <PublishDialog ws={ws}/>}
      {document && <ConflictDialog ws={ws}/>}
      </DragLayer>
      </AddHost>
      </WorkspaceDataProvider>
    </ToastHost>
  </div>;
}
