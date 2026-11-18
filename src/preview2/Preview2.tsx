import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CompositionActionSlot, CompositionDocument } from '../shared/composition/schema';
import type { Json } from '../shared/types';
import { planAction } from './actions';
import { AlertOverlay } from './AlertOverlay';
import type { AlertSpec } from './alert';
import { DeviceFrame, STAGE_PADDING, useAutoFit } from './DeviceFrame';
import { usePreviewClock, useReadsSecondClock } from './clock';
import { createEnvironment, localValue, type House, type Overlay } from './projections';
import { buildDocumentIndex, type SelectionKey } from './model';
import { currentSurface, initialNav, navigateTo, reduceNavigation, sameSurface, type NavState } from './navigation';
import { deliverCall } from './live-calls';
import type { LiveHouse } from './live-house';
import { RenderCtx, type RenderContext, type StatePreview } from './render-context';
import type { ItemScope, UseRecords } from './flow-records';
import { Screen } from './Screen';
import { SelectionLayer } from './SelectionLayer';
import { createSelectionStore } from './selection-store';
import { ComponentLibraryContext, previewSources } from './component-library';
import { libraryById } from '../shared/composition/components';
import { previewWindows, radiiCss, type PreviewWindow } from './windows';
import { markTitle, useUseMarker } from './use-marker';
import { useRepeatMark } from './repeat-marker';
import { tileInkDefault } from '../shared/composition/tile-ink-gate';
import { markPerson } from './grid-groups';
import './preview2.css';
import './text-size.css';

/** The text scale from which the simulator counts as one of the largest sizes (the last step of the Studio's text control). */
const LARGEST_TEXT = 1.42;

export { previewWindows, type PreviewWindow };
/** A page or a presented sheet. */
export type PreviewSurface = { kind: 'page' | 'modal'; id: string };

/** Props of {@link Preview2}. See `build/design/studio-ux/preview2-contract.md`. */
export interface Preview2Props {
  /** The last document that compiled. */
  document: CompositionDocument;
  mode: 'edit' | 'use';
  /** The page (or presented sheet) shown. */
  surface: PreviewSurface;
  /** Use navigation, and tab taps in Edit. */
  onSurfaceChange(next: PreviewSurface): void;
  selection?: SelectionKey;
  /** Edit only. Esc selects the parent, then undefined. */
  onSelect(next: SelectionKey | undefined): void;
  window: PreviewWindow;
  /** False on narrow widths: full width, top corners rounded. */
  bezel: boolean;
  /** From `useHouseStates`; undefined while loading. Ignored when `live` is given. */
  house?: House;
  /**
   * The house as per-entity boxes (`useHouseStates().live`). Given, the preview draws from it and a change to one entity draws
   * only the nodes that read that entity; it never draws the page again for a change of state.
   */
  live?: LiveHouse;
  overlay: Overlay;
  /** Simulated calls and `set-local` in Use. */
  onOverlayChange(next: Overlay): void;
  /** For example `Kitchen light: turn on`. */
  onSimulatedCall?(summary: string): void;
  /** Scrolls this node into view. */
  revealKey?: SelectionKey;
  /** The piece the Repeated Pieces proposal is about: a dashed outline and a tag ("1 of 14"). */
  repeatMark?: { key: SelectionKey; label: string };
  /** Pixels covered by a narrow sheet; the revealed node stays above them. */
  bottomInset?: number;
  /** The text size simulated, as a fraction of the app's default (the simulator's Smaller Text and Larger Text); 1 when absent. */
  textScale?: number;
  /** The Studio's Appearance setting when it is Light or Dark: a sheet that declares `system` is drawn in it. Absent when the Studio follows the system. */
  appearance?: 'light' | 'dark';
  /** The tile ink drawn: `primary` is the ink of `sh.tile-ink-default@1`, `muted` the grey of an app that predates it. Absent: the gate decides (`tile-ink-gate.ts`). */
  ink?: 'primary' | 'muted';
  /** Runs the flow of a source and gives its records, for `repeat` (`sh.repeat@1`). Absent: a repeat draws its placeholder. A hook, so it must not change between renders. */
  records?: UseRecords;
  /** An alert to draw over the screen as a preview (Edit): the words of the Ask First page while a field has focus. */
  alert?: AlertSpec;
  /** The state forced on the selected state tile in Edit. */
  statePreview?: StatePreview;
  /** Reads a vacuum map camera's PNG for the live map (`RenderContext.mapPicture`); without it the map is a schematic. */
  mapPicture?: RenderContext['mapPicture'];
}

