import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CompositionAction, CompositionDocument } from '../shared/composition/schema';
import type { Json } from '../shared/types';
import { planAction } from './actions';
import { DeviceFrame, STAGE_PADDING, useAutoFit } from './DeviceFrame';
import { createEnvironment, localValue, type House, type Overlay } from './projections';
import { buildDocumentIndex, type SelectionKey } from './model';
import { currentSurface, initialNav, navigateTo, reduceNavigation, sameSurface, type NavState } from './navigation';
import { RenderCtx, type RenderContext } from './render-context';
import { Screen } from './Screen';
import { SelectionLayer } from './SelectionLayer';
import { createSelectionStore } from './selection-store';
import { previewWindows, type PreviewWindow } from './windows';
import './preview2.css';

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
  /** From `useHouseStates`; undefined while loading. */
  house?: House;
  overlay: Overlay;
  /** Simulated calls and `set-local` in Use. */
  onOverlayChange(next: Overlay): void;
  /** For example `Simulated light.turn_on`. */
  onSimulatedCall?(summary: string): void;
  /** Scrolls this node into view. */
  revealKey?: SelectionKey;
  /** Pixels covered by a narrow sheet; the revealed node stays above them. */
  bottomInset?: number;
}

/** Width of the device bezel on each side, in px at zoom 1. */
const BEZEL = 12;
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
  const { document, mode, surface, window: win, bezel, house, overlay, selection, revealKey, bottomInset = 0 } = props;
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
  const run = useCallback((action: CompositionAction, control?: Json) => {
    const now = latest.current;
    if (now.mode !== 'use') return;
    const plan = planAction(action, { document: now.document, house: now.house ?? loadingHouse, overlay: now.overlay, control });
    if (plan.overlay) { latest.current = { ...now, overlay: plan.overlay }; now.onOverlayChange(plan.overlay); }
    if (plan.simulated) now.onSimulatedCall?.(plan.simulated);
    if (plan.nav) commit(reduceNavigation(now.document, latest.current.nav, plan.nav));
  }, [commit]);

  // What the nodes read. Built from the sources, not the whole document, so an edit to one title leaves it unchanged.
  const store = useMemo(createSelectionStore, []);
  const previous = useRef(new Map<string, boolean>()).current;
  const resolvedHouse = house ?? loadingHouse;
  const env = useMemo(() => createEnvironment({ dataSources: document.dataSources }, resolvedHouse, overlay), [document.dataSources, resolvedHouse, overlay]);
  const localState = document.localState;
  const context = useMemo<RenderContext>(() => ({
    mode, env, house: resolvedHouse, overlay, run, store, previous,
    field: id => localState?.find(item => item.id === id),
    local: id => localValue({ localState }, overlay, id),
  }), [mode, env, resolvedHouse, overlay, run, store, previous, localState]);

  // Selection lives in the store; a local tab that holds the selection or the reveal target must show it.
  const tabs = useMemo(() => {
    const hints: Record<string, string> = {};
    for (const key of [selection, revealKey]) {
      if (!key) continue;
      for (const part of [...index.ancestors(key), key]) if (part.startsWith('local-tab:')) { const [node, tab] = part.slice('local-tab:'.length).split('/'); hints[node] = tab; }
    }
    return hints;
  }, [index, selection, revealKey]);
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
  const modelWidth = win.width + (bezel ? 2 * BEZEL : 0), modelHeight = win.height + (bezel ? 2 * BEZEL : 0);
  let zoom = 1, height = modelHeight;
  if (box.w > 0) {
    if (bezel) zoom = Math.max(.25, Math.min(1.2, (box.w - STAGE_PADDING.x) / modelWidth, box.h > 0 ? (box.h - STAGE_PADDING.y) / modelHeight : Infinity));
    else { zoom = box.w / win.width; if (box.h > 0) height = Math.max(240, box.h / zoom); }
  }

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
  const style = { '--sh-inset': `${bottomInset / zoom}px` } as CSSProperties;
  return <div ref={host} className="sh-preview2" data-mode={mode} data-bezel={bezel ? '' : undefined} style={style}>
    <RenderCtx.Provider value={context}>
      <DeviceFrame width={modelWidth} height={height} zoom={zoom} pan={mode === 'use'} padding={bezel ? STAGE_PADDING : { x: 0, y: 0 }}
        modelClassName={`sh-model ${bezel ? 'sh-bezel' : 'sh-flat'}`}>
        <SelectionLayer mode={mode} index={index} selection={selection} onSelect={props.onSelect} onTab={onTab}>
          <Screen document={document} nav={nav} window={win}/>
        </SelectionLayer>
      </DeviceFrame>
    </RenderCtx.Provider>
  </div>;
}
