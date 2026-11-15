import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MobileTouchSensor } from '../../mobile-drag';
import type { SelectionKey } from '../../preview2/model';
import type { Destination } from '../add/insert';
import type { Workspace2 } from '../useWorkspace2';
import { cueFor, locateOnCanvas, type Cue, type Hit } from './geometry';
import { moveToSlot, placementOf, spoken, validSlots } from './moves';
import { SHEET_SNAP_EVENT } from '../editors/EditorRow';
import './dnd.css';

/** The mouse starts a drag after this many pixels (HIG: "once a selection moves about three points"; spec 6 says 4). */
export const MOUSE_SLOP = 4;
/** The touch long press: the existing sensor's values. */
export const TOUCH_DELAY = 220, TOUCH_TOLERANCE = 8;
/** Auto-scroll starts this close to an edge of the scroller. */
export const EDGE = 56;

/** A way to find where a pointer would drop. The canvas and "This Page" each have one. */
export type Locator = (x: number, y: number) => Hit | undefined;

/** What a source gives when it starts a drag. */
export interface BeginArgs {
  key: SelectionKey;
  mode: 'mouse' | 'touch' | 'keyboard';
  point: { x: number; y: number };
  locate: Locator;
  /** The element to copy into the drag image. */
  ghostOf?: HTMLElement | null;
}

/** The drag API sources use. */
export interface DragApi {
  begin(args: BeginArgs): void;
  move(x: number, y: number): void;
  end(): void;
  cancel(): void;
  /** Picks a node up by keyboard: arrows step through every valid slot, Space drops, Esc cancels. */
  startKeyboard(key: SelectionKey, locate?: (destination: Destination) => Cue | undefined): void;
  readonly active: boolean;
}
const DragContext = createContext<DragApi | undefined>(undefined);
/** The drag API, or undefined outside the layer. */
export const useDrag = () => useContext(DragContext);

interface Session { key: SelectionKey; mode: BeginArgs['mode']; hit?: Hit; point: { x: number; y: number }; box: { width: number; height: number; dx: number; dy: number }; ghost?: HTMLElement; scale: number }

/** Copies an element into a drag image: the node itself at the preview's scale, lifted and 90% opaque. */
function makeGhost(source: HTMLElement): { element: HTMLElement; width: number; height: number; scale: number } {
  const rect = source.getBoundingClientRect();
  const scale = source.offsetWidth > 0 ? rect.width / source.offsetWidth : 1;
  const wrapper = document.createElement('div');
  wrapper.className = 'sh-preview2 w2-ghost-inner';
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-sel'); copy.removeAttribute('data-selected');
  copy.querySelectorAll('[data-sel], .sh-handle-slot, .sh-add-slot').forEach(node => { node.removeAttribute('data-sel'); if (node.matches('.sh-handle-slot, .sh-add-slot')) node.remove(); });
  copy.style.width = `${source.offsetWidth}px`;
  wrapper.append(copy);
  Object.assign(wrapper.style, { width: `${source.offsetWidth}px`, height: `${source.offsetHeight}px`, transform: `scale(${scale})`, transformOrigin: 'top left', overflow: 'visible' });
  return { element: wrapper, width: rect.width, height: rect.height, scale };
}

/**
 * Drag and drop for the canvas and "This Page" (spec section 6). Sources call `begin`; this layer finds the slot under the
 * pointer, draws the drop cue where the pointer is (an outline on the target container and a bar where the node lands), the
 * drag image, scrolls a scroller near its edge, and on release makes the move: one undo step, the node stays selected.
 * `stage` is the preview's host; mouse and touch (the existing long-press sensor) start on a node there.
 */
