import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleCheck, CircleHelp, ChevronRight, Ellipsis, GitBranch, List, Maximize, Minus, Plus, Redo2, SlidersHorizontal, Undo2, WandSparkles, X } from 'lucide-react';
import { lower, type CanvasHost, type GraphSourceMap, type BlockCatalogEntry, type GraphBudget, type GraphEdge, type GraphNode, type LogicGraph } from '../../shared/composition/graph';
import type { DerivedTheme } from '../theme';
import { blockSeed, nodeName, portLabel } from './blocks';
import { detachedNodes, edit, initialEditState, orderedNodes, type CanvasFocus, type EditCommand } from './edit';
import Palette from './Palette';
import Inspector from './Inspector';
import ConnectionDialog, { type ConnectionRequest } from './ConnectionDialog';
import LimitsMeter from './LimitsMeter';
import { canvasTheme, wireKind } from './theme';
import './canvas.css';
import { describeObservation, type CanvasHostWithObservations } from './observations';
import { indexGraph } from './graph-index';
import CanvasBlock, { type BlockActions } from './CanvasBlock';
import { blockLayoutKey, presentBlocks, type BlockPresentation } from './presentation';
import { canvasWindowAt, intersectsWindow, useCanvasWindow } from './windowing';
import { countCrossings, countOverlaps, tidyCanvas, type TidyMeasure } from './tidy';
import Modal from './CanvasDialog';
import AnnotationEditor, { annotationError, type AnnotationDraft } from './AnnotationEditor';
import DataPeek from './DataPeek';
import { frameCanvas } from './framing';

