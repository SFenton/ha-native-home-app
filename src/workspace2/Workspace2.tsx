import { fetchPicture } from '../preview2/map-picture';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Drawer } from '@base-ui/react/drawer';
import { useRecords } from './data/useRecords';
import Preview2, { previewWindows, type PreviewWindow } from './preview';
import { useStudioTheme } from './useStudioTheme';
import { useAppearance } from './appearance';
import { useWorkspace2, type PanelKind } from './useWorkspace2';
import { ChecksPill } from './TopBar';
import { PhoneBottomBar } from './phone/PhoneBars';
import LevelSheet from './phone/LevelSheet';
import RepeatsSheet from './repeats/RepeatsSheet';
import LibraryRail from './LibraryRail';
import LibraryPanel from './LibraryPanel';
import { useLibrary } from './useLibrary';
import type { SelectionKey } from '../preview2/model';
import { useLibraryTrail } from './useLibraryTrail';
import { usePresence } from './usePresence';
import InspectorSlot from './InspectorSlot';
import { reducedMotion, useDeviceGlide } from './useDeviceGlide';
import { checksPillShown, exclusive, layoutTier, inspectorWidth as inspectorWidthFor, railUnder, resolveLayout, RAIL_UNDER_ROOM, type Category } from './layout';
import { defaultTextStep, railUnderPreview, textScales } from './simulator';
import SimulatorRail from './SimulatorRail';
import RailSlot from './RailSlot';
import { followCheck, type CheckRow } from './checks';
import { focusField } from './focusField';
import AddHost from './add/AddHost';
import DragLayer from './dnd/DragLayer';
import { SHEET_SNAP_EVENT } from './editors/EditorRow';
import { newPageFlow, newSheetFlow } from './navigation';
import { WorkspaceDataProvider, type CreateFlow } from './pickers/WorkspaceData';
import TopBar from './TopBar';
import PropertiesPanel from './PropertiesPanel';
import { SimulatorWindowContext } from './simulatorWindow';
import PreviewGuard from './PreviewGuard';
import HandleSlot from './HandleSlot';
import ElementContextMenu from './ElementContextMenu';
import { PublishDialog, ConflictDialog } from './PublishDialogs';
import OpenFromPublished from './OpenFromPublished';
import LinkedHost from './LinkedHost';
import { useViewport } from './kit';
import { SelectMenusContext } from './SelectMenu';
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

/**
 * The 2.0 workspace, direction A "Preview first" (spec `studio-ux`): the preview is the workspace, and everything else is
 * asked for.
 */
