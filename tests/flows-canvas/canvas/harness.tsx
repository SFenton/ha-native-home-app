import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { lift, type CanvasSnapshot } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas } from '../../../src/workspace2/canvas/FlowCanvas';
import { useStudioTheme } from '../../../src/workspace2/useStudioTheme';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, choose, refusedChoose } from './fixtures';
import { blockCatalog } from '../../../src/shared/composition/graph/catalog';
import type { Json } from '../../../src/shared/types';
import type { CanvasHostWithObservations } from '../../../src/workspace2/canvas/observations';
import { observationFixture } from './observation-fixture';
import { largeGraphFlow } from '../graph/fixtures/large-flow';
import { indexGraph } from '../../../src/workspace2/canvas/graph-index';
import { portLabel } from '../../../src/workspace2/canvas/blocks';
import { groceryGraph, groceryObservations } from './grocery-fixture';

const params = new URLSearchParams(location.search);
const fixture = params.get('fixture');
const literal = (value: string | number): Json => ({ type: 'literal', value });
const warm: Json = { type: 'choose', cases: [{ when: { type: 'all', of: [
  { type: 'compare', op: 'above', left: { type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [literal(23.6), literal(25)] }, literal(2)] }, right: literal(24) },
  { type: 'compare', op: 'eq', left: literal('closed'), right: literal('closed') },
] }, then: literal('Too warm') }], otherwise: literal('') };
const warmPositions: Readonly<Record<string, { x: number; y: number }>> = {
  '': { x: 1174, y: 180 }, '/cases/0/when': { x: 944, y: 240 }, '/cases/0/when/of/0': { x: 714, y: 80 },
  '/cases/0/when/of/0/left': { x: 484, y: 24 }, '/cases/0/when/of/0/left/args/0': { x: 254, y: 24 },
  '/cases/0/when/of/0/left/args/0/args/0': { x: 24, y: 24 }, '/cases/0/when/of/0/left/args/0/args/1': { x: 24, y: 130 },
  '/cases/0/when/of/0/left/args/1': { x: 254, y: 220 }, '/cases/0/when/of/0/right': { x: 484, y: 230 },
  '/cases/0/when/of/1': { x: 714, y: 430 }, '/cases/0/when/of/1/left': { x: 484, y: 430 }, '/cases/0/when/of/1/right': { x: 484, y: 540 },
  '/cases/0/then': { x: 944, y: 500 }, '/otherwise': { x: 944, y: 620 },
};
const ast: Json = fixture === 'large' ? largeGraphFlow()
  : fixture === 'summary' ? { type: 'all', of: [{ type: 'viewer', isAdmin: true }, { type: 'viewer-person', in: ['home'] }, { type: 'not', of: { type: 'state', sourceId: 'light', path: ['state'], in: ['off'] } }] }
  : fixture === 'warm' || fixture === 'observations' ? warm
  : fixture === 'meter' ? choose
  : fixture === 'meter-refusal' ? refusedChoose
  : { type: 'math', op: 'add', args: [{ type: 'literal', value: 21 }, { type: 'literal', value: 3 }] };
function Harness() {
  const followed = useStudioTheme(true);
  const theme = params.get('theme') === 'custom' ? deriveTheme({
    '--primary-background-color': '#f4edf9', '--card-background-color': '#fcf8ff', '--primary-text-color': '#342447',
    '--secondary-text-color': '#806c8f', '--primary-color': '#8665a6', '--ha-card-border-radius': '16px',
  }, false) : followed;
  const [closed, setClosed] = useState(false), [writes, setWrites] = useState(0);
  const graph = useMemo(() => {
    if (fixture === 'w3') return groceryGraph();
    const graph = arrangeCanvas(lift(ast, { kind: fixture === 'large' ? 'flow' : fixture === 'summary' ? 'condition' : 'operand', anchor }).graph);
    return fixture !== 'warm' && fixture !== 'observations' ? graph : { ...graph, nodes: graph.nodes.map(node => {
      const position = warmPositions[node.origins[0]];
      if (!position) throw new Error(`Missing authored fixture position: ${node.origins[0]}`);
      return { ...node, position };
    }) };
  }, []);
  const lookup = useMemo(() => {
    if (fixture !== 'large') return undefined;
    const start = performance.now(), index = indexGraph(graph);
    let ports = 0;
    for (const node of graph.nodes) for (const port of node.inputs) {
      index.source(node.id, port.id); index.edges(node.id, port.id, 'input'); portLabel(port.id, node, graph, index); ports++;
    }
    return { milliseconds: performance.now() - start, ports };
  }, [graph]);
  const host = useMemo<CanvasHostWithObservations>(() => {
    let snapshot: CanvasSnapshot = { document: ast, revision: '1' };
    return {
      snapshot: () => snapshot, open: () => {}, openOutput: () => {}, compareConflict: () => {}, uses: () => [], preview: () => {},
      data: { sources: [{ id: 'light', name: 'Hallway Light' }] }, targetCapabilities: [...new Set([...supportedCompositionCapabilities, ...blockCatalog.flatMap(entry => entry.capabilities)])],
      ...(fixture === 'observations' ? { observations: observationFixture(graph) } : {}),
      ...(fixture === 'w3' ? { observations: groceryObservations(graph) } : {}),
      apply: async transaction => {
        if (params.get('conflict')) return { status: 'conflict', remote: { document: ast, revision: 'remote-2' } };
        snapshot = { document: transaction.replacements[0].ast, revision: String(Number(snapshot.revision) + 1) };
        setWrites(count => count + 1); return { status: 'applied', snapshot };
      },
      save: async () => ({ status: 'saved', snapshot }),
    };
  }, []);
  if (closed) return <p>Canvas closed. Draft writes: {writes}</p>;
  return <>{lookup && <output hidden aria-label="Large canvas lookup performance" data-milliseconds={lookup.milliseconds} data-ports={lookup.ports} data-nodes={graph.nodes.length}/>}
    <FlowCanvas host={host} graph={graph} theme={theme} title={fixture === 'w3' ? 'Grocery rows (host-observation fixture)' : fixture === 'large' ? 'Large graph: 2,341 blocks' : fixture === 'summary' ? 'Hallway Light' : fixture === 'observations' ? 'Too Warm Warning (observation fixture)' : fixture === 'warm' ? 'Too Warm Warning' : 'Temperature Offset'} outputNames={[fixture === 'summary' ? 'Visible When' : 'Subtitle']} onClose={() => setClosed(true)}/></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
