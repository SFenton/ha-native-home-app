import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lift, lower, validateGraph, type LogicGraph } from '../../../../src/shared/composition/graph';
import { CompositionValidationError } from '../../../../src/shared/composition/json';
import type { Json } from '../../../../src/shared/types';
import { largeGraphFlow } from './native';

const root = new URL('../../../../contract/corpus/', import.meta.url);
export const corpusCases: readonly { file: string }[] = JSON.parse(readFileSync(new URL('index.json', root), 'utf8')).cases;
export function editedLargeGraph(): LogicGraph {
  const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
  const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
  return { ...graph, nodes: graph.nodes.map(node => node === first ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) };
}
export function performanceParitySnapshot(file: string): string {
  let graph: LogicGraph;
  try {
    const document: Json = file.startsWith('large-flow') ? largeGraphFlow() : JSON.parse(readFileSync(new URL(file, root), 'utf8')).document;
    graph = file === 'large-flow-edited' ? editedLargeGraph() : lift(document, { kind: file === 'large-flow' ? 'flow' : 'document' }).graph;
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return digest({ phase: 'lift', issues: error.issues });
  }
  return digest({ diagnostics: validateGraph(graph), result: lower(graph) });
}
function digest(value: unknown): string {
  const objects = new WeakMap<object, string>();
  const visit = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return createHash('sha256').update(`${typeof value}:${JSON.stringify(value)}`).digest('hex');
    const previous = objects.get(value);
    if (previous) return previous;
    const hash = createHash('sha256').update(Array.isArray(value) ? 'array' : 'object');
    for (const [key, child] of Object.entries(value)) hash.update(JSON.stringify(key)).update(visit(child));
    const result = hash.digest('hex');
    objects.set(value, result);
    return result;
  };
  return visit(value);
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--record')) {
  const snapshots = Object.fromEntries([...corpusCases.map(test => test.file), 'large-flow', 'large-flow-edited'].map(file => [file, performanceParitySnapshot(file)]));
  writeFileSync(new URL('performance-baseline.json', import.meta.url), JSON.stringify({ head: '196cac8', snapshots }, null, 2) + '\n');
}
