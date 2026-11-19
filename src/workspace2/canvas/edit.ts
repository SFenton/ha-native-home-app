import { allocateGraphId, lift, portsCompatible, type GraphEdge, type GraphNode, type GraphPort, type LogicGraph } from '../../shared/composition/graph';
import { copy } from '../../shared/composition/graph/json';
import { operandBase } from '../../shared/composition/expression';
import type { BlockSeed } from './blocks';
import { nodeName } from './blocks';

export interface Socket { readonly nodeId: string; readonly portId: string }
export interface CanvasFocus { readonly nodeId: string; readonly portId?: string; readonly direction?: 'input' | 'output' }
export interface EditSnapshot { readonly graph: LogicGraph; readonly focus: CanvasFocus | null }
export interface EditState extends EditSnapshot {
  readonly past: readonly EditSnapshot[];
  readonly future: readonly EditSnapshot[];
  readonly message: string;
}
export type EditCommand =
  | { type: 'add'; seed: BlockSeed; scopeId: string }
  | { type: 'connect'; from: Socket; to: Socket; replace?: boolean }
  | { type: 'disconnect'; edgeId: string }
  | { type: 'delete'; nodeId: string }
  | { type: 'move'; nodeId: string; x: number; y: number }
  | { type: 'update'; nodeId: string; value: GraphNode['payload']['value'] }
  | { type: 'rule'; nodeId: string; action: 'add' | 'remove' | 'up' | 'down'; index: number }
  | { type: 'combine'; nodeId: string; operation: 'all' | 'any' }
  | { type: 'output'; nodeId: string }
  | { type: 'layout'; graph: LogicGraph }
  | { type: 'undo' | 'redo' };