const focusKey = (focus: CanvasFocus) => JSON.stringify(focus);
const editable = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable=true]'));
interface WirePath { readonly id: string; readonly path: string; readonly kind: string; readonly from: GraphEdge['from'] }
const CanvasWires = memo(function CanvasWires({ paths, width, height, observations }: { paths: readonly WirePath[]; width: number; height: number; observations: CanvasHostWithObservations['observations'] }) {
  return <li className="w2-canvas-wires" aria-hidden><svg width={width} height={height}>{paths.map(wire => <path key={wire.id} data-observation-state={observations?.[wire.from.nodeId]?.outputs?.[wire.from.portId]?.state} d={wire.path} className={`w2-canvas-wire w2-canvas-wire-${wire.kind}`}/>)}</svg></li>;
});
export function arrangeCanvas(graph: LogicGraph): LogicGraph {
  return tidyCanvas(graph);
}
export interface FlowCanvasProps {
  readonly host: CanvasHostWithObservations;
  readonly graph: LogicGraph;
  readonly title: string;
  readonly theme: DerivedTheme;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
  readonly outputNames?: readonly string[];
  readonly onGraphChange?: (graph: LogicGraph, change: { readonly revision: number; readonly reason: 'initial' | EditCommand['type'] }) => void;
  readonly selectedNodeId?: string | null;
  readonly onSelectionChange?: (nodeId: string | null) => void;
  readonly onApply?: (transaction: Parameters<CanvasHost['apply']>[0], layout: CanvasLayoutHandoff) => ReturnType<CanvasHost['apply']>;
}
export interface CanvasLayoutHandoff {
  readonly graph: LogicGraph;
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly annotations: Readonly<Record<string, NonNullable<GraphNode['annotation']>>>;
  readonly sourceMap: GraphSourceMap;
}
export default function FlowCanvas({ host, graph: initialGraph, title, theme, onClose, returnFocus, outputNames, onGraphChange, selectedNodeId, onSelectionChange, onApply }: FlowCanvasProps) {
  const [state, setState] = useState(() => initialEditState(initialGraph));
  const [view, setView] = useState<'graph' | 'outline'>('graph'), [panel, setPanel] = useState<'palette' | 'inspector' | null>('palette');
  const [entered, setEntered] = useState<string>(), [connection, setConnection] = useState<ConnectionRequest>();
  const [deleting, setDeleting] = useState<GraphNode>(), [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [peek, setPeek] = useState<{ nodeId: string; keyboard: boolean }>();
  const [draft, setDraft] = useState<AnnotationDraft>(), draftRef = useRef(draft);
  draftRef.current = draft;
  const [pendingSelection, setPendingSelection] = useState<CanvasFocus>();
  const [pendingClose, setPendingClose] = useState(false);
  const [more, setMore] = useState(false), [help, setHelp] = useState(false), [problemsOpen, setProblemsOpen] = useState(false);
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 599px)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 599px)');
    if (!query) return;
    const update = () => setPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [zoom, setZoom] = useState(initialGraph.nodes.length > 200 ? .6 : 1), [moving, setMoving] = useState<{ nodeId: string; x: number; y: number }>();
  const [framing, setFraming] = useState(0), framed = useRef(-1);
  const [framedScroll, setFramedScroll] = useState<{ left: number; top: number }>();
  const pendingFramedScroll = useRef(framedScroll);
  const [wirePaths, setWirePaths] = useState<readonly WirePath[]>([]);
  const [initialSnapshot] = useState(() => host.snapshot());
  const snapshot = useRef(initialSnapshot), baseline = useRef(state.graph), refs = useRef(new Map<string, HTMLButtonElement>());
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLUListElement>(null), addButton = useRef<HTMLButtonElement>(null), navigation = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null), annotationOrigin = useRef<HTMLElement | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<string, TidyMeasure>>(new Map());
  const moreButton = useRef<HTMLButtonElement>(null), problemsButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false), connectionReturn = useRef<CanvasFocus | null>(null);
  const graph = state.graph;
  const notification = useRef({ graph: undefined as LogicGraph | undefined, revision: -1, reason: 'initial' as 'initial' | EditCommand['type'] });
  useLayoutEffect(() => {
    if (notification.current.graph === graph) return;
    notification.current.graph = graph;
    onGraphChange?.(graph, { revision: ++notification.current.revision, reason: notification.current.reason });
  }, [graph, onGraphChange]);
  const incomingSelection = useRef(selectedNodeId), lastSelection = useRef(state.focus?.nodeId ?? null);
  useLayoutEffect(() => {
    const changedByHost = incomingSelection.current !== selectedNodeId;
    incomingSelection.current = selectedNodeId;
    const id = state.focus?.nodeId ?? null;
    if (!changedByHost && lastSelection.current !== id && (selectedNodeId === undefined || selectedNodeId !== id)) onSelectionChange?.(id);
    lastSelection.current = id;
  }, [state.focus?.nodeId, selectedNodeId, onSelectionChange]);
  const effectiveFocus = selectedNodeId === undefined ? state.focus : selectedNodeId === null ? null
    : state.focus?.nodeId === selectedNodeId ? state.focus : { nodeId: selectedNodeId };
  const windowed = view === 'graph' && graph.nodes.length > 200;
  const observedWindow = useCanvasWindow(viewport, windowed, zoom);
  const canvasWindow = useMemo(() => {
    const area = viewport.current, pending = pendingFramedScroll.current;
    return windowed && area ? canvasWindowAt(pending?.left ?? area.scrollLeft, pending?.top ?? area.scrollTop, area.clientWidth, area.clientHeight, zoom) : observedWindow;
  }, [observedWindow, windowed, zoom, framedScroll]);
  const index = useMemo(() => indexGraph(graph), [graph]);
  const names = useMemo(() => new Map(graph.nodes.map(node => [node.id, nodeName(node, graph, index)])), [graph, index]);
  const nameOf = (node: GraphNode) => names.get(node.id)!;
  const labelOf = (id: string, node?: GraphNode) => portLabel(id, node, graph, index);
  const selected = effectiveFocus ? index.nodes.get(effectiveFocus.nodeId) : undefined;
  useEffect(() => { if (peek && selected?.id !== peek.nodeId) setPeek(undefined); }, [selected?.id, peek]);
  const ordered = useMemo(() => orderedNodes(graph, index), [graph, index]);
  const navigationOrder = useRef(ordered), previousModels = useRef<ReadonlyMap<string, BlockPresentation>>(undefined);
  const models = useMemo(() => presentBlocks(graph, index, names, host.data.sources, previousModels.current), [graph, index, names, host.data.sources]);
  const layoutKey = useMemo(() => blockLayoutKey(graph, models), [graph, models]);
  useLayoutEffect(() => { navigationOrder.current = ordered; previousModels.current = models; }, [ordered, models]);
  const result = useMemo(() => lower(graph, { targetCapabilities: host.targetCapabilities, index: index.revision, accounting: true }), [graph, index, host.targetCapabilities]);
  const detached = useMemo(() => detachedNodes(graph, index), [graph, index]);
  const dirty = graph !== baseline.current;
  const focus = useCallback((target: CanvasFocus) => {
    if (draftRef.current?.dirty && draftRef.current.nodeId !== target.nodeId) { setPendingSelection(target); return false; }
    if (draftRef.current && draftRef.current.nodeId !== target.nodeId) { setDraft(undefined); draftRef.current = undefined; }
    lastSelection.current = target.nodeId;
    if (selectedNodeId !== target.nodeId) onSelectionChange?.(target.nodeId);
    setState(held => ({ ...held, focus: target }));
    if (target.portId !== undefined) setEntered(target.nodeId);
    restore.current = true;
    return true;
  }, [selectedNodeId, onSelectionChange]);
  const send = useCallback((command: EditCommand, origin?: CanvasFocus) => {
    notification.current.reason = command.type;
    setMessage('');
    restore.current = true;
    setState(held => edit(origin ? { ...held, focus: origin } : held, command));
    if (origin?.portId) setEntered(origin.nodeId);
    if (command.type === 'add' || command.type === 'combine') setPanel(null);
  }, []);
  const cancelDraft = (restoreFocus = true) => {
    const held = draftRef.current, origin = annotationOrigin.current;
    setDraft(undefined); draftRef.current = undefined;
    if (restoreFocus) requestAnimationFrame(() => {
      if (draftRef.current || held && lastSelection.current !== held.nodeId) return;
      if (held?.location === 'inspector') document.querySelector<HTMLInputElement>('.w2-canvas-inspector .w2-canvas-annotation input')?.focus();
      else if (origin?.isConnected) origin.focus();
    });
  };
  const applyDraft = (restoreFocus = true) => {
    const held = draftRef.current;
    if (!held) { cancelDraft(restoreFocus); setMessage('No unsubmitted block details.'); return true; }
    if (!index.nodes.has(held.nodeId)) { cancelDraft(restoreFocus); setMessage('The block no longer exists. Block details were not applied.'); return false; }
    const error = held.error ?? annotationError(held.label, held.note);
    if (error) { setDraft({ ...held, error }); return false; }
    send({ type: 'annotate', nodeId: held.nodeId, label: held.label, note: held.note });
    cancelDraft(restoreFocus);
    return true;
  };
  const annotationEditor = (node: GraphNode, location: AnnotationDraft['location']) => <AnnotationEditor key={`${node.id}:${location}`} node={node} draft={draft?.nodeId === node.id ? draft : undefined}
    change={(label, note) => {
      const current = { nodeId: node.id, label, note, location, error: annotationError(label, note), dirty: label !== (node.annotation?.label ?? '') || note !== (node.annotation?.note ?? '') };
      setDraft(current); draftRef.current = current;
    }} reject={error => {
      const current: AnnotationDraft = { nodeId: node.id, label: draftRef.current?.label ?? node.annotation?.label ?? '', note: draftRef.current?.note ?? node.annotation?.note ?? '', location, dirty: true, error };
      setDraft(current); draftRef.current = current;
    }} apply={applyDraft} cancel={cancelDraft}/>;
  const locate = useCallback((id: string) => { setEntered(undefined); focus({ nodeId: id }); setPanel(null); }, [focus]);
  const elementFor = useCallback((target: CanvasFocus) => refs.current.get(focusKey(target)), []);
  useLayoutEffect(() => {
    if (!restore.current || phone && panel) return;
    restore.current = false;
    const element = state.focus ? elementFor(state.focus) ?? elementFor({ nodeId: state.focus.nodeId }) : addButton.current;
    element?.focus(); element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state, view, entered, panel, connection, deleting, leaving, phone]);
  const positions = graph.nodes.map(node => node.id === moving?.nodeId ? { x: moving.x, y: moving.y } : node.position ?? { x: 24, y: 24 });
  const offsetX = 48 - Math.min(0, ...positions.map(position => position.x)), offsetY = 48 - Math.min(0, ...positions.map(position => position.y));
  const width = Math.max(400, ...positions.map((position, i) => position.x + offsetX + (sizes.get(graph.nodes[i].id)?.width ?? 190) + 48));
  const height = Math.max(300, ...graph.nodes.map((node, i) => positions[i].y + offsetY + (sizes.get(node.id)?.height ?? 140 + (node.inputs.length + node.outputs.length) * 44) + 144));
  const visible = useMemo(() => new Set(ordered.filter(node => {
    const position = node.id === moving?.nodeId ? moving : node.position ?? { x: 24, y: 24 };
    return !windowed || index.roots.has(node.id) || node.id === selected?.id || node.id === entered
      || framed.current === framing && intersectsWindow(canvasWindow, position.x + offsetX, position.y + offsetY, position.x + offsetX + 190, position.y + offsetY + 140 + (node.inputs.length + node.outputs.length) * 44);
  }).map(node => node.id)), [windowed, canvasWindow, ordered, moving, selected?.id, entered, offsetX, offsetY, framing, framedScroll, index]);
  const visibleKey = [...visible].join('\0');
  const wireGeometry = useMemo(() => ({ ports: new Map<string, { x: number; y: number }>(), measured: new Set<string>() }), [layoutKey, moving, view, zoom, phone, host.observations, entered, draft, sizes, offsetX, offsetY]);
  const measuredCards = useMemo(() => new WeakMap<HTMLElement, TidyMeasure>(), [layoutKey, zoom, view]);
  const measuredPortPoints = useMemo(() => new WeakMap<HTMLElement, { x: number; y: number }>(), [layoutKey, zoom, view]);
  const readMeasurements = useCallback((cards: Iterable<HTMLElement> = board.current?.querySelectorAll<HTMLElement>('.w2-canvas-node') ?? [], cache?: WeakMap<HTMLElement, TidyMeasure>, reserveActions = false) => {
    const measured = new Map<string, TidyMeasure>();
    for (const card of cards) {
      const cached = cache?.get(card);
      if (cached) { measured.set(card.dataset.nodeId!, cached); continue; }
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const ports: Record<string, { direction: 'input' | 'output'; y: number }> = {};
      for (const port of card.querySelectorAll<HTMLElement>('[data-port-id]')) {
        const bounds = port.getBoundingClientRect(), direction = port.dataset.direction;
        if (direction === 'input' || direction === 'output') {
          const scale = view === 'graph' ? zoom : 1;
          const point = { x: ((direction === 'output' ? bounds.right : bounds.left) - rect.left) / scale, y: (bounds.top + bounds.height / 2 - rect.top) / scale };
          ports[port.dataset.portId!] = { direction, y: point.y };
          measuredPortPoints.set(port, point);
        }
      }
      // Keep space for selecting any card later, not just the currently selected action row.
      const actionReserve = !reserveActions || card.querySelector('.w2-canvas-node-actions') ? 0
        : window.matchMedia?.('(max-width: 599px), (pointer: coarse)').matches ? 55 : 45;
      const measurement = { width: rect.width / (view === 'graph' ? zoom : 1), height: rect.height / (view === 'graph' ? zoom : 1) + actionReserve, ports };
      measured.set(card.dataset.nodeId!, measurement);
      cache?.set(card, measurement);
    }
    return measured;
  }, [zoom, view, measuredPortPoints]);
  useLayoutEffect(() => {
    if (view !== 'graph') return;
    const measured = readMeasurements(undefined, measuredCards);
    const updateSizes = (changes: ReadonlyMap<string, TidyMeasure>) => {
      setSizes(held => {
        const next = new Map([...held, ...changes]);
        return [...next].every(([id, value]) => {
          const previous = held.get(id);
          return previous?.width === value.width && previous.height === value.height;
        }) && next.size === held.size ? held : next;
      });
    };
    updateSizes(measured);
    const observer = new ResizeObserver(entries => {
      const changed = entries.flatMap(entry => {
        if (!(entry.target instanceof HTMLElement)) return [];
        const previous = measured.get(entry.target.dataset.nodeId!), size = entry.borderBoxSize[0];
        if (previous && size && Math.abs(previous.width - size.inlineSize) < .01 && Math.abs(previous.height - size.blockSize) < .01) return [];
        return [entry.target];
      });
      if (!changed.length) return;
      changed.forEach(card => measuredCards.delete(card));
      const changes = readMeasurements(changed, measuredCards);
      changes.forEach((value, id) => measured.set(id, value));
      updateSizes(changes);
    });
    board.current?.querySelectorAll('.w2-canvas-node').forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [readMeasurements, measuredCards, view, layoutKey, entered, draft, visibleKey, zoom]);
  useLayoutEffect(() => {
    if (view !== 'graph' || graph.nodes.length === 0 || framed.current === framing || !viewport.current?.clientWidth || !viewport.current.clientHeight) return;
    const frame = requestAnimationFrame(() => {
      const area = viewport.current;
      if (!area) return;
      const cards = graph.nodes.map((node, i) => ({
        id: node.id, x: positions[i].x + offsetX, y: positions[i].y + offsetY,
        width: sizes.get(node.id)?.width ?? 190,
        height: sizes.get(node.id)?.height ?? 140 + (node.inputs.length + node.outputs.length) * 44,
      }));
      const x = Math.min(...cards.map(card => card.x)), y = Math.min(...cards.map(card => card.y));
      const bounds = { x, y, width: Math.max(...cards.map(card => card.x + card.width)) - x, height: Math.max(...cards.map(card => card.y + card.height)) - y };
      const result = cards.find(card => card.id === graph.roots[0]?.nodeId);
      const next = frameCanvas(bounds, { width: area.clientWidth, height: area.clientHeight }, result);
      framed.current = framing;
      pendingFramedScroll.current = next;
      setZoom(next.zoom); setFramedScroll(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, framing, graph, sizes, offsetX, offsetY, width, height]);
  useLayoutEffect(() => {
    if (framedScroll) {
      viewport.current?.scrollTo({ ...framedScroll, behavior: 'instant' });
      pendingFramedScroll.current = undefined;
    }
  }, [framedScroll]);
  // Payload-only revisions retain both the block models and measured wire geometry.
  useLayoutEffect(() => {
    if (view !== 'graph' || !board.current) return;
    const measure = () => {
      let bounds: DOMRect | undefined;
      const { ports, measured } = wireGeometry;
      const point = (socket: GraphEdge['from'], direction: 'input' | 'output') => {
        const key = focusKey({ ...socket, direction }), cached = ports.get(key);
        const element = elementFor({ ...socket, direction });
        if (cached && (measured.has(key) || !element)) return cached;
        // Card measurement already read these ports; reuse its normalized coordinates.
        const local = element && measuredPortPoints.get(element), node = index.nodes.get(socket.nodeId)!;
        if (local) {
          const position = node.id === moving?.nodeId ? moving : node.position ?? { x: 24, y: 24 };
          const point = { x: position.x + offsetX + local.x, y: position.y + offsetY + local.y };
          ports.set(key, point); measured.add(key);
          return point;
        }
        if (element && board.current) {
          bounds ??= board.current.getBoundingClientRect();
          const port = element.getBoundingClientRect();
          const point = { x: ((direction === 'output' ? port.right : port.left) - bounds.left) / zoom, y: (port.top + port.height / 2 - bounds.top) / zoom };
          ports.set(key, point);
          measured.add(key);
          return point;
        }
        const model = models.get(node.id)!, position = node.id === moving?.nodeId ? moving : node.position ?? { x: 24, y: 24 };
        const row = model.ports.findIndex(port => port.port.id === socket.portId && port.direction === direction);
        const point = { x: position.x + offsetX + (direction === 'output' ? 190 : 0), y: position.y + offsetY + 48 + (model.detail ? 24 : 0) + (row + .5) * (phone ? 44 : 29) };
        ports.set(key, point);
        return point;
      };
      setWirePaths(graph.edges.flatMap(edge => {
        const from = index.nodes.get(edge.from.nodeId)!, to = index.nodes.get(edge.to.nodeId)!;
        const a = from.id === moving?.nodeId ? moving : from.position ?? { x: 24, y: 24 }, b = to.id === moving?.nodeId ? moving : to.position ?? { x: 24, y: 24 };
        if (windowed && !intersectsWindow(canvasWindow, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x) + 240,
          Math.max(a.y + 140 + (from.inputs.length + from.outputs.length) * 44, b.y + 140 + (to.inputs.length + to.outputs.length) * 44))) return [];
        const start = point(edge.from, 'output'), end = point(edge.to, 'input');
        const bend = Math.max(48, Math.abs(end.x - start.x) / 2), type = index.nodes.get(edge.from.nodeId)?.outputs.find(port => port.id === edge.from.portId)?.type;
        return [{ id: edge.id, from: edge.from, path: `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`, kind: type ? wireKind(type) : 'record' }];
      }));
    };
    measure();
  }, [wireGeometry, windowed, canvasWindow, visibleKey]);
  const close = () => { onClose(); returnFocus?.focus(); };
  const applyProblem = detached.length
    ? `Apply refused: ${detached.map(node => `${nameOf(node)} (block ${index.ordinals.get(node.id)})`).join(', ')} ${detached.length === 1 ? 'is' : 'are'} not connected to an output. Connect or delete these blocks.`
    : !result.ok ? `Apply refused: ${result.errors.length ? result.errors.map(issue => `${issue.nodeId ? `${names.get(issue.nodeId) ?? 'Block'}: ` : ''}${issue.message} ${issue.pointer || 'Output'}`).join('; ') : 'The canvas has no output. Choose a block to use as its output.'}` : '';
  const apply = async () => {
    if (busyRef.current) { setMessage('An Apply or Save is already in progress. Wait for it to finish before applying again.'); return; }
    if (!result.ok || detached.length) { setMessage(applyProblem); setProblemsOpen(true); return; }
    if (draftRef.current?.dirty) { setMessage('Apply or cancel the block details before applying the canvas to the draft.'); return; }
    if (moving) { setMessage('Finish or cancel the block move before applying the canvas to the draft.'); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const transaction = { revision: snapshot.current.revision, label: `Edit ${title}`, replacements: result.replacements, generatedSources: result.generatedSources, generatedLibrary: result.generatedLibrary };
      const written = onApply ? await onApply(transaction, {
        graph, positions: Object.fromEntries(graph.nodes.map(node => [node.id, node.position ?? { x: 24, y: 24 }])),
        annotations: Object.fromEntries(graph.nodes.flatMap(node => node.annotation ? [[node.id, node.annotation]] : [])), sourceMap: result.sourceMap,
      }) : await host.apply(transaction);
      if (written.status === 'conflict') {
        host.compareConflict(snapshot.current, written.remote); setMessage('Conflict: canvas edits are preserved. Compare with the remote revision before trying again.');
      } else if (written.status === 'invalid') setMessage(`Apply refused: ${written.diagnostics.map(issue => `${issue.message} ${issue.pointer}`).join('; ')}`);
      else { snapshot.current = written.snapshot; baseline.current = graph; setMessage('Edits applied to the draft. Not published.'); setLeaving(false); }
    } catch (reason) { setMessage(`Apply failed. Canvas edits are preserved: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async () => {
    if (busyRef.current) { setMessage('An Apply or Save is already in progress. Wait for it to finish before saving again.'); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const written = await host.save(snapshot.current.revision);
      if (written.status === 'conflict') { host.compareConflict(snapshot.current, written.remote); setMessage('Save conflict: local draft retained.'); }
      else if (written.status === 'invalid') setMessage(`Save refused: ${written.diagnostics.map(issue => issue.message).join('; ')}`);
      else { snapshot.current = written.snapshot; setMessage('Draft saved. Not published.'); }
    } catch (reason) { setMessage(`Save failed: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const beginMove = useCallback((node: GraphNode) => {
    setMoving({ nodeId: node.id, x: node.position?.x ?? 0, y: node.position?.y ?? 0 });
    locate(node.id); setMessage('Move: arrows 8 pixels, Shift and arrows 32. Enter commits. Escape cancels.');
  }, [locate]);
  const headerKeys = useCallback((event: KeyboardEvent<HTMLButtonElement>, node: GraphNode) => {
    if (moving?.nodeId === node.id) {
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key], step = event.shiftKey ? 32 : 8; setMoving({ ...moving, x: moving.x + x * step, y: moving.y + y * step }); }
      else if (event.key === 'Enter') { event.preventDefault(); send({ type: 'move', nodeId: node.id, x: moving.x, y: moving.y }); setMoving(undefined); }
      else if (event.key === 'Escape') { event.preventDefault(); setMoving(undefined); setMessage('Move cancelled. Original position restored.'); }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setDeleting(node); }
    else if (event.key === 'Enter') {
      event.preventDefault(); setEntered(node.id); setPanel(null);
      focus(node.inputs[0] ? { nodeId: node.id, portId: node.inputs[0].id, direction: 'input' } : node.outputs[0] ? { nodeId: node.id, portId: node.outputs[0].id, direction: 'output' } : { nodeId: node.id });
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const ordered = navigationOrder.current, index = ordered.findIndex(held => held.id === node.id);
      const neighbor = event.key === 'Home' ? ordered[0] : event.key === 'End' ? ordered.at(-1) : ordered[(index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + ordered.length) % ordered.length];
      if (neighbor) { setEntered(undefined); focus({ nodeId: neighbor.id }); }
    }
  }, [moving, focus, send]);
  const nodeKeys = useCallback((event: KeyboardEvent<HTMLLIElement>, node: GraphNode) => {
    if (editable(event.target)) return;
    if (event.target !== elementFor({ nodeId: node.id }) && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')], current = controls.indexOf(document.activeElement as HTMLButtonElement);
      controls[(current + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
    if (event.key === 'Escape') { event.preventDefault(); if (moving) return; setEntered(undefined); focus({ nodeId: node.id }); }
    if (event.key === 'Tab') {
      event.preventDefault(); setEntered(undefined);
      (event.shiftKey ? addButton.current : navigation.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    }
  }, [elementFor, moving, focus]);
  const actions = useMemo<BlockActions>(() => ({
    register: target => element => { if (element) refs.current.set(focusKey(target), element); else refs.current.delete(focusKey(target)); },
    remember: target => {
      if (draftRef.current?.dirty && draftRef.current.nodeId !== target.nodeId) { setPendingSelection(target); return; }
      if (draftRef.current && draftRef.current.nodeId !== target.nodeId) { setDraft(undefined); draftRef.current = undefined; }
      lastSelection.current = target.nodeId;
      if (selectedNodeId !== target.nodeId) onSelectionChange?.(target.nodeId);
      setState(held => held.focus?.nodeId === target.nodeId && held.focus?.portId === target.portId && held.focus?.direction === target.direction ? held : { ...held, focus: target });
    },
    reveal: node => locate(node.id),
    select: node => { if (focus({ nodeId: node.id })) setEntered(node.id); },
    peek: (node, keyboard) => {
      if (!focus({ nodeId: node.id })) return;
      setEntered(node.id); if (phone) setPanel(null);
      setPeek({ nodeId: node.id, keyboard });
    },
    annotate: node => {
      if (!focus({ nodeId: node.id })) return;
      setEntered(node.id);
      setPeek(undefined); setPanel(null);
      // Re-activating Rename keeps an unsubmitted draft for the same block instead of discarding it.
      if (draftRef.current?.nodeId === node.id && draftRef.current.location === 'inline') {
        requestAnimationFrame(() => {
          if (draftRef.current?.nodeId === node.id) elementFor({ nodeId: node.id })?.closest('li')?.querySelector<HTMLInputElement>('.w2-canvas-annotation input')?.focus();
        });
        return;
      }
      annotationOrigin.current = document.activeElement as HTMLElement;
      const current: AnnotationDraft = { nodeId: node.id, label: node.annotation?.label ?? '', note: node.annotation?.note ?? '', location: 'inline' };
      setDraft(current); draftRef.current = current;
      requestAnimationFrame(() => {
        if (draftRef.current === current) elementFor({ nodeId: node.id })?.closest('li')?.querySelector<HTMLInputElement>('.w2-canvas-annotation input')?.focus();
      });
    },
    headerKeys, nodeKeys, move: beginMove,
    connect: request => { connectionReturn.current = { ...request.socket, direction: request.direction }; setConnection(request); },
    disconnect: edgeId => send({ type: 'disconnect', edgeId }),
    inspect: () => { if (phone) setPeek(undefined); setPanel('inspector'); }, remove: setDeleting,
  }), [focus, headerKeys, nodeKeys, beginMove, send, locate, selectedNodeId, onSelectionChange, phone, elementFor]);
  const add = (entry: BlockCatalogEntry) => {
    const seed = blockSeed(entry, host.data.sources[0]?.id), scopeId = selected?.scopeId ?? graph.scopes[0]?.id;
    if (seed && scopeId) send({ type: 'add', seed, scopeId });
  };
  const restoreConnection = () => { setConnection(undefined); if (connectionReturn.current) focus(connectionReturn.current); };
  const locatePointer = (pointer: string) => {
    const node = graph.nodes.filter(node => node.origins.some(origin => pointer === origin || pointer.startsWith(`${origin}/`))).sort((a, b) => (b.origins[0]?.length ?? 0) - (a.origins[0]?.length ?? 0))[0];
    if (node) locate(node.id);
  };
  const fit = (selection: boolean) => {
    if (selection && selected) { setZoom(1); requestAnimationFrame(() => elementFor({ nodeId: selected.id })?.scrollIntoView({ block: 'center', inline: 'center' })); }
    else { setZoom(Math.min(1, (viewport.current?.clientWidth || width) / width, (viewport.current?.clientHeight || height) / height)); viewport.current?.scrollTo(0, 0); }
  };
  const problemCount = (result.ok ? 0 : Math.max(1, result.errors.length)) + detached.length;
  const closePanel = () => { setPanel(null); if (panel === 'palette') addButton.current?.focus(); else if (selected) focus({ nodeId: selected.id }); };
  const palette = <Palette graph={graph} index={index} locate={locate} scope={graph.scopes.find(scope => scope.id === selected?.scopeId)?.kind ?? graph.scopes[0].kind} capabilities={host.targetCapabilities} sourceId={host.data.sources[0]?.id} onAdd={add} close={closePanel}/>;
  const inspector = selected && <Inspector key={`${selected.id}:${state.past.length}`} graph={graph} index={index} node={selected} host={host} send={send} locate={locate} close={closePanel} move={() => beginMove(selected)} remove={() => { setPanel(null); setDeleting(selected); }} budgets={result.budgets} onLocate={locatePointer} outputNames={outputNames} annotationEditor={annotationEditor(selected, 'inspector')}/>;
  return <div className="w2-canvas" style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties} data-panel={panel ?? 'none'} data-dark={theme.dark || undefined}
    onKeyDown={event => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); send({ type: event.shiftKey ? 'redo' : 'undo' }); }
    }}>
    <header className="w2-canvas-header"><div><small>Flows <ChevronRight size={12} aria-hidden/> Canvas</small><h1>{title}</h1></div>
      <span className="w2-canvas-caption">Configuration only · No device actions</span>
      <button type="button" aria-label="Close canvas" onClick={() => draftRef.current?.dirty ? setPendingClose(true) : dirty ? setLeaving(true) : close()}><X size={18}/></button></header>
    <nav className="w2-canvas-toolbar" aria-label="Canvas controls">
      <div className="w2-canvas-segment"><button type="button" aria-label="Graph" aria-pressed={view === 'graph'} onClick={() => { setView('graph'); restore.current = true; }}><GitBranch size={16}/><span className="w2-canvas-toolbar-label">Graph</span></button>
        <button type="button" aria-label="Outline" aria-pressed={view === 'outline'} onClick={() => { setView('outline'); restore.current = true; }}><List size={16}/><span className="w2-canvas-toolbar-label">Outline</span></button></div>
      <button type="button" ref={addButton} aria-label="Add Block" aria-expanded={panel === 'palette'} onClick={() => setPanel(panel === 'palette' ? null : 'palette')}><Plus size={16}/><span className="w2-canvas-toolbar-label">Add Block</span></button>
      <button type="button" aria-label="Inspector" aria-expanded={panel === 'inspector'} onClick={() => { if (phone) setPeek(undefined); setPanel(panel === 'inspector' ? null : 'inspector'); }}><SlidersHorizontal size={16}/><span className="w2-canvas-toolbar-label">Inspector</span></button>
      <div className="w2-canvas-more">
        <button type="button" ref={moreButton} aria-label="More canvas controls" aria-expanded={more} onClick={() => setMore(!more)}><Ellipsis size={18}/></button>
        {more && <div className="w2-canvas-overflow" aria-label="More canvas controls" onKeyDown={event => { if (event.key === 'Escape') { setMore(false); moreButton.current?.focus(); } }}>
          <button type="button" disabled={!state.past.length} onClick={() => send({ type: 'undo' })}><Undo2 size={16}/> Undo canvas edit</button>
          <button type="button" disabled={!state.future.length} onClick={() => send({ type: 'redo' })}><Redo2 size={16}/> Redo canvas edit</button>
          <button type="button" onClick={() => { fit(false); setMore(false); moreButton.current?.focus(); }}><Maximize size={14}/> Fit all</button>
          <button type="button" onClick={() => { fit(true); setMore(false); }}>Fit selection</button>
          {[[ArrowLeft, 'left', -160, 0], [ArrowRight, 'right', 160, 0], [ArrowUp, 'up', 0, -160], [ArrowDown, 'down', 0, 160]].map(([Icon, name, x, y]) => {
            const Glyph = Icon as typeof ArrowLeft;
            return <button key={String(name)} type="button" aria-label={`Pan ${name}`} onClick={() => viewport.current?.scrollBy(Number(x), Number(y))}><Glyph size={14}/> Pan {String(name)}</button>;
          })}
          <button type="button" onClick={() => { setMore(false); setHelp(true); }}><CircleHelp size={16}/> Keyboard help</button>
        </div>}
      </div>
    </nav>
    <div className="w2-canvas-work">
      {!phone && panel === 'palette' && palette}
      <main ref={main} className="w2-canvas-main" aria-label="Flow canvas">
        <p id="w2-canvas-key-help" className="w2-canvas-sr">Arrows select blocks or traverse their controls. Home and End reach the first and last blocks. Every block header remains in reading order; select an off-screen header to reveal its ports, or use Outline for all blocks and connections. Enter enters ports and actions. Escape returns to the header. Tab leaves the graph. Use Move for 8 px steps, Shift for 32 px. Delete removes a block. Control or Command Z undoes an edit.</p>
        <div className="w2-canvas-viewport" ref={viewport}>
          <div className="w2-canvas-scaled" style={view === 'graph' ? { width: width * zoom, height: height * zoom } : undefined}>
            <ul ref={board} className={`w2-canvas-nodes w2-canvas-${view}`} aria-label={view === 'graph' ? 'Flow graph blocks' : 'Flow outline blocks'} aria-describedby="w2-canvas-key-help"
              style={view === 'graph' ? { width, height, transform: `scale(${zoom})` } : undefined}>
              {view === 'graph' && <CanvasWires paths={wirePaths} width={width} height={height} observations={host.observations}/>}
              {ordered.map((node, positionInSet) => {
                const position = node.id === moving?.nodeId ? moving : node.position;
                const active = selected?.id === node.id;
                return <CanvasBlock key={node.id} model={models.get(node.id)!} observation={host.observations?.[node.id]}
                  visible={visible.has(node.id)} position={positionInSet + 1} count={ordered.length}
                  annotationEditor={draft?.nodeId === node.id && panel !== 'inspector' ? annotationEditor(node, 'inline') : undefined}
                  active={active} controls={entered === node.id} tabStop={active || !selected && ordered[0] === node} positioned={view === 'graph'} x={(position?.x ?? 24) + offsetX} y={(position?.y ?? 24) + offsetY} actions={actions}/>;
              })}
            </ul>
          </div>
          {peek && selected?.id === peek.nodeId && <DataPeek key={peek.nodeId} model={models.get(peek.nodeId)!} observation={host.observations?.[peek.nodeId]} theme={theme} phone={phone}
            anchor={elementFor({ nodeId: peek.nodeId }) ?? null} boundary={main} keyboard={peek.keyboard} close={() => setPeek(undefined)}/>}
          {view === 'outline' && <section className="w2-canvas-connections" aria-label="Connections"><h2>Connections</h2><ul aria-label="Wires">{graph.edges.map(edge => {
            const from = index.nodes.get(edge.from.nodeId)!, to = index.nodes.get(edge.to.nodeId)!, type = from.outputs.find(port => port.id === edge.from.portId)?.type.valueType;
            const observation = host.observations?.[from.id]?.outputs?.[edge.from.portId];
            return <li key={edge.id}><button type="button" aria-label={`${nameOf(from)} Result, ${type}, to ${nameOf(to)} ${labelOf(edge.to.portId, to)}${describeObservation(observation, true, from.catalogKey === 'output.rows')}; disconnect`} onClick={() => send({ type: 'disconnect', edgeId: edge.id }, { ...edge.to, direction: 'input' })}>{nameOf(from)} → {nameOf(to)} {labelOf(edge.to.portId, to)}{observation?.state === 'cant-tell' && <small>Can't tell</small>} <small>Disconnect</small></button>
              <button type="button" onClick={() => locate(from.id)}>Go to source</button><button type="button" onClick={() => locate(to.id)}>Go to destination</button></li>;
          })}</ul></section>}
        </div>
        <div className="w2-canvas-navigation" ref={navigation} aria-label="Graph navigation">
          <button type="button" aria-label="Zoom out" disabled={zoom <= .25} onClick={() => setZoom(Math.max(.25, zoom - .25))}><Minus size={16}/></button><output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .25))}><Plus size={16}/></button>
          <button type="button" aria-label="Tidy Up" onClick={event => {
            const measured = view === 'graph' ? readMeasurements(undefined, undefined, true) : new Map<string, TidyMeasure>(), measure = (id: string) => measured.get(id);
            const before = countCrossings(graph, measure), next = tidyCanvas(graph, measure), after = countCrossings(next, measure);
            const remainingOverlaps = countOverlaps(next, measure);
            if (next !== graph) send({ type: 'layout', graph: next });
            restore.current = false;
            setFraming(value => value + 1);
            setMessage(next === graph ? remainingOverlaps ? 'Overlapping blocks remain: could not separate them without increasing wire crossings.' : 'Already tidy'
              : `Tidied: wire crossings ${before} → ${after}`);
            event.currentTarget.focus();
          }}><WandSparkles size={14}/><span className="w2-canvas-toolbar-label">Tidy Up</span></button>
          <button type="button" className="w2-canvas-problems-pill" ref={problemsButton} onClick={() => setProblemsOpen(true)}>{problemCount ? <AlertTriangle size={14}/> : <CircleCheck size={14}/>} {problemCount ? `${problemCount} Problems` : 'No Problems'}</button>
        </div>
      </main>
      {!phone && panel === 'inspector' && inspector}
    </div>
    <footer className="w2-canvas-footer" data-message={Boolean(message || state.message || applyProblem) || undefined}><div role="status" aria-live="polite" aria-atomic="true">{message || state.message || applyProblem || <><Check size={14} aria-hidden/> Compiler accepted</>}</div>
      <button type="button" disabled={busy || dirty} onClick={save}>Save draft</button><button type="button" className="w2-canvas-primary" aria-disabled={busy || !result.ok || !!detached.length} onClick={apply}>Apply to draft</button></footer>
    {phone && panel && <Modal title={panel === 'palette' ? 'Blocks' : 'Block inspector'} sheet theme={theme} close={closePanel}>{panel === 'palette' ? palette : inspector}</Modal>}
    {help && <Modal title="Keyboard help" theme={theme} close={() => { setHelp(false); moreButton.current?.focus(); }}><p>Arrows select blocks or traverse their controls. Enter enters ports and actions. Escape returns to the header. Tab leaves the graph.</p><p>Move: arrows 8 pixels, Shift and arrows 32. Enter commits. Escape cancels. Position also accepts numeric coordinates in the inspector.</p><p>Delete removes a block after confirmation. Control or Command Z undoes; add Shift to redo. All editing is available in Outline.</p></Modal>}
    {problemsOpen && <Modal title="Canvas problems" theme={theme} close={() => { setProblemsOpen(false); problemsButton.current?.focus(); }}>
      {!problemCount && <p>No Problems. Compiler accepted the current connections.</p>}
      {!result.ok && <ul>{result.errors.map((error, i) => <li key={i}><button type="button" onClick={() => { setProblemsOpen(false); if (error.nodeId) locate(error.nodeId); else locatePointer(error.pointer); }}>{error.nodeId && names.get(error.nodeId)} {error.message} {error.pointer || 'Output'}</button></li>)}</ul>}
      {!result.ok && !result.errors.length && <p>{applyProblem}</p>}
      {!!detached.length && <p>{applyProblem}</p>}
      {result.ok && result.diagnostics.filter(issue => issue.hint).map((issue, i) => <p key={i}>Wiring hint: {issue.message}</p>)}
    </Modal>}
    {connection && <Modal title={`Connect ${nameOf(index.nodes.get(connection.socket.nodeId)!)}.${portLabel(connection.socket.portId)}`} theme={theme} close={restoreConnection}>
      <ConnectionDialog graph={graph} request={connection} announce={setMessage} onConnect={(from, to, replace) => { send({ type: 'connect', from, to, replace }); setConnection(undefined); }}/>
    </Modal>}
    {deleting && <Modal title="Delete block" theme={theme} close={() => { setDeleting(undefined); locate(deleting.id); }}><p>Delete {nameOf(deleting)} and {(index.incoming.get(deleting.id)?.length ?? 0) + (index.outgoing.get(deleting.id)?.length ?? 0)} connected wires? Required inputs will need reconnecting. Undo restores this edit.</p>
      <button type="button" onClick={() => { send({ type: 'delete', nodeId: deleting.id }); setDeleting(undefined); }}>Confirm delete</button></Modal>}
    {leaving && <Modal title="Unsaved canvas edits" theme={theme} close={() => { setLeaving(false); if (selected) locate(selected.id); }}><p>Keep this canvas open, apply valid edits to the draft, or discard canvas edits. Apply is not Publish.</p>
      <button type="button" onClick={() => { setLeaving(false); if (selected) locate(selected.id); }}>Stay</button><button type="button" aria-disabled={!result.ok || !!detached.length || busy} onClick={apply}>Apply valid edits</button><button type="button" onClick={close}>Discard canvas edits</button>
      {message && <p role="status">{message}</p>}</Modal>}
    {(pendingSelection || pendingClose) && <Modal title="Unsubmitted block details" theme={theme} close={() => {
      setPendingSelection(undefined); setPendingClose(false); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.w2-canvas-annotation input')?.focus());
    }}>
      <p>Apply or discard the block details before {pendingClose ? 'closing the canvas' : 'changing selection'}.</p>
      <button type="button" onClick={() => { if (applyDraft(false)) {
        const target = pendingSelection; setPendingSelection(undefined); setPendingClose(false);
        if (target) focus(target); else setLeaving(true);
      } }}>Apply</button>
      <button type="button" onClick={() => {
        cancelDraft(false); const target = pendingSelection; setPendingSelection(undefined); setPendingClose(false);
        if (target) focus(target); else if (dirty) setLeaving(true); else close();
      }}>Discard</button>
      <button type="button" onClick={() => { setPendingSelection(undefined); setPendingClose(false); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.w2-canvas-annotation input')?.focus()); }}>Stay</button>
      {draft?.error && <p role="alert">{draft.error}</p>}
    </Modal>}
  </div>;
}

export { LimitsMeter, Modal as CanvasDialog };
export type { GraphBudget };
