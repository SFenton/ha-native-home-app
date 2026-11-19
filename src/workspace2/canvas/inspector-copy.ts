import type { CanvasHost, GraphNode, LogicGraph } from '../../shared/composition/graph';
import { blockFields, nodeDetail, nodeName, portLabel } from './blocks';
import type { CanvasGraphIndex } from './graph-index';

type Sources = CanvasHost['data']['sources'];
const comparisons: Readonly<Record<string, string>> = { eq: 'is', ne: 'is not', above: 'is above', below: 'is below', before: 'is before', after: 'is after' };
export function branchLabel(node: GraphNode, graph: LogicGraph, index: CanvasGraphIndex, sources: Sources, ancestors: ReadonlySet<string> = new Set()): string {
  if (ancestors.has(node.id)) return 'Cyclic check';
  const value = blockFields(node.payload.value);
  const term = (binding: string) => {
    const source = index.source(node.id, binding), data = blockFields(source?.payload.value);
    return data?.type === 'literal' ? JSON.stringify(data.value) : source ? nodeName(source, graph, index) : 'unconnected value';
  };
  if (value) {
    if (value.type === 'not') {
      const source = index.source(node.id, '/of');
      return source ? `Not (${branchLabel(source, graph, index, sources, new Set([...ancestors, node.id]))})` : 'Not (unconnected check)';
    }
    if (value.type === 'compare') return `${term('/left')} ${comparisons[String(value.op)] ?? value.op} ${term('/right')}`;
    if (value.type === 'viewer' && typeof value.isAdmin === 'boolean') return `Viewer ${value.isAdmin ? 'is' : 'is not'} an administrator`;
    if (value.type === 'viewer-person') return `Viewer's person is ${Array.isArray(value.in) ? value.in.join(' or ') : 'not configured'}`;
    if (value.type === 'state') {
      const sourceId = index.source(node.id, '/sourceId')?.payload.value;
      const source = typeof sourceId === 'string' ? sources.find(source => source.id === sourceId)?.name ?? sourceId : 'Unconnected entity';
      return `${source} is ${Array.isArray(value.in) ? value.in.join(' or ') : 'not configured'}`;
    }
  }
  const detail = nodeDetail(node, sources, graph, index);
  return `${nodeName(node, graph, index)}${detail ? `: ${detail}` : ''}`;
}
export function inspectorDescription(node: GraphNode, graph: LogicGraph, index: CanvasGraphIndex, sources: Sources): string {
  const value = blockFields(node.payload.value), name = nodeName(node, graph, index);
  const inputNames = node.inputs.map(input => {
    const source = index.source(node.id, input.id);
    return `${portLabel(input.id, node, graph, index)}: ${source ? branchLabel(source, graph, index, sources) : 'unconnected'}`;
  });
  if (value) {
    if (value.type === 'all' || value.type === 'any') {
      const connected = node.inputs.filter(input => index.source(node.id, input.id)).length;
      return `${value.type === 'all' ? 'All' : 'At least one'} of ${node.inputs.length} checks must match. ${connected} of ${node.inputs.length} connected.`;
    }
    if (value.type === 'literal') return `Returns the configured ${node.outputs[0]?.type.valueType ?? 'JSON'} value. Edit this value below.`;
    if (value.type === 'compare' || value.type === 'viewer' || value.type === 'state' || value.type === 'viewer-person' || value.type === 'not') return `${branchLabel(node, graph, index, sources)}.`;
    if (value.type === 'math') return `${name} uses ${inputNames.join('; ')}.`;
    if (value.type === 'read') return `Reads ${nodeDetail(node, sources, graph, index)} as ${value.as}. Missing data: ${value.missing}.`;
    if (value.type === 'raw-state') return `Reads the state text from ${nodeDetail(node, sources, graph, index)} without numeric conversion.`;
    if (value.type === 'last-changed') return `Returns when ${nodeDetail(node, sources, graph, index)} last changed state.`;
    if (value.type === 'choose') return `${Array.isArray(value.cases) ? value.cases.length : 0} rules are checked in order; the first matching If supplies Then. Otherwise: ${index.source(node.id, '/otherwise') ? branchLabel(index.source(node.id, '/otherwise')!, graph, index, sources) : 'unconnected'}.`;
    if (value.type === 'date') return `${name}: ${inputNames.join('; ')}.`;
    if (value.type === 'clock') return `Returns ${String(value.part).replaceAll('-', ' ')} from the app clock.`;
  }
  if (node.payload.kind === 'source-selection') return `Selects ${sources.find(source => source.id === node.payload.value)?.name ?? String(node.payload.value)} as the entity for its connected blocks.`;
  const detail = nodeDetail(node, sources, graph, index);
  return `${name}${detail ? `: ${detail}` : ''}. ${inputNames.length ? inputNames.join('; ') + '.' : `Returns ${node.outputs[0]?.type.valueType ?? 'preserved JSON'}.`}`;
}