export interface ConnectionCheck { readonly allowed: boolean; readonly reason?: string; readonly occupied?: GraphEdge }
export function socketOf(graph: LogicGraph, socket: Socket, direction: 'input' | 'output'): GraphPort | undefined {
  const node = graph.nodes.find(node => node.id === socket.nodeId);
  return (direction === 'input' ? node?.inputs : node?.outputs)?.find(port => port.id === socket.portId);
}
export function canConnect(graph: LogicGraph, from: Socket, to: Socket, replace = false): ConnectionCheck {
  const output = socketOf(graph, from, 'output'), input = socketOf(graph, to, 'input');
  if (!output || !input || input.binding === undefined) return { allowed: false, reason: 'The block or port no longer exists.' };
  const occupied = graph.edges.find(edge => edge.to.nodeId === to.nodeId && edge.to.portId === to.portId);
  const match = portsCompatible(output.type, input.type, graph.scopes);
  if (!match.compatible) return { allowed: false, reason: `Types do not match. ${match.reason}`, occupied };
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (replace && edge.id === occupied?.id) continue;
    next.set(edge.from.nodeId, [...next.get(edge.from.nodeId) ?? [], edge.to.nodeId]);
  }
  const pending = [to.nodeId], visited = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (nodeId === from.nodeId) return { allowed: false, reason: 'This connection would create a cycle. Connect to a block that does not feed this output.', occupied };
    if (!visited.has(nodeId)) { visited.add(nodeId); pending.push(...next.get(nodeId) ?? []); }
  }
  if (occupied && !replace) return { allowed: false, reason: 'This input already has a connection. Use Replace connection to change it in one undoable edit.', occupied };
  return { allowed: true, occupied };
}
export const initialEditState = (graph: LogicGraph): EditState => ({ graph, focus: graph.nodes[0] ? { nodeId: graph.nodes[0].id } : null, past: [], future: [], message: '' });
export function edit(state: EditState, command: EditCommand): EditState {
  if (command.type === 'undo' || command.type === 'redo') {
    const history = command.type === 'undo' ? state.past : state.future, held = history.at(-1);
    if (!held) return state;
    const current: EditSnapshot = { graph: state.graph, focus: state.focus };
    return { ...held, past: command.type === 'undo' ? state.past.slice(0, -1) : [...state.past, current],
      future: command.type === 'redo' ? state.future.slice(0, -1) : [...state.future, current], message: command.type === 'undo' ? 'Edit undone.' : 'Edit redone.' };
  }
  const graph = state.graph;
  let updated = graph, focus = state.focus, message = '';
  const node = 'nodeId' in command ? graph.nodes.find(node => node.id === command.nodeId) : undefined;
  const refuse = (message: string): EditState => ({ ...state, message });
  if (command.type === 'add') {
    const scope = graph.scopes.find(scope => scope.id === command.scopeId);
    if (!scope) return refuse('The insertion scope no longer exists.');
    const seed = lift(command.seed.value, { kind: command.seed.kind, scope }).graph.nodes[0];
    if (!seed || seed.payload.kind === 'opaque') return refuse('This block needs workspace settings before it can be added.');
    const id = allocateGraphId('block', new Set(graph.nodes.map(node => node.id)));
    const authored: GraphNode = { ...seed, id, scopeId: scope.id, origins: [], provenance: 'authored',
      position: { x: 32, y: graph.nodes.reduce((maximum, node) => Math.max(maximum, (node.position?.y ?? 0) + 240), 24) } };
    updated = { ...graph, nodes: [...graph.nodes, authored] };
    focus = { nodeId: id }; message = `${nodeName(authored)} added, ${authored.outputs[0]?.type.valueType ?? 'unresolved'} output. Connect its required inputs.`;
  } else if (command.type === 'connect') {
    const check = canConnect(graph, command.from, command.to, command.replace);
    if (!check.allowed) return refuse(check.reason!);
    const input = socketOf(graph, command.to, 'input')!, output = socketOf(graph, command.from, 'output')!;
    const edge: GraphEdge = { id: allocateGraphId('wire', new Set(graph.edges.map(edge => edge.id))), from: command.from, to: command.to, binding: input.binding!, kind: output.type.representation };
    updated = { ...graph, edges: [...graph.edges.filter(edge => !command.replace || edge.id !== check.occupied?.id), edge] };
    focus = { nodeId: command.to.nodeId, portId: command.to.portId, direction: 'input' };
    message = command.replace ? 'Connection replaced. Undo restores the previous wire.' : 'Connection added.';
  } else if (command.type === 'disconnect') {
    const edge = graph.edges.find(edge => edge.id === command.edgeId);
    if (!edge) return refuse('This connection no longer exists.');
    updated = { ...graph, edges: graph.edges.filter(edge => edge.id !== command.edgeId) };
    focus = { ...edge.to, direction: 'input' }; message = 'Connection removed. Its input is now unconnected.';
  } else if (command.type === 'layout') {
    updated = command.graph; message = 'Blocks arranged. Selection preserved.';
  } else if (!node) return refuse('The selected block no longer exists.');
  else if (command.type === 'delete') {
    if (graph.roots.some(root => root.nodeId === node.id)) return refuse('This block is an output. Select its replacement and choose Use as output before deleting it.');
    const index = graph.nodes.indexOf(node);
    updated = { ...graph, nodes: graph.nodes.filter(held => held.id !== node.id), edges: graph.edges.filter(edge => edge.from.nodeId !== node.id && edge.to.nodeId !== node.id) };
    const neighbor = updated.nodes[Math.min(index, updated.nodes.length - 1)];
    focus = neighbor ? { nodeId: neighbor.id } : null; message = `${nodeName(node)} deleted with its connected wires. Undo restores them.`;
  } else if (command.type === 'move') {
    if (![command.x, command.y].every(Number.isFinite)) return refuse('Enter finite X and Y coordinates.');
    updated = { ...graph, nodes: graph.nodes.map(held => held.id === node.id ? { ...held, position: { x: command.x, y: command.y } } : held) };
    focus = { nodeId: node.id }; message = `${nodeName(node)} moved to X ${command.x}, Y ${command.y}.`;
  } else if (command.type === 'rule') {
    const parsed = operandBase.safeParse(node.payload.value);
    if (node.payload.kind !== 'operand' || !parsed.success || parsed.data.type !== 'choose') return refuse('Select a Choose block to edit its rules.');
    const value = parsed.data, order = value.cases.map((_, index) => index);
    if (command.action === 'add') {
      if (order.length >= 16) return refuse('Choose supports at most 16 rules.');
      order.push(order.length);
    } else {
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= order.length) return refuse('The selected rule no longer exists.');
      if (command.action === 'remove') {
        if (order.length === 1) return refuse('Keep at least one rule.');
        order.splice(command.index, 1);
      } else {
        const to = command.index + (command.action === 'up' ? -1 : 1);
        if (to < 0 || to >= order.length) return refuse('This rule cannot move further.');
        [order[command.index], order[to]] = [order[to], order[command.index]];
      }
    }
    const seed = lift({ ...value, cases: order.map(index => value.cases[index] ?? { when: { type: 'viewer', isAdmin: true }, then: { type: 'literal', value: '' } }) }, { kind: 'operand', scope: graph.scopes.find(scope => scope.id === node.scopeId) }).graph.nodes[0];
    const mapping = new Map(order.map((original, index) => [original, index]));
    updated = { ...graph, nodes: graph.nodes.map(held => held.id === node.id ? { ...held, payload: seed.payload, inputs: seed.inputs, provenance: 'authored' } : held),
      edges: graph.edges.flatMap(edge => {
        if (edge.to.nodeId !== node.id || !edge.binding.startsWith('/cases/')) return [edge];
        const original = Number(edge.binding.split('/')[2]), index = mapping.get(original);
        if (index === undefined) return [];
        const remap = (binding: string) => binding.replace(/^\/cases\/\d+\//, `/cases/${index}/`);
        return [{ ...edge, to: { ...edge.to, portId: remap(edge.to.portId) }, binding: remap(edge.binding) }];
      }) };
    focus = { nodeId: node.id }; message = command.action === 'add' ? 'Rule added. Connect its If and Then on canvas.' : 'Rules updated. Otherwise and connected branches are preserved.';
  } else if (command.type === 'update') {
    if (node.payload.kind === 'opaque') return refuse('Preserved JSON cannot be edited.');
    const kind = node.payload.kind === 'logic-ref' || node.payload.kind === 'template' ? node.payload.representation : node.payload.kind === 'hole' ? 'operand' : node.payload.kind;
    const seed = lift(copy(command.value), { kind, scope: graph.scopes.find(scope => scope.id === node.scopeId) }).graph.nodes[0];
    if (seed.payload.kind === 'opaque') return refuse('These fields do not match this block grammar. No change was made.');
    const held: GraphNode = { ...node, catalogKey: seed.catalogKey, payload: seed.payload, inputs: seed.inputs, outputs: seed.outputs, provenance: 'authored' };
    updated = { ...graph, nodes: graph.nodes.map(current => current.id === node.id ? held : current),
      edges: graph.edges.filter(edge => edge.to.nodeId !== node.id || held.inputs.some(input => input.id === edge.to.portId)) };
    focus = { nodeId: node.id }; message = `${nodeName(held)} fields updated.`;
  } else if (command.type === 'combine') {
    if (node.outputs[0]?.type.representation !== 'condition') return refuse('And / Or require a yes/no condition, not a boolean value.');
    const seed = lift({ type: command.operation, of: [{ type: 'viewer', isAdmin: true }, { type: 'viewer', isAdmin: true }] }, { kind: 'condition', scope: graph.scopes.find(scope => scope.id === node.scopeId) }).graph.nodes[0];
    const id = allocateGraphId('block', new Set(graph.nodes.map(node => node.id)));
    const combined: GraphNode = { ...seed, id, scopeId: node.scopeId, origins: [], provenance: 'authored', position: { x: (node.position?.x ?? 0) + 300, y: node.position?.y ?? 0 } };
    updated = { ...graph, nodes: [...graph.nodes, combined],
      roots: graph.roots.map(root => root.nodeId === node.id ? { ...root, nodeId: id } : root),
      edges: [...graph.edges.map(edge => edge.from.nodeId === node.id ? { ...edge, from: { nodeId: id, portId: 'value' } } : edge),
        { id: allocateGraphId('wire', new Set(graph.edges.map(edge => edge.id))), from: { nodeId: node.id, portId: 'value' }, to: { nodeId: id, portId: '/of/0' }, kind: 'condition', binding: '/of/0' }] };
    focus = { nodeId: id }; message = `${command.operation === 'all' ? 'All Of' : 'Any Of'} added on canvas. Your existing check is preserved. Connect the second condition.`;
  } else if (command.type === 'output') {
    const root = graph.roots[0], output = node.outputs[0];
    if (graph.roots.length !== 1 || !root || !output) return refuse('Choose an output through the workspace host for this multi-output canvas.');
    const original = graph.nodes.find(node => node.id === root.nodeId)?.outputs.find(port => port.id === root.portId);
    if (original && output.type.representation !== original.type.representation) return refuse('This output has a different representation. Add an explicit adapter.');
    updated = { ...graph, roots: [{ ...root, nodeId: node.id, portId: output.id }] };
    focus = { nodeId: node.id }; message = `${nodeName(node)} is now the output.`;
  }
  return { graph: updated, focus, past: [...state.past, { graph, focus: state.focus }], future: [], message };
}

export function orderedNodes(graph: LogicGraph): readonly GraphNode[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) incoming.set(edge.to.nodeId, [...incoming.get(edge.to.nodeId) ?? [], edge.from.nodeId]);
  const seen = new Set<string>(), result: GraphNode[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    incoming.get(id)?.forEach(visit);
    const node = nodes.get(id); if (node) result.push(node);
  };
  graph.nodes.forEach(node => visit(node.id));
  return result;
}
export function detachedNodes(graph: LogicGraph): readonly GraphNode[] {
  const needed = new Set<string>(), pending = graph.roots.map(root => root.nodeId);
  const dependencies = new Map<string, string[]>();
  for (const edge of graph.edges) dependencies.set(edge.to.nodeId, [...dependencies.get(edge.to.nodeId) ?? [], edge.from.nodeId]);
  while (pending.length) {
    const id = pending.pop()!;
    if (!needed.has(id)) { needed.add(id); pending.push(...dependencies.get(id) ?? []); }
  }
  return graph.nodes.filter(node => !needed.has(node.id));
}