export default function DragLayer({ ws, stage, narrow, onError, children }: { ws: Workspace2; stage: HTMLElement | null; narrow: boolean; onError: (message: string) => void; children: ReactNode }) {
  const [session, setSession] = useState<Session>();
  const [announcement, setAnnouncement] = useState('');
  const live = useRef<Session | undefined>(undefined);
  const latest = useRef({ ws, onError });
  latest.current = { ws, onError };
  const locator = useRef<Locator>(() => undefined);
  const scrollRef = useRef({ speed: 0, scroller: null as HTMLElement | null, frame: 0 });
  const keyboard = useRef<{ slots: Destination[]; cursor: number; cue?: (destination: Destination) => Cue | undefined } | undefined>(undefined);
  const ghostHost = useRef<HTMLDivElement>(null);

  const update = useCallback((next: Session | undefined) => { live.current = next; setSession(next); }, []);
  const stopScroll = () => { cancelAnimationFrame(scrollRef.current.frame); scrollRef.current = { speed: 0, scroller: null, frame: 0 }; };
  const snapSheet = (to: 'peek' | 'half') => { if (narrow) window.dispatchEvent(new CustomEvent(SHEET_SNAP_EVENT, { detail: to })); };

  const find = useCallback((x: number, y: number) => {
    const current = live.current;
    if (!current) return;
    update({ ...current, point: { x, y }, hit: locator.current(x, y) });
  }, [update]);

  const tickScroll = useCallback(() => {
    const state = scrollRef.current;
    if (!state.scroller || !state.speed) { state.frame = 0; return; }
    state.scroller.scrollTop += state.speed;
    const point = live.current?.point;
    if (point) find(point.x, point.y);
    state.frame = requestAnimationFrame(tickScroll);
  }, [find]);
  const autoScroll = useCallback((x: number, y: number) => {
    // Only while the drag stays inside a scroller (HIG): the one under the pointer, faster nearer its edge.
    const scroller = document.elementsFromPoint(x, y).find((element): element is HTMLElement => element instanceof HTMLElement && (element.classList.contains('sh-scroll') || element.classList.contains('w2-pages-scroll') || element.classList.contains('w2-this-page-list'))) ?? null;
    const state = scrollRef.current;
    if (!scroller) { state.speed = 0; return; }
    const box = scroller.getBoundingClientRect();
    const top = y - box.top, bottom = box.bottom - y;
    state.scroller = scroller;
    state.speed = top < EDGE ? -Math.ceil((EDGE - top) / EDGE * 14) : bottom < EDGE ? Math.ceil((EDGE - bottom) / EDGE * 14) : 0;
    if (state.speed && !state.frame) state.frame = requestAnimationFrame(tickScroll);
  }, [tickScroll]);

  const begin = useCallback((args: BeginArgs) => {
    if (live.current) return;
    locator.current = args.locate;
    const ghost = args.ghostOf ? makeGhost(args.ghostOf) : undefined;
    const rect = args.ghostOf?.getBoundingClientRect();
    if (latest.current.ws.selection !== args.key) latest.current.ws.select(args.key);
    snapSheet('peek');
    update({ key: args.key, mode: args.mode, point: args.point, hit: args.locate(args.point.x, args.point.y), ghost: ghost?.element, scale: ghost?.scale ?? 1,
      box: { width: ghost?.width ?? 0, height: ghost?.height ?? 0, dx: rect ? args.point.x - rect.left : 0, dy: rect ? args.point.y - rect.top : 0 } });
    const entry = latest.current.ws.index?.get(args.key);
    if (entry?.node && args.mode !== 'keyboard') setAnnouncement(`Picked up ${entry.node.title}.`);
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback((commit: boolean) => {
    const current = live.current;
    stopScroll(); keyboard.current = undefined;
    update(undefined); snapSheet('half');
    if (!current) return;
    const { ws: workspace, onError: fail } = latest.current;
    const document = workspace.document;
    if (!commit || !current.hit || !document) { setAnnouncement(spoken.cancelled); return; }
    const title = workspace.index?.get(current.key)?.node?.title ?? 'item';
    try {
      const entry = workspace.index?.get(current.key);
      const at = entry ? Number(entry.path.at(-1)) : -1;
      const same = entry && entry.path.slice(0, -1).join('/') === current.hit.destination.list.join('/');
      if (same && (current.hit.destination.index === at || current.hit.destination.index === at + 1)) { workspace.select(current.key); return; }
      const result = moveToSlot(document, current.key, current.hit.destination);
      workspace.studio.apply(result.document);
      workspace.select(result.key);
      setAnnouncement(spoken.moved(title, result.placement));
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); setAnnouncement(spoken.cancelled); }
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback((x: number, y: number) => { find(x, y); autoScroll(x, y); }, [find, autoScroll]);
  const cancel = useCallback(() => finish(false), [finish]);
  const end = useCallback(() => finish(true), [finish]);

  const startKeyboard = useCallback((key: SelectionKey, cueOf?: (destination: Destination) => Cue | undefined) => {
    const document = latest.current.ws.document, index = latest.current.ws.index;
    const entry = index?.get(key);
    if (!document || !entry?.node || live.current) return;
    const slots = validSlots(document, key);
    keyboard.current = { slots, cursor: -1, cue: cueOf ?? (destination => stage ? cueFor(stage, document, destination) : undefined) };
    live.current = undefined;
    const placement = { position: Number(entry.path.at(-1)) + 1, of: (document.pages.flatMap(p => p.components) as unknown[]).length, title: '' };
    void placement;
    const siblings = (index?.children(entry.parent ?? key) ?? []).length;
    const parentTitle = entry.parent ? index?.get(entry.parent)?.node?.title ?? (document.pages.find(p => `page:${p.id}` === entry.parent)?.title ?? document.modals.find(m => `modal:${m.id}` === entry.parent)?.title ?? '') : '';
    update({ key, mode: 'keyboard', point: { x: 0, y: 0 }, box: { width: 0, height: 0, dx: 0, dy: 0 }, scale: 1 });
    setAnnouncement(spoken.pickedUp(entry.node.title, { position: Number(entry.path.at(-1)) + 1, of: siblings, title: parentTitle }));
  }, [update, stage]);

  // Keyboard: arrows step through every valid slot in document order across containers, Space drops, Esc cancels.
  useEffect(() => {
    if (!session || session.mode !== 'keyboard') return;
    const listener = (event: KeyboardEvent) => {
      const state = keyboard.current, document = latest.current.ws.document;
      if (!state || !document) return;
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (step) {
        event.preventDefault(); event.stopPropagation();
        const entry = latest.current.ws.index?.get(session.key);
        const index = latest.current.ws.index;
        const home = entry ? [index?.keys.indexOf(entry.parent ?? session.key) ?? 0, Number(entry.path.at(-1))] : [0, 0];
        const order = (slot: Destination) => [index?.keys.indexOf(slot.owner) ?? 0, slot.index];
        const after = (a: number[], b: number[]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
        if (state.cursor === -1) state.cursor = step > 0 ? state.slots.findIndex(slot => after(order(slot), home)) : state.slots.map((slot, i) => after(home, order(slot)) ? i : -1).reduce((a, b) => Math.max(a, b), -1);
        else state.cursor += step;
        state.cursor = Math.max(0, Math.min(state.slots.length - 1, state.cursor));
        const destination = state.slots[state.cursor];
        if (!destination) return;
        const hit = { destination, cue: state.cue?.(destination) ?? { line: { left: 0, top: 0, width: 0, height: 0 }, name: '', vertical: false } };
        update({ ...(live.current ?? session), hit });
        setAnnouncement(spoken.over(placementOf(document, session.key, destination)));
        stage?.querySelector<HTMLElement>(`[data-add-for="${destination.owner}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [session?.key, session?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse and touch start on a node in the preview. A click without movement still selects, as before.
  useEffect(() => {
    if (!stage || ws.mode !== 'edit') return;
    const nodeAt = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('.sh-handle-slot, .sh-add-slot, input, textarea, select')) return undefined;
      const element = target.closest<HTMLElement>('[data-sel^="node:"]');
      return element ? { element, key: element.getAttribute('data-sel') as SelectionKey } : undefined;
    };
    const locate: Locator = (x, y) => ws.document && live.current ? locateOnCanvas(stage, ws.document, live.current.key, x, y) : undefined;
    const suppressClick = () => { const block = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); }; window.addEventListener('click', block, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', block, true), 80); };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0 || live.current) return;
      const found = nodeAt(event.target);
      if (!found) return;
      const start = { x: event.clientX, y: event.clientY };
      let started = false;
      const moved = (e: PointerEvent) => {
        if (!started) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MOUSE_SLOP) return;
          started = true;
          begin({ key: found.key, mode: 'mouse', point: start, locate: (x, y) => ws.document ? locateOnCanvas(stage, ws.document, found.key, x, y) : undefined, ghostOf: found.element });
        }
        e.preventDefault();
        move(e.clientX, e.clientY);
      };
      const up = () => { cleanup(); if (started) { suppressClick(); end(); } };
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && started) { cleanup(); suppressClick(); cancel(); } };
      const cleanup = () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('keydown', key, true); };
      window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('keydown', key, true);
    };
    const touch = (event: TouchEvent) => {
      if (event.touches.length !== 1 || live.current) return;
      const found = nodeAt(event.target);
      if (!found) return;
      const point = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      try {
        // The existing long-press sensor: 220 ms within 8 px, then drag; a quick swipe scrolls.
        new MobileTouchSensor({
          event, active: found.key, options: { activationConstraint: { delay: TOUCH_DELAY, tolerance: TOUCH_TOLERANCE } },
          onPending() {}, onAbort() {},
          onStart: (initial?: { x: number; y: number }) => begin({ key: found.key, mode: 'touch', point: initial ?? point, locate: (x, y) => ws.document ? locateOnCanvas(stage, ws.document, found.key, x, y) : undefined, ghostOf: found.element }),
          onMove: (coordinates: { x: number; y: number }) => move(coordinates.x, coordinates.y), onEnd: () => end(), onCancel: () => cancel(),
        } as unknown as ConstructorParameters<typeof MobileTouchSensor>[0]);
      } catch { /* a second finger */ }
    };
    void locate;
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('touchstart', touch, { passive: true });
    return () => { stage.removeEventListener('pointerdown', down); stage.removeEventListener('touchstart', touch); };
  }, [stage, ws.mode, ws.document, begin, move, end, cancel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopScroll(), []);
  useEffect(() => { const host = ghostHost.current; if (host && session?.ghost) { host.replaceChildren(session.ghost); } else host?.replaceChildren(); }, [session?.ghost]);

  const api = useMemo<DragApi>(() => ({ begin, move, end, cancel, startKeyboard, get active() { return Boolean(live.current); } }), [begin, move, end, cancel, startKeyboard]);
  const hit = session?.hit;
  return <DragContext.Provider value={api}>
    {children}
    {createPortal(<>
      <div className="w2-sr" role="status" aria-live="assertive" data-testid="drag-announcement">{announcement}</div>
      {session && session.mode !== 'keyboard' && <div ref={ghostHost} className="w2-ghost" data-valid={hit ? '' : undefined} style={{ left: session.point.x - session.box.dx, top: session.point.y - session.box.dy, width: session.box.width, height: session.box.height, opacity: hit ? 0.9 : 0.5, cursor: hit ? 'grabbing' : 'not-allowed' }}/>}
      {session && hit && <>
        {hit.cue.container && <div className="w2-cue-container" data-testid="drop-container" style={{ left: hit.cue.container.left, top: hit.cue.container.top, width: hit.cue.container.width, height: hit.cue.container.height }}><span className="w2-cue-tag">{hit.cue.name}</span></div>}
        <div className="w2-cue-line" data-testid="drop-cue" data-vertical={hit.cue.vertical || undefined} style={{ left: hit.cue.line.left, top: hit.cue.line.top, width: hit.cue.line.width, height: hit.cue.line.height }}/>
      </>}
    </>, window.document.body)}
  </DragContext.Provider>;
}
