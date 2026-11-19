import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleCheck, CircleHelp, ChevronRight, Ellipsis, GitBranch, List, Maximize, Minus, Move, Plus, Redo2, SlidersHorizontal, Trash2, Undo2, WandSparkles, X } from 'lucide-react';
import { autoLayout, lower, type BlockCatalogEntry, type GraphBudget, type GraphEdge, type GraphNode, type GraphPort, type LogicGraph } from '../../shared/composition/graph';
import type { DerivedTheme } from '../theme';
import { blockSeed, nodeDetail, nodeName, portLabel } from './blocks';
import { detachedNodes, edit, initialEditState, orderedNodes, type CanvasFocus, type EditCommand } from './edit';
import Palette from './Palette';
import Inspector from './Inspector';
import ConnectionDialog, { type ConnectionRequest } from './ConnectionDialog';
import LimitsMeter from './LimitsMeter';
import { canvasTheme, wireKind } from './theme';
import './canvas.css';
import BlockIcon from './BlockIcon';
import PortReading, { describeObservation, type CanvasHostWithObservations } from './observations';

const focusKey = (focus: CanvasFocus) => JSON.stringify(focus);
const editable = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable=true]'));
export function arrangeCanvas(graph: LogicGraph): LogicGraph {
  const arranged = autoLayout(graph, true), columns = new Map<number, number>(), positions = new Map<string, { x: number; y: number }>();
  for (const node of orderedNodes(arranged)) {
    const x = node.position?.x ?? 0, y = columns.get(x) ?? 24;
    columns.set(x, y + 100 + (node.inputs.length + node.outputs.length) * 44);
    positions.set(node.id, { x: x + 24, y });
  }
  return { ...arranged, nodes: arranged.nodes.map(node => ({ ...node, position: positions.get(node.id) })) };
}
function Modal({ title, children, close, theme, sheet = false }: { title: string; children: ReactNode; close: () => void; theme: DerivedTheme; sheet?: boolean }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Backdrop className="w2-canvas-backdrop"/><Dialog.Viewport className="w2-canvas-dialog-viewport" data-sheet={sheet || undefined}>
      <Dialog.Popup className="w2-canvas-dialog" data-sheet={sheet || undefined} style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties} finalFocus={false}>
        <div className="w2-canvas-panel-head"><Dialog.Title>{title}</Dialog.Title><button type="button" aria-label={`Close ${title}`} onClick={close}><X size={18}/></button></div>
        <div className="w2-canvas-dialog-body">{children}</div>
      </Dialog.Popup>
    </Dialog.Viewport></Dialog.Portal>
  </Dialog.Root>;
}
export interface FlowCanvasProps {
  readonly host: CanvasHostWithObservations;
  readonly graph: LogicGraph;
  readonly title: string;
  readonly theme: DerivedTheme;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
  readonly outputNames?: readonly string[];
}
export default function FlowCanvas({ host, graph: initialGraph, title, theme, onClose, returnFocus, outputNames }: FlowCanvasProps) {
  const [state, setState] = useState(() => initialEditState(initialGraph));
  const [view, setView] = useState<'graph' | 'outline'>('graph'), [panel, setPanel] = useState<'palette' | 'inspector' | null>('palette');
  const [entered, setEntered] = useState<string>(), [connection, setConnection] = useState<ConnectionRequest>();
  const [deleting, setDeleting] = useState<GraphNode>(), [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false), [help, setHelp] = useState(false), [problemsOpen, setProblemsOpen] = useState(false);
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 599px)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 599px)');
    if (!query) return;
    const update = () => setPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [zoom, setZoom] = useState(1), [moving, setMoving] = useState<{ nodeId: string; x: number; y: number }>();
  const [wirePaths, setWirePaths] = useState<readonly { id: string; path: string; kind: string; from: GraphEdge['from'] }[]>([]);
  const [initialSnapshot] = useState(() => host.snapshot());
  const snapshot = useRef(initialSnapshot), baseline = useRef(initialGraph), refs = useRef(new Map<string, HTMLButtonElement>());
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLUListElement>(null), addButton = useRef<HTMLButtonElement>(null), navigation = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null), problemsButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false), connectionReturn = useRef<CanvasFocus | null>(null);
  const graph = state.graph, selected = graph.nodes.find(node => node.id === state.focus?.nodeId);
  const ordered = useMemo(() => orderedNodes(graph), [graph]);
  const result = useMemo(() => lower(graph, { targetCapabilities: host.targetCapabilities }), [graph, host.targetCapabilities]);
  const detached = useMemo(() => detachedNodes(graph), [graph]);
  const dirty = graph !== baseline.current;
  const focus = (target: CanvasFocus) => {
    setState(held => ({ ...held, focus: target }));
    if (target.portId !== undefined) setEntered(target.nodeId);
    restore.current = true;
  };
  const send = (command: EditCommand) => {
    setMessage('');
    restore.current = true;
    setState(held => edit(held, command));
    if (command.type === 'add' || command.type === 'combine') setPanel(null);
  };
  const locate = (id: string) => { setEntered(undefined); focus({ nodeId: id }); setPanel(null); };
  const elementFor = (target: CanvasFocus) => refs.current.get(focusKey(target));
  useLayoutEffect(() => {
    if (!restore.current || phone && panel) return;
    restore.current = false;
    const element = state.focus ? elementFor(state.focus) ?? elementFor({ nodeId: state.focus.nodeId }) : addButton.current;
    element?.focus(); element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state, view, entered, panel, connection, deleting, leaving, phone]);
  const positions = graph.nodes.map(node => node.id === moving?.nodeId ? { x: moving.x, y: moving.y } : node.position ?? { x: 24, y: 24 });
  const width = Math.max(900, ...positions.map(position => position.x + 300)), height = Math.max(600, ...graph.nodes.map((node, index) => positions[index].y + 140 + (node.inputs.length + node.outputs.length) * 44));
  useLayoutEffect(() => {
    if (view !== 'graph' || !board.current) return;
    const measure = () => {
      const bounds = board.current?.getBoundingClientRect();
      if (!bounds) return;
      setWirePaths(graph.edges.flatMap(edge => {
        const from = elementFor({ ...edge.from, direction: 'output' })?.getBoundingClientRect(), to = elementFor({ ...edge.to, direction: 'input' })?.getBoundingClientRect();
        if (!from || !to) return [];
        const start = { x: (from.right - bounds.left) / zoom, y: (from.top + from.height / 2 - bounds.top) / zoom };
        const end = { x: (to.left - bounds.left) / zoom, y: (to.top + to.height / 2 - bounds.top) / zoom };
        const bend = Math.max(48, Math.abs(end.x - start.x) / 2), type = graph.nodes.find(node => node.id === edge.from.nodeId)?.outputs.find(port => port.id === edge.from.portId)?.type;
        return [{ id: edge.id, from: edge.from, path: `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`, kind: type ? wireKind(type) : 'record' }];
      }));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(board.current);
    return () => observer.disconnect();
  }, [graph, entered, moving, view, zoom]);
  const close = () => { onClose(); returnFocus?.focus(); };
  const apply = async () => {
    if (!result.ok || detached.length || busy) return;
    setBusy(true);
    try {
      const written = await host.apply({ revision: snapshot.current.revision, label: `Edit ${title}`, replacements: result.replacements, generatedSources: result.generatedSources, generatedLibrary: result.generatedLibrary });
      if (written.status === 'conflict') {
        host.compareConflict(snapshot.current, written.remote); setMessage('Conflict: canvas edits are preserved. Compare with the remote revision before trying again.');
      } else if (written.status === 'invalid') setMessage(`Apply refused: ${written.diagnostics.map(issue => `${issue.message} ${issue.pointer}`).join('; ')}`);
      else { snapshot.current = written.snapshot; baseline.current = graph; setMessage('Edits applied to the draft. Not published.'); setLeaving(false); }
    } catch (reason) { setMessage(`Apply failed. Canvas edits are preserved: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const written = await host.save(snapshot.current.revision);
      if (written.status === 'conflict') { host.compareConflict(snapshot.current, written.remote); setMessage('Save conflict: local draft retained.'); }
      else if (written.status === 'invalid') setMessage(`Save refused: ${written.diagnostics.map(issue => issue.message).join('; ')}`);
      else { snapshot.current = written.snapshot; setMessage('Draft saved. Not published.'); }
    } catch (reason) { setMessage(`Save failed: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };
  const beginMove = (node: GraphNode) => {
    setMoving({ nodeId: node.id, x: node.position?.x ?? 0, y: node.position?.y ?? 0 });
    locate(node.id); setMessage('Move: arrows 8 pixels, Shift and arrows 32. Enter commits. Escape cancels.');
  };
  const headerKeys = (event: KeyboardEvent<HTMLButtonElement>, node: GraphNode) => {
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
      const index = ordered.findIndex(held => held.id === node.id);
      const neighbor = event.key === 'Home' ? ordered[0] : event.key === 'End' ? ordered.at(-1) : ordered[(index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + ordered.length) % ordered.length];
      if (neighbor) { setEntered(undefined); focus({ nodeId: neighbor.id }); }
    }
  };
  const ref = (target: CanvasFocus) => (element: HTMLButtonElement | null) => { if (element) refs.current.set(focusKey(target), element); else refs.current.delete(focusKey(target)); };
  const port = (node: GraphNode, port: GraphPort, direction: 'input' | 'output') => {
    const edges = graph.edges.filter(edge => direction === 'input' ? edge.to.nodeId === node.id && edge.to.portId === port.id : edge.from.nodeId === node.id && edge.from.portId === port.id);
    const links = edges.map(edge => {
      const endpoint = direction === 'input' ? edge.from : edge.to, other = graph.nodes.find(node => node.id === endpoint.nodeId);
      return `${other ? nodeName(other, graph) : 'missing block'} ${direction === 'input' ? 'output' : portLabel(endpoint.portId, other, graph) + ' input'}`;
    }).join(', ');
    const type = port.type.valueType === 'unresolved' ? 'Unresolved type' : port.type.valueType;
    const label = portLabel(port.id, node, graph), observation = host.observations?.[node.id]?.[direction === 'input' ? 'inputs' : 'outputs']?.[port.id];
    const source = direction === 'input' ? graph.nodes.find(held => held.id === edges[0]?.from.nodeId)?.outputs.find(held => held.id === edges[0]?.from.portId) : undefined;
    const socketType = port.type.valueType === 'unresolved' && source ? source.type : port.type;
    return <button key={`${direction}:${port.id}`} type="button" ref={ref({ nodeId: node.id, portId: port.id, direction })} tabIndex={entered === node.id ? 0 : -1}
      className="w2-canvas-port" data-direction={direction} data-wire-type={wireKind(socketType)} data-observation-state={observation?.state} title={`${label} · ${type}${describeObservation(observation, direction === 'output')}`}
      aria-label={`${nodeName(node, graph)}, ${label} ${direction}, ${type}, ${port.type.representation}${port.type.nullable ? ', nullable' : ''}, ${links ? `connected to ${links}` : direction === 'input' && port.required ? 'required, unconnected' : 'unconnected'}${describeObservation(observation, direction === 'output')}`}
      onClick={() => { connectionReturn.current = { nodeId: node.id, portId: port.id, direction }; setConnection({ socket: { nodeId: node.id, portId: port.id }, direction }); }}
      onKeyDown={event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && edges.length === 1) { event.preventDefault(); send({ type: 'disconnect', edgeId: edges[0].id }); }
      }}>
      <span className="w2-canvas-port-glyph" aria-hidden/><span>{label}</span><PortReading observation={observation} output={direction === 'output'}/>
      {direction === 'input' && port.required && !edges.length && <span className="w2-canvas-error" aria-hidden>!</span>}
    </button>;
  };
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
    else { setZoom(Math.max(.25, Math.min(1, (viewport.current?.clientWidth ?? width) / width))); viewport.current?.scrollTo(0, 0); }
  };
  const problemCount = (result.ok ? 0 : result.errors.length) + detached.length;
  const closePanel = () => { setPanel(null); if (panel === 'palette') addButton.current?.focus(); else if (selected) focus({ nodeId: selected.id }); };
  const palette = <Palette graph={graph} locate={locate} scope={graph.scopes.find(scope => scope.id === selected?.scopeId)?.kind ?? graph.scopes[0].kind} capabilities={host.targetCapabilities} sourceId={host.data.sources[0]?.id} onAdd={add} close={closePanel}/>;
  const inspector = selected && <Inspector key={`${selected.id}:${state.past.length}`} graph={graph} node={selected} host={host} send={send} locate={locate} close={closePanel} move={() => beginMove(selected)} remove={() => { setPanel(null); setDeleting(selected); }} budgets={result.budgets} onLocate={locatePointer} outputNames={outputNames}/>;
  return <div className="w2-canvas" style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties} data-panel={panel ?? 'none'} data-dark={theme.dark || undefined}
    onKeyDown={event => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); send({ type: event.shiftKey ? 'redo' : 'undo' }); }
    }}>
    <header className="w2-canvas-header"><div><small>Flows <ChevronRight size={12} aria-hidden/> Canvas</small><h1>{title}</h1></div>
      <span className="w2-canvas-caption">Configuration only · No device actions</span>
      <button type="button" aria-label="Close canvas" onClick={() => dirty ? setLeaving(true) : close()}><X size={18}/></button></header>
    <nav className="w2-canvas-toolbar" aria-label="Canvas controls">
      <div className="w2-canvas-segment"><button type="button" aria-label="Graph" aria-pressed={view === 'graph'} onClick={() => { setView('graph'); restore.current = true; }}><GitBranch size={16}/><span className="w2-canvas-toolbar-label">Graph</span></button>
        <button type="button" aria-label="Outline" aria-pressed={view === 'outline'} onClick={() => { setView('outline'); restore.current = true; }}><List size={16}/><span className="w2-canvas-toolbar-label">Outline</span></button></div>
      <button type="button" ref={addButton} aria-label="Add Block" aria-expanded={panel === 'palette'} onClick={() => setPanel(panel === 'palette' ? null : 'palette')}><Plus size={16}/><span className="w2-canvas-toolbar-label">Add Block</span></button>
      <button type="button" aria-label="Inspector" aria-expanded={panel === 'inspector'} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}><SlidersHorizontal size={16}/><span className="w2-canvas-toolbar-label">Inspector</span></button>
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
      <main className="w2-canvas-main" aria-label="Flow canvas">
        <p id="w2-canvas-key-help" className="w2-canvas-sr">Arrows select blocks or traverse their controls. Enter enters ports and actions. Escape returns to the header. Tab leaves the graph. Use Move for 8 px steps, Shift for 32 px. Delete removes a block. Control or Command Z undoes an edit.</p>
        <div className="w2-canvas-viewport" ref={viewport}>
          <div className="w2-canvas-scaled" style={view === 'graph' ? { width: width * zoom, height: height * zoom } : undefined}>
            <ul ref={board} className={`w2-canvas-nodes w2-canvas-${view}`} aria-label={view === 'graph' ? 'Flow graph blocks' : 'Flow outline blocks'} aria-describedby="w2-canvas-key-help"
              style={view === 'graph' ? { width, height, transform: `scale(${zoom})` } : undefined}>
              {view === 'graph' && <li className="w2-canvas-wires" aria-hidden><svg width={width} height={height}>{wirePaths.map(wire => <path key={wire.id} data-observation-state={host.observations?.[wire.from.nodeId]?.outputs?.[wire.from.portId]?.state} d={wire.path} className={`w2-canvas-wire w2-canvas-wire-${wire.kind}`}/>)}</svg></li>}
              {ordered.map(node => {
                const position = node.id === moving?.nodeId ? moving : node.position;
                const controls = entered === node.id, active = selected?.id === node.id;
                return <li key={node.id} className="w2-canvas-node" data-selected={active || undefined} data-node-id={node.id} data-scenario-pinned={host.observations?.[node.id]?.scenarioPinned || undefined} style={view === 'graph' ? { left: position?.x ?? 24, top: position?.y ?? 24 } : undefined}
                  onKeyDown={event => {
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
                  }}>
                  <button type="button" ref={ref({ nodeId: node.id })} className="w2-canvas-node-head" aria-label={`Select ${nodeName(node, graph)} ${graph.nodes.indexOf(node) + 1}`} aria-description={host.observations?.[node.id]?.scenarioPinned ? 'Pinned by scenario.' : undefined} aria-pressed={active}
                    tabIndex={active || !selected && ordered[0] === node ? 0 : -1} onFocus={() => setState(held => ({ ...held, focus: { nodeId: node.id } }))}
                    onClick={() => { focus({ nodeId: node.id }); setEntered(node.id); setPanel('inspector'); }} onKeyDown={event => headerKeys(event, node)}>
                    <span className="w2-canvas-block-icon" data-wire-type={wireKind(node.outputs[0].type)}><BlockIcon catalogKey={node.catalogKey}/></span><strong>{nodeName(node, graph)}</strong>{graph.roots.some(root => root.nodeId === node.id) && <small>Output</small>}
                  </button>
                  {nodeDetail(node, host.data.sources, graph) && <div className="w2-canvas-node-detail">{nodeDetail(node, host.data.sources, graph)}</div>}
                  {node.inputs.map(input => port(node, input, 'input'))}
                  {node.outputs.map(output => port(node, output, 'output'))}
                  {controls && <div className="w2-canvas-node-actions">
                    <button type="button" aria-label={`Move ${nodeName(node, graph)}`} onClick={() => beginMove(node)}><Move size={14}/> Move</button>
                    <button type="button" aria-label={`Inspect ${nodeName(node, graph)}`} onClick={() => setPanel('inspector')}>Inspect</button>
                    <button type="button" aria-label={`Delete ${nodeName(node, graph)}`} onClick={() => setDeleting(node)}><Trash2 size={14}/></button>
                  </div>}
                </li>;
              })}
            </ul>
          </div>
          {view === 'outline' && <section className="w2-canvas-connections" aria-label="Connections"><h2>Connections</h2><ul aria-label="Wires">{graph.edges.map(edge => {
            const from = graph.nodes.find(node => node.id === edge.from.nodeId)!, to = graph.nodes.find(node => node.id === edge.to.nodeId)!, type = from.outputs.find(port => port.id === edge.from.portId)?.type.valueType;
            const observation = host.observations?.[from.id]?.outputs?.[edge.from.portId];
            return <li key={edge.id}><button type="button" aria-label={`${nodeName(from, graph)} Result, ${type}, to ${nodeName(to, graph)} ${portLabel(edge.to.portId, to, graph)}${describeObservation(observation, true)}; disconnect`} onClick={() => send({ type: 'disconnect', edgeId: edge.id })}>{nodeName(from, graph)} → {nodeName(to, graph)} {portLabel(edge.to.portId, to, graph)}{observation?.state === 'cant-tell' && <small>Can't tell</small>} <small>Disconnect</small></button>
              <button type="button" onClick={() => locate(from.id)}>Go to source</button><button type="button" onClick={() => locate(to.id)}>Go to destination</button></li>;
          })}</ul></section>}
        </div>
        <div className="w2-canvas-navigation" ref={navigation} aria-label="Graph navigation">
          <button type="button" aria-label="Zoom out" disabled={zoom <= .25} onClick={() => setZoom(Math.max(.25, zoom - .25))}><Minus size={16}/></button><output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .25))}><Plus size={16}/></button>
          <button type="button" aria-label="Tidy Up" onClick={() => send({ type: 'layout', graph: arrangeCanvas(graph) })}><WandSparkles size={14}/><span className="w2-canvas-toolbar-label">Tidy Up</span></button>
          <button type="button" className="w2-canvas-problems-pill" ref={problemsButton} onClick={() => setProblemsOpen(true)}>{problemCount ? <AlertTriangle size={14}/> : <CircleCheck size={14}/>} {problemCount ? `${problemCount} Problems` : 'No Problems'}</button>
        </div>
      </main>
      {!phone && (panel === 'inspector' || panel === 'palette') && inspector}
    </div>
    <footer className="w2-canvas-footer" data-message={Boolean(message || state.message) || undefined}><div role="status" aria-live="polite" aria-atomic="true">{message || state.message || (result.ok && !detached.length ? <><Check size={14} aria-hidden/> Compiler accepted</> : 'Complete the required connections before Apply.')}</div>
      <button type="button" disabled={busy || dirty} onClick={save}>Save draft</button><button type="button" className="w2-canvas-primary" disabled={busy || !result.ok || !!detached.length} onClick={apply}>Apply to draft</button></footer>
    {phone && panel && <Modal title={panel === 'palette' ? 'Blocks' : 'Block inspector'} sheet theme={theme} close={closePanel}>{panel === 'palette' ? palette : inspector}</Modal>}
    {help && <Modal title="Keyboard help" theme={theme} close={() => { setHelp(false); moreButton.current?.focus(); }}><p>Arrows select blocks or traverse their controls. Enter enters ports and actions. Escape returns to the header. Tab leaves the graph.</p><p>Move: arrows 8 pixels, Shift and arrows 32. Enter commits. Escape cancels. Position also accepts numeric coordinates in the inspector.</p><p>Delete removes a block after confirmation. Control or Command Z undoes; add Shift to redo. All editing is available in Outline.</p></Modal>}
    {problemsOpen && <Modal title="Canvas problems" theme={theme} close={() => { setProblemsOpen(false); problemsButton.current?.focus(); }}>
      {!problemCount && <p>No Problems. Compiler accepted the current connections.</p>}
      {!result.ok && <ul>{result.errors.map((error, index) => <li key={index}><button type="button" onClick={() => { setProblemsOpen(false); if (error.nodeId) locate(error.nodeId); else locatePointer(error.pointer); }}>{error.message} {error.pointer || 'Output'}</button></li>)}</ul>}
      {!!detached.length && <p>{detached.length} blocks are not connected to an output. Connect or delete them before Apply; nothing is silently dropped.</p>}
      {result.ok && result.diagnostics.filter(issue => issue.hint).map((issue, i) => <p key={i}>Wiring hint: {issue.message}</p>)}
    </Modal>}
    {connection && <Modal title={`Connect ${nodeName(graph.nodes.find(node => node.id === connection.socket.nodeId)!)}.${portLabel(connection.socket.portId)}`} theme={theme} close={restoreConnection}>
      <ConnectionDialog graph={graph} request={connection} announce={setMessage} onConnect={(from, to, replace) => { send({ type: 'connect', from, to, replace }); setConnection(undefined); }}/>
    </Modal>}
    {deleting && <Modal title="Delete block" theme={theme} close={() => { setDeleting(undefined); locate(deleting.id); }}><p>Delete {nodeName(deleting)} and {graph.edges.filter(edge => edge.from.nodeId === deleting.id || edge.to.nodeId === deleting.id).length} connected wires? Required inputs will need reconnecting. Undo restores this edit.</p>
      <button type="button" onClick={() => { send({ type: 'delete', nodeId: deleting.id }); setDeleting(undefined); }}>Confirm delete</button></Modal>}
    {leaving && <Modal title="Unsaved canvas edits" theme={theme} close={() => { setLeaving(false); if (selected) locate(selected.id); }}><p>Keep this canvas open, apply valid edits to the draft, or discard canvas edits. Apply is not Publish.</p>
      <button type="button" onClick={() => { setLeaving(false); if (selected) locate(selected.id); }}>Stay</button><button type="button" disabled={!result.ok || !!detached.length || busy} onClick={apply}>Apply valid edits</button><button type="button" onClick={close}>Discard canvas edits</button>
      {message && <p role="status">{message}</p>}</Modal>}
  </div>;
}

export { LimitsMeter, Modal as CanvasDialog };
export type { GraphBudget };
