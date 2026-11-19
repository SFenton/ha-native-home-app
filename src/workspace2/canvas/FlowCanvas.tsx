import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, GitBranch, List, Maximize, Minus, Move, Plus, Redo2, SlidersHorizontal, Trash2, Undo2, X } from 'lucide-react';
import { autoLayout, lower, type BlockCatalogEntry, type CanvasHost, type GraphBudget, type GraphNode, type GraphPort, type LogicGraph } from '../../shared/composition/graph';
import type { DerivedTheme } from '../theme';
import { blockSeed, nodeDetail, nodeName, portLabel } from './blocks';
import { detachedNodes, edit, initialEditState, orderedNodes, type CanvasFocus, type EditCommand } from './edit';
import Palette from './Palette';
import Inspector from './Inspector';
import ConnectionDialog, { type ConnectionRequest } from './ConnectionDialog';
import LimitsMeter from './LimitsMeter';
import { canvasTheme, wireKind } from './theme';
import './canvas.css';

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
function Modal({ title, children, close, theme }: { title: string; children: ReactNode; close: () => void; theme: DerivedTheme }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Backdrop className="w2-canvas-backdrop"/><Dialog.Viewport className="w2-canvas-dialog-viewport">
      <Dialog.Popup className="w2-canvas-dialog" style={theme.variables as CSSProperties} finalFocus={false}>
        <div className="w2-canvas-panel-head"><Dialog.Title>{title}</Dialog.Title><button type="button" aria-label={`Close ${title}`} onClick={close}><X size={18}/></button></div>
        <div className="w2-canvas-dialog-body">{children}</div>
      </Dialog.Popup>
    </Dialog.Viewport></Dialog.Portal>
  </Dialog.Root>;
}
export interface FlowCanvasProps {
  readonly host: CanvasHost;
  readonly graph: LogicGraph;
  readonly title: string;
  readonly theme: DerivedTheme;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
}
export default function FlowCanvas({ host, graph: initialGraph, title, theme, onClose, returnFocus }: FlowCanvasProps) {
  const [state, setState] = useState(() => initialEditState(initialGraph));
  const [view, setView] = useState<'graph' | 'outline'>('graph'), [panel, setPanel] = useState<'palette' | 'inspector' | null>('palette');
  const [entered, setEntered] = useState<string>(), [connection, setConnection] = useState<ConnectionRequest>();
  const [deleting, setDeleting] = useState<GraphNode>(), [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1), [moving, setMoving] = useState<{ nodeId: string; x: number; y: number }>();
  const [wirePaths, setWirePaths] = useState<readonly { id: string; path: string; kind: string }[]>([]);
  const [initialSnapshot] = useState(() => host.snapshot());
  const snapshot = useRef(initialSnapshot), baseline = useRef(initialGraph), refs = useRef(new Map<string, HTMLButtonElement>());
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLUListElement>(null), addButton = useRef<HTMLButtonElement>(null), navigation = useRef<HTMLDivElement>(null);
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
    if (!restore.current) return;
    restore.current = false;
    const element = state.focus ? elementFor(state.focus) ?? elementFor({ nodeId: state.focus.nodeId }) : addButton.current;
    element?.focus(); element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state, view, entered, panel, connection, deleting, leaving]);
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
        return [{ id: edge.id, path: `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`, kind: type ? wireKind(type) : 'record' }];
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
      return `${other ? nodeName(other) : 'missing block'} ${direction === 'input' ? 'output' : portLabel(endpoint.portId) + ' input'}`;
    }).join(', ');
    const type = port.type.valueType === 'unresolved' ? 'Unresolved type' : port.type.valueType;
    const glyph = ({ number: '#', text: 'T', 'yes/no': '✓', time: '◷', list: '≡', entity: '◇', record: '{}', unresolved: '?' })[port.type.valueType];
    return <button key={`${direction}:${port.id}`} type="button" ref={ref({ nodeId: node.id, portId: port.id, direction })} tabIndex={entered === node.id ? 0 : -1}
      className="w2-canvas-port" data-direction={direction} data-wire-type={wireKind(port.type)}
      aria-label={`${nodeName(node)}, ${direction === 'input' ? portLabel(port.id) : port.label} ${direction}, ${type}, ${port.type.representation}${port.type.nullable ? ', nullable' : ''}, ${links ? `connected to ${links}` : direction === 'input' && port.required ? 'required, unconnected' : 'unconnected'}`}
      onClick={() => { connectionReturn.current = { nodeId: node.id, portId: port.id, direction }; setConnection({ socket: { nodeId: node.id, portId: port.id }, direction }); }}
      onKeyDown={event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && edges.length === 1) { event.preventDefault(); send({ type: 'disconnect', edgeId: edges[0].id }); }
      }}>
      <span className="w2-canvas-port-glyph" aria-hidden>{glyph}</span><span>{direction === 'input' ? portLabel(port.id) : port.label}</span><small>{type}</small>
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
  return <div className="w2-canvas" style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties} data-panel={panel ?? 'none'} data-dark={theme.dark || undefined}
    onKeyDown={event => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); send({ type: event.shiftKey ? 'redo' : 'undo' }); }
    }}>
    <header className="w2-canvas-header"><div><small>Flows <ChevronRight size={12} aria-hidden/> Canvas</small><h1>{title}</h1></div>
      <span className="w2-canvas-caption">Configuration only · No device actions</span>
      <button type="button" aria-label="Close canvas" onClick={() => dirty ? setLeaving(true) : close()}><X size={18}/></button></header>
    <nav className="w2-canvas-toolbar" aria-label="Canvas controls">
      <div className="w2-canvas-segment"><button type="button" aria-pressed={view === 'graph'} onClick={() => { setView('graph'); restore.current = true; }}><GitBranch size={16}/> Graph</button>
        <button type="button" aria-pressed={view === 'outline'} onClick={() => { setView('outline'); restore.current = true; }}><List size={16}/> Outline</button></div>
      <button type="button" ref={addButton} aria-expanded={panel === 'palette'} onClick={() => setPanel(panel === 'palette' ? null : 'palette')}><Plus size={16}/> Add Block</button>
      <button type="button" aria-expanded={panel === 'inspector'} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}><SlidersHorizontal size={16}/> Inspector</button>
      <button type="button" aria-label="Undo canvas edit" disabled={!state.past.length} onClick={() => send({ type: 'undo' })}><Undo2 size={16}/></button>
      <button type="button" aria-label="Redo canvas edit" disabled={!state.future.length} onClick={() => send({ type: 'redo' })}><Redo2 size={16}/></button>
    </nav>
    <div className="w2-canvas-work">
      {panel === 'palette' && <Palette scope={graph.scopes.find(scope => scope.id === selected?.scopeId)?.kind ?? graph.scopes[0].kind} capabilities={host.targetCapabilities} sourceId={host.data.sources[0]?.id} onAdd={add} close={() => { setPanel(null); addButton.current?.focus(); }}/>}
      <main className="w2-canvas-main">
        <p id="w2-canvas-key-help" className="w2-canvas-caption">Arrows select blocks or traverse their controls. Enter enters ports and actions. Escape returns to the header. Tab leaves the graph. Use Move for 8 px steps, Shift for 32 px.</p>
        <div className="w2-canvas-viewport" ref={viewport}>
          <div className="w2-canvas-scaled" style={view === 'graph' ? { width: width * zoom, height: height * zoom } : undefined}>
            <ul ref={board} className={`w2-canvas-nodes w2-canvas-${view}`} aria-label={view === 'graph' ? 'Flow graph blocks' : 'Flow outline blocks'} aria-describedby="w2-canvas-key-help"
              style={view === 'graph' ? { width, height, transform: `scale(${zoom})` } : undefined}>
              {view === 'graph' && <li className="w2-canvas-wires" aria-hidden><svg width={width} height={height}>{wirePaths.map(wire => <path key={wire.id} d={wire.path} className={`w2-canvas-wire w2-canvas-wire-${wire.kind}`}/>)}</svg></li>}
              {ordered.map(node => {
                const position = node.id === moving?.nodeId ? moving : node.position;
                const controls = entered === node.id, active = selected?.id === node.id;
                return <li key={node.id} className="w2-canvas-node" data-selected={active || undefined} data-node-id={node.id} style={view === 'graph' ? { left: position?.x ?? 24, top: position?.y ?? 24 } : undefined}
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
                  <button type="button" ref={ref({ nodeId: node.id })} className="w2-canvas-node-head" aria-label={`Select ${nodeName(node)} ${graph.nodes.indexOf(node) + 1}`} aria-pressed={active}
                    tabIndex={active || !selected && ordered[0] === node ? 0 : -1} onFocus={() => setState(held => ({ ...held, focus: { nodeId: node.id } }))}
                    onClick={() => { focus({ nodeId: node.id }); setEntered(node.id); setPanel('inspector'); }} onKeyDown={event => headerKeys(event, node)}>
                    <GitBranch size={16} aria-hidden/><strong>{nodeName(node)}</strong>{graph.roots.some(root => root.nodeId === node.id) && <small>Output</small>}
                  </button>
                  {nodeDetail(node) && <div className="w2-canvas-node-detail">{nodeDetail(node)}</div>}
                  {node.inputs.map(input => port(node, input, 'input'))}
                  {node.outputs.map(output => port(node, output, 'output'))}
                  {controls && <div className="w2-canvas-node-actions">
                    <button type="button" aria-label={`Move ${nodeName(node)}`} onClick={() => beginMove(node)}><Move size={14}/> Move</button>
                    <button type="button" aria-label={`Inspect ${nodeName(node)}`} onClick={() => setPanel('inspector')}>Inspect</button>
                    <button type="button" aria-label={`Delete ${nodeName(node)}`} onClick={() => setDeleting(node)}><Trash2 size={14}/></button>
                  </div>}
                </li>;
              })}
            </ul>
          </div>
        </div>
        <div className="w2-canvas-navigation" ref={navigation} aria-label="Graph navigation">
          <button type="button" aria-label="Zoom out" disabled={zoom <= .25} onClick={() => setZoom(Math.max(.25, zoom - .25))}><Minus size={16}/></button><output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .25))}><Plus size={16}/></button>
          <button type="button" onClick={() => fit(false)}><Maximize size={14}/> Fit all</button><button type="button" onClick={() => fit(true)}>Fit selection</button>
          <button type="button" onClick={() => send({ type: 'layout', graph: arrangeCanvas(graph) })}>Auto Arrange</button>
          {[[ArrowLeft, 'left', -160, 0], [ArrowRight, 'right', 160, 0], [ArrowUp, 'up', 0, -160], [ArrowDown, 'down', 0, 160]].map(([Icon, name, x, y]) => {
            const Glyph = Icon as typeof ArrowLeft;
            return <button key={String(name)} type="button" aria-label={`Pan ${name}`} onClick={() => viewport.current?.scrollBy(Number(x), Number(y))}><Glyph size={14}/></button>;
          })}
        </div>
        <details className="w2-canvas-connections"><summary>Connections ({graph.edges.length})</summary><ul aria-label="Wires">{graph.edges.map(edge => {
          const from = graph.nodes.find(node => node.id === edge.from.nodeId)!, to = graph.nodes.find(node => node.id === edge.to.nodeId)!, type = from.outputs.find(port => port.id === edge.from.portId)?.type.valueType;
          return <li key={edge.id}><button type="button" aria-label={`${nodeName(from)} Value, ${type}, to ${nodeName(to)} ${portLabel(edge.to.portId)}; disconnect`} onClick={() => send({ type: 'disconnect', edgeId: edge.id })}>{nodeName(from)} → {nodeName(to)} {portLabel(edge.to.portId)} <small>Disconnect</small></button>
            <button type="button" onClick={() => locate(from.id)}>Go to source</button><button type="button" onClick={() => locate(to.id)}>Go to destination</button></li>;
        })}</ul></details>
        {!result.ok && <section className="w2-canvas-problems" aria-label="Canvas errors"><h2><AlertTriangle size={16}/> Needs attention</h2><ul>{result.errors.map((error, index) => <li key={index}><button type="button" onClick={() => error.nodeId ? locate(error.nodeId) : locatePointer(error.pointer)}>{error.message} {error.pointer || 'Output'}</button></li>)}</ul></section>}
        {!!detached.length && <p className="w2-canvas-error">{detached.length} blocks are not connected to an output. Connect or delete them before Apply; nothing is silently dropped.</p>}
        {result.ok && result.diagnostics.some(issue => issue.hint) && <details><summary>Wiring hints (not compiler refusals)</summary>{result.diagnostics.filter(issue => issue.hint).map((issue, i) => <p key={i}>{issue.message}</p>)}</details>}
        <LimitsMeter budgets={result.budgets} onLocate={locatePointer}/>
      </main>
      {selected && (panel === 'inspector' || panel === 'palette') && <Inspector key={`${selected.id}:${state.past.length}`} graph={graph} node={selected} host={host} send={send} locate={locate} close={() => setPanel(null)} move={() => beginMove(selected)} remove={() => setDeleting(selected)}/>}
    </div>
    <footer className="w2-canvas-footer"><div role="status" aria-live="polite" aria-atomic="true">{message || state.message || (result.ok && !detached.length ? <><Check size={14} aria-hidden/> Compiler accepted</> : 'Complete the required connections before Apply.')}</div>
      <button type="button" disabled={busy || dirty} onClick={save}>Save draft</button><button type="button" className="w2-canvas-primary" disabled={busy || !result.ok || !!detached.length} onClick={apply}>Apply to draft</button></footer>
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

export { LimitsMeter };
export type { GraphBudget };