const loadingHouse: House = {};

/** Moves a scroller, smoothly unless motion is reduced. */
function scrollTo(scroller: HTMLElement, top: number) {
  const smooth = typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  else scroller.scrollTop = top;
}

/**
 * The Studio 2.0 preview: the app's pages, header, floating tab bar and sheets drawn from the validated document, with the
 * app's own dark look under `.sh-` classes. Edit selects what is clicked; Use navigates and simulates calls, never reaching a
 * real service. It never fetches: data arrives through `house` and `overlay`.
 */
export default function Preview2(props: Preview2Props) {
  const { document, mode, surface, window: win, bezel, live, overlay, selection, revealKey, bottomInset = 0 } = props;
  const house = live ? live.house : props.house;
  const index = useMemo(() => buildDocumentIndex(document), [document]);

  // Navigation: the surface prop is the shell's choice; Use moves on its own and reports where it went.
  const [nav, setNav] = useState<NavState>(() => navigateTo(document, initialNav(document), surface));
  const [seen, setSeen] = useState(surface);
  if (!sameSurface(seen, surface)) {
    setSeen(surface);
    if (!sameSurface(currentSurface(document, nav), surface)) setNav(navigateTo(document, nav, surface));
  }
  const latest = useRef({ ...props, nav });
  latest.current = { ...props, nav };
  const commit = useCallback((next: NavState) => {
    const from = latest.current;
    if (next === from.nav) return;
    latest.current = { ...from, nav: next };
    setNav(next);
    const before = currentSurface(from.document, from.nav), after = currentSurface(from.document, next);
    if (!sameSurface(before, after)) from.onSurfaceChange(after);
  }, []);
  // Use mode: an action that asks first waits for the person's answer to the alert.
  const [pending, setPending] = useState<{ action?: CompositionActionSlot; control?: Json; controlValues?: Record<string, Json>; scope?: ItemScope; alert: AlertSpec; then?: () => void }>();
  const execute = useCallback((action: CompositionActionSlot, control: Json | undefined, confirmed: boolean, scope?: ItemScope, controlValues?: Record<string, Json>) => {
    const now = latest.current;
    if (now.mode !== 'use') return;
    const plan = planAction(action, { document: now.document, house: now.live?.house ?? now.house ?? loadingHouse, overlay: now.overlay, control, controlValues, confirmed, scope });
    if (plan.confirm) { setPending({ action, control, controlValues, scope, alert: plan.confirm }); return; }
    markPerson();
    if (plan.overlay) { latest.current = { ...now, overlay: plan.overlay }; now.onOverlayChange(plan.overlay); }
    if (plan.call) deliverCall(plan.call);
    if (plan.simulated) now.onSimulatedCall?.(plan.simulated);
    if (plan.nav) commit(reduceNavigation(now.document, latest.current.nav, plan.nav));
  }, [commit]);
  const run = useCallback((action: CompositionActionSlot, control?: Json, scope?: ItemScope, controlValues?: Record<string, Json>) => execute(action, control, false, scope, controlValues), [execute]);
  const answer = (confirmed: boolean) => { const held = pending; setPending(undefined); if (confirmed && held) { if (held.then) held.then(); else if (held.action) execute(held.action, held.control, true, held.scope, held.controlValues); } };
  const ask = useCallback((alert: AlertSpec, then: () => void) => { if (latest.current.mode === 'use') setPending({ alert, then }); }, []);
  const note = useCallback((summary: string) => latest.current.onSimulatedCall?.(summary), []);
  useEffect(() => { if (props.mode !== 'use') setPending(undefined); }, [props.mode]);

  // What the nodes read. Built from the sources, not the whole document, so an edit to one title leaves it unchanged.
  const store = useMemo(createSelectionStore, []);
  const previous = useRef(new Map<string, boolean>()).current;
  const kept = useRef(new Map<string, unknown>()).current;
  const resolvedHouse = house ?? loadingHouse;
  // The sources the places of a template own are read like any other (`previewSources`).
  const dataSources = useMemo(() => previewSources(document), [document.dataSources, document.pages, document.modals, document.componentLibrary]); // eslint-disable-line react-hooks/exhaustive-deps
  // The clock `clock` and `date` operands read; it ticks once a second only while the document reads `now-second` (`sh.countdown@1`).
  const clock = usePreviewClock(useReadsSecondClock(document));
  const env = useMemo(() => createEnvironment({ dataSources }, resolvedHouse, overlay, undefined, clock), [dataSources, resolvedHouse, overlay, clock]);
  const localState = document.localState;
  const stateStyles = document.stateStyles;
  const library = useMemo(() => libraryById(document), [document.componentLibrary]);
  const context = useMemo<RenderContext>(() => ({
    mode, env, house: resolvedHouse, overlay, run, store, previous, kept, stateStyles, sources: document.dataSources, ask, note, statePreview: mode === 'edit' ? props.statePreview : undefined, mapPicture: props.mapPicture, appearance: props.appearance, largeText: (props.textScale ?? 1) >= LARGEST_TEXT, textScale: props.textScale, records: props.records ? { sources: dataSources, use: props.records } : undefined,
    live: live ? { store: live, dataSources } : undefined,
    field: id => localState?.find(item => item.id === id),
    local: id => localValue({ localState }, overlay, id),
  }), [mode, env, resolvedHouse, overlay, run, store, previous, kept, localState, stateStyles, ask, note, props.statePreview, props.mapPicture, props.appearance, props.textScale, props.records, live, dataSources, document.dataSources]);

  // Selection lives in the store; a local tab that holds the selection or the reveal target must show it.
  const tabs = useMemo(() => {
    const hints: Record<string, string> = {};
    for (const key of [selection, revealKey, props.repeatMark?.key]) {
      if (!key) continue;
      for (const part of [...index.ancestors(key), key]) {
        const entry = part.startsWith('local-tab:') ? index.get(part) : undefined;
        // The area's tabs, comma-joined (an identifier holds no comma): the container keeps the tab on show when it is one of them.
        if (entry?.tabs) hints[entry.id.slice(0, entry.id.indexOf('/'))] = entry.tabs.join(',');
      }
    }
    return hints;
  }, [index, selection, revealKey, props.repeatMark?.key]);
  store.put(selection, tabs);
  useLayoutEffect(() => store.notify(), [store, selection, tabs]);

  // Size: the window scaled to fit its container; without a bezel it fills the width and takes the height that is left.
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const measure = useCallback(() => {
    const element = host.current;
    if (element) setBox(old => old.w === element.clientWidth && old.h === element.clientHeight ? old : { w: element.clientWidth, h: element.clientHeight });
  }, []);
  useAutoFit(host, true, measure);
  // The body the window draws around itself: its bezel, and the hinge strip that stands outside the folded Duo's body.
  const frame = bezel ? win.frame : undefined;
  const modelWidth = win.width + (frame ? 2 * frame.bezel + (frame.hingeStrip?.outside ?? 0) : 0), modelHeight = win.height + (frame ? 2 * frame.bezel : 0);
  const bodyStyle = frame ? {
    '--sh-bezel': `${frame.bezel}px`, '--sh-outside': `${frame.hingeStrip?.outside ?? 0}px`, '--sh-screen-radius': radiiCss(frame.screenRadii), '--sh-body-radius': radiiCss(frame.bodyRadii),
    ...(frame.hingeStrip ? { '--sh-strip-w': `${frame.hingeStrip.width}px`, '--sh-strip-h': `${frame.hingeStrip.height}px`, '--sh-strip-r': `${frame.hingeStrip.radius}px` } : {}),
  } as CSSProperties : undefined;
  let zoom = 1, height = modelHeight;
  if (box.w > 0) {
    if (bezel) zoom = Math.max(.25, Math.min(1.2, (box.w - STAGE_PADDING.x) / modelWidth, box.h > 0 ? (box.h - STAGE_PADDING.y) / modelHeight : Infinity));
    else { zoom = box.w / win.width; if (box.h > 0) height = Math.max(240, box.h / zoom); }
  }

  // Use: the selected element carries corner marks and a name tag (L-mark); `marked` is its name for the status line.
  const marked = useUseMarker(host, mode === 'use', selection, useMemo(() => selection ? markTitle(document, selection) : undefined, [document, selection]), zoom);

  // Repeated Pieces: the dashed mark and its tag on the place on show.
  useRepeatMark(host, props.repeatMark?.key, props.repeatMark?.label, zoom);

  // Bring the reveal target into view above a narrow sheet.
  useEffect(() => {
    if (!revealKey) return;
    const target = [...(host.current?.querySelectorAll('[data-sel]') ?? [])].find(element => element.getAttribute('data-sel') === revealKey);
    const scroller = target?.closest<HTMLElement>('.sh-scroll');
    if (!target || !scroller) return;
    const view = scroller.getBoundingClientRect(), box = target.getBoundingClientRect();
    const scale = scroller.clientHeight > 0 && view.height > 0 ? view.height / scroller.clientHeight : zoom;
    const top = view.top + (scroller.closest('.sh-sheet') ? 56 : win.safeTop + 48) * scale, bottom = view.bottom - bottomInset, margin = 16 * scale;
    if (box.bottom > bottom) scrollTo(scroller, scroller.scrollTop + (box.bottom - bottom + margin) / scale);
    else if (box.top < top) scrollTo(scroller, Math.max(0, scroller.scrollTop - (top - box.top + margin) / scale));
  }, [revealKey, bottomInset, surface.kind, surface.id, zoom, win.safeTop]);

  const onTab = useCallback((tabId: string) => {
    const tab = latest.current.document.navigation.tabs.find(item => item.id === tabId);
    if (tab) latest.current.onSurfaceChange({ kind: 'page', id: tab.pageId });
  }, []);
  const style = { '--sh-inset': `${bottomInset / zoom}px`, '--sh-zoom': zoom, ...(props.textScale && props.textScale !== 1 ? { '--sh-text-scale': props.textScale } : {}) } as CSSProperties;
  return <div ref={host} className="sh-preview2" data-preview-root data-ink={props.ink ?? (tileInkDefault ? 'primary' : 'muted')} data-mode={mode} data-text-scale={props.textScale && props.textScale !== 1 ? props.textScale : undefined} data-bezel={bezel ? '' : undefined} style={style}>
    <RenderCtx.Provider value={context}><ComponentLibraryContext.Provider value={library}>
      <DeviceFrame width={modelWidth} height={height} zoom={zoom} pan={mode === 'use'} padding={bezel ? STAGE_PADDING : { x: 0, y: 0 }}
        modelClassName={`sh-model ${bezel ? 'sh-bezel' : 'sh-flat'}`} modelStyle={bodyStyle} modelProps={frame?.hingeStrip ? { 'data-strip': '' } : undefined}>
        <SelectionLayer mode={mode} index={index} selection={selection} onSelect={props.onSelect} onTab={onTab}>
          <Screen document={document} nav={nav} window={win}/>
          <AlertOverlay alert={mode === 'use' ? pending?.alert : props.alert} live={mode === 'use' && Boolean(pending)} onCancel={() => answer(false)} onConfirm={() => answer(true)}/>
        </SelectionLayer>
      </DeviceFrame>
    </ComponentLibraryContext.Provider></RenderCtx.Provider>
    {mode === 'use' && <span className="sh-use-status" role="status">{marked ? `Showing ${marked} in the simulator.` : ''}</span>}
  </div>;
}