export default function Workspace2({ active, onCreatePage, onCreateSheet }: { active: boolean; /** Start the page or sheet creation flow from a picker's "New Page…" or "New Sheet…" row; the row is hidden when absent. */ onCreatePage?: CreateFlow; onCreateSheet?: CreateFlow }) {
  const theme = useStudioTheme(active);
  const appearance = useAppearance();
  const ws = useWorkspace2(active);
  const { width, height } = useViewport();
  const library = useLibrary(layoutTier(width, height), width);
  const [yielded, setYielded] = useState(false);
  const trailApi = useLibraryTrail();
  /** A selection the library made itself (going into a container) that must not close the panel where it and the inspector cannot both show. */
  const keptSelection = useRef<SelectionKey | undefined>(undefined);
  const [window_, setWindow] = useState<PreviewWindow>(previewWindows[0]);
  /** The rail's moves render as a transition: the new display mounts in slices between frames, so a fold or a turn does not hold a frame (`studio-duo-sim`, frame pacing). */
  const moveWindow = useCallback((next: PreviewWindow) => startTransition(() => setWindow(next)), []);
  const simulator = useMemo(() => ({ window: window_, move: moveWindow }), [window_, moveWindow]);
  const [pagesOpen, setPagesOpen] = useState(false), [projectOpen, setProjectOpen] = useState(false), [checksOpen, setChecksOpen] = useState(false), [levelOpen, setLevelOpen] = useState(false);
  const [textStep, setTextStep] = useState(defaultTextStep);
  const [dialog, setDialog] = useState<DialogKey>();
  const [snap, setSnap] = useState<Snap | null>(SNAP_HALF);
  const [notice, setNotice] = useState('');
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const { target, document, studio } = ws;
  const wanted = Boolean(document) && library.open && !yielded;
  const layout = resolveLayout(width, height, wanted, Boolean(target));
  const narrow = layout.tier === 'phone';
  const tier = layout.tier;
  // In a tier where the panel and the inspector cannot both show, a new selection closes the panel (it is not remembered as a choice).
  useEffect(() => { if (target && exclusive(tier, width) && library.open && !(ws.selection && keptSelection.current === ws.selection)) setYielded(true); }, [target?.kind, ws.selection, ws.panel]); // eslint-disable-line react-hooks/exhaustive-deps
  const pressCategory = useCallback((next: Category) => {
    if (yielded) { setYielded(false); if (next !== library.category) library.press(next); else if (!library.open) library.press(next); return; }
    library.press(next);
  }, [yielded, library]);
  const closeLibrary = useCallback(() => { setYielded(false); library.setOpen(false); }, [library]);
  const switchCategory = useCallback((next: Category) => { setYielded(false); if (next !== library.category || !library.open) library.press(next); }, [library]);
  // Project > Data opens the Data panel when there is a rail (the dialog stays a pushed page on a phone): one place to build Data Flows.
  const showDialog = useCallback((key: DialogKey | undefined) => { if (key === 'data' && !narrow) { setProjectOpen(false); switchCategory('data'); } else setDialog(key); }, [narrow, switchCategory]);
  // The editor's "Used in N places" row opens the Uses level, which lives in the Components panel: open that, whatever it showed.
  useEffect(() => { if (ws.usesId && !narrow) { setYielded(false); library.show('components'); library.setOpen(true); } }, [ws.usesId, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepPanel = useCallback((key: SelectionKey) => { keptSelection.current = key; }, []);
  const reduced = reducedMotion();
  const panelMotion = tier === 'flyout' ? 250 : 200, inspectorMotion = 200;
  const panelPresence = usePresence(layout.panel, reduced ? 120 : panelMotion);
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
  // The This Page sheet is one of them, and it is not a properties sheet's: a selection made inside it (a drop, a tap on the canvas) leaves the properties for when it is gone.
  useEffect(() => { if (overlayOpen || !narrow) setLevelOpen(false); }, [overlayOpen, narrow]);
  const propertiesUp = narrow && !levelOpen;
  const openPanel = useCallback((panel: PanelKind) => { setProjectOpen(false); ws.select(undefined); ws.setPanel(panel); }, [ws]);
  const close = useCallback(() => { ws.select(undefined); ws.setPanel(undefined); ws.repeats.pick(undefined); }, [ws]);
  // Choosing a Checks row goes to what it names: the item in the preview, or the Project panel or dialog that holds it.
  const goTo = useCallback((row: CheckRow) => followCheck(row, {
    select: key => ws.selectAnywhere(key), panel: openPanel, dialog: key => { setProjectOpen(false); showDialog(key); }, logic: id => { setProjectOpen(false); ws.openLogic(id); }, focus: focusField,
  }), [ws, openPanel, showDialog]);
  const openProjectDialog = useCallback((key: string) => { if (narrow) setProjectOpen(true); else showDialog(key as DialogKey); }, [narrow, showDialog]);
  const repeatsUp = narrow && ws.repeats.open;
  // On a phone, the Repeated Pieces sheet and a selection on the canvas do not share the screen: the selection wins.
  useEffect(() => { if (narrow && target) ws.repeats.setOpen(false); }, [narrow, target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (narrow && overlayOpen) ws.repeats.setOpen(false); }, [narrow, overlayOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const bottomInset = narrow && (levelOpen || repeatsUp) ? coverage(SNAP_HALF) : narrow && target ? coverage(snap) : 0;
  const className = `w2 w2-scope ${narrow ? 'w2-narrow' : 'w2-wide'} ${theme.dark ? 'w2-dark' : 'w2-light'}`;
  const stage = useMemo(() => document && ws.surface && ws.previewDocument ? <PreviewGuard document={ws.previewDocument} lastGood={ws.lastGoodDocument}>{shown => <Preview2
    document={shown} mode={ws.mode} surface={ws.surface!} onSurfaceChange={ws.setSurface} selection={ws.selection} onSelect={ws.select} onOpenTemplate={ws.openTemplate}
    window={window_} textScale={textScales[textStep]} appearance={appearance === 'follow' ? undefined : appearance} bezel={!narrow} live={ws.houseStates.live} overlay={ws.houseStates.overlay}
    onOverlayChange={ws.houseStates.setOverlay} onSimulatedCall={ws.simulated} revealKey={ws.revealKey} repeatMark={ws.repeats.mark} bottomInset={bottomInset} alert={ws.alertPreview}
    statePreview={ws.statePreview && ws.selection === `node:${ws.statePreview.nodeId}` ? ws.statePreview : undefined}
    mapPicture={ws.houseStates.streaming ? fetchPicture : undefined} records={useRecords}/>}</PreviewGuard> : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [ws.previewDocument, ws.lastGoodDocument, ws.mode, ws.surface, ws.selection, ws.houseStates.live, ws.houseStates.streaming, ws.houseStates.overlay, window_, narrow, ws.revealKey, ws.repeats.mark, bottomInset, ws.alertPreview, ws.statePreview, textStep, appearance, ws.setSurface, ws.select, ws.openTemplate, ws.houseStates.setOverlay, ws.simulated]);
  const underPreview = railUnderPreview(narrow, window_);
  const under = !narrow && railUnder(layout.canvas);
  useDeviceGlide(stageElement, `${layout.left}/${layout.inspectorWidth}/${tier}`, panelMotion);
  const properties = target && document ? <PropertiesPanel ws={ws} onClose={close} onOpenProject={openProjectDialog} notice={notice} onError={showError}/> : null;
  const loadingState = !document ? <CanvasState loading={!studio.error} error={studio.error} onRetry={() => void studio.reload()}/> : undefined;
  return <div className={className} data-testid="workspace2" hidden={!active}>
    <SelectMenusContext.Provider value>
    <SimulatorWindowContext.Provider value={simulator}>
    <ToastHost>
      <WorkspaceDataProvider document={document} house={ws.houseStates.house} live={ws.houseStates.live} environment={ws.houseStates.environment} overlay={ws.houseStates.overlay} tried={ws.tried} onCreatePage={onCreatePage ?? newPageFlow} onCreateSheet={onCreateSheet ?? newSheetFlow}>
      <AddHost ws={ws} narrow={narrow} stage={stageElement} onError={showError}>
      <DragLayer ws={ws} narrow={narrow} stage={stageElement} onError={showError}>
      <TopBar ws={ws} narrow={narrow} window={window_} onWindow={setWindow} pagesOpen={pagesOpen} onPagesOpen={setPagesOpen} projectOpen={projectOpen} onProjectOpen={setProjectOpen}
        dialog={dialog} onDialog={showDialog} onPanel={openPanel} onError={showError} onChecks={() => setChecksOpen(true)} onGo={goTo}/>
      <div className="w2-body" data-tier={tier} style={{ '--w2-left': `${layout.left}px`, '--w2-right': `${layout.inspectorWidth}px` } as CSSProperties}>
      {!narrow && document && <div className="w2-lib" data-tier={tier} data-open={layout.panel ? '' : undefined}>
        <LibraryRail category={library.category} open={layout.panel} onPress={pressCategory} inert={tier === 'flyout' && panelPresence.mounted}/>
        {panelPresence.mounted && <LibraryPanel ws={ws} document={document} tier={tier as 'flyout' | 'docked'} category={library.category} open={layout.panel} shown={panelPresence.shown} library={library} trailApi={trailApi} onCategory={switchCategory} onKeepPanel={keepPanel} onError={showError} onClose={closeLibrary}/>}
      </div>}
      <main className="w2-canvas" data-rail={under ? 'under' : undefined}>
        {loadingState ?? <div className="w2-stage" data-mode={ws.mode} ref={setStageElement}>{stage}</div>}
        {!narrow && <HandleSlot ws={ws} stage={stageElement} onError={showError}/>}
        <ElementContextMenu ws={ws} stage={stageElement} onError={showError}/>
        <RailSlot enabled={!narrow && Boolean(document)} under={under} window={window_} onWindow={moveWindow} textStep={textStep} onTextStep={setTextStep}/>
        {document && <div className="w2-checks-slot" hidden={narrow && Boolean(target)}><ChecksPill ws={ws} narrow={narrow} open={checksOpen} onOpenChange={setChecksOpen} onGo={goTo} showPill={!narrow || Boolean(ws.flash)} away={!narrow && !checksPillShown(layout.canvas)}/></div>}
      </main>
      {!narrow && document && <InspectorSlot open={layout.inspector} ms={reduced ? 120 : inspectorMotion} tier={tier} width={layout.inspectorWidth} fallbackWidth={inspectorWidthFor(tier, width)} properties={properties}/>}
      </div>
      {underPreview && document && !target && <div className="w2-rail-under"><SimulatorRail window={window_} onWindow={moveWindow} textStep={textStep} onTextStep={setTextStep} orientation="horizontal"/></div>}
      {narrow && document && (!target || levelOpen || repeatsUp) && <PhoneBottomBar ws={ws} onThisPage={() => setLevelOpen(true)}/>}
      {narrow && document && <LevelSheet ws={ws} open={levelOpen} onOpenChange={setLevelOpen} onError={showError}/>}
      {narrow && document && <RepeatsSheet ws={ws} onError={showError}/>}
      {propertiesUp && properties && <Drawer.Root open modal={false} disablePointerDismissal={false} snapPoints={snapPoints} snapPoint={snap} onSnapPointChange={(next, details) => {
          // A press outside the sheet (Undo, a dialog) is not a drag: the sheet keeps the snap point it had.
          if (!dialogOpen() && details.reason !== 'outside-press') setSnap(next);
        }}
        onOpenChange={(open, details) => {
          // A dialog opened from inside the sheet (New Page…, New Sheet…) sits outside it; pressing in the dialog is not a press outside the sheet.
          if (!open && details.reason === 'outside-press' && (details.event.target as Element | null)?.closest?.('[role=dialog], [role=alertdialog]')) return;
          // Undo and Redo edit what the sheet shows; the document change itself closes the sheet when the selection is gone.
          if (!open && details.reason === 'outside-press' && (details.event.target as Element | null)?.closest?.('[data-keeps-sheet]')) return;
          if (!open) close();
        }}>
        <Drawer.Portal><Drawer.Viewport className="w2-props-viewport"><Drawer.Popup className="w2-scope w2-sheet w2-props-sheet" aria-label="Properties" style={{ '--w2-sheet-hidden': `${Math.max(0, window.innerHeight - coverage(snap))}px` } as CSSProperties}>
          <div className="w2-grabber" aria-hidden/>
          <Drawer.Content className="w2-sheet-content w2-props-content">{properties}</Drawer.Content>
        </Drawer.Popup></Drawer.Viewport></Drawer.Portal>
      </Drawer.Root>}
      {document && <PublishDialog ws={ws}/>}
      {document && <ConflictDialog ws={ws}/>}
      <OpenFromPublished ws={ws} active={active}/>
      {document && <LinkedHost ws={ws}/>}
      </DragLayer>
      </AddHost>
      </WorkspaceDataProvider>
    </ToastHost>
    </SimulatorWindowContext.Provider>
    </SelectMenusContext.Provider>
  </div>;
}
