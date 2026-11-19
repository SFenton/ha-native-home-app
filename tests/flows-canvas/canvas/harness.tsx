import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { lift, type CanvasHost, type CanvasSnapshot } from '../../../src/shared/composition/graph';
import FlowCanvas, { arrangeCanvas, CanvasDialog } from '../../../src/workspace2/canvas/FlowCanvas';
import Inspector from '../../../src/workspace2/canvas/Inspector';
import { useStudioTheme } from '../../../src/workspace2/useStudioTheme';
import { canvasTheme } from '../../../src/workspace2/canvas/theme';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, choose, observedFixture } from './fixtures';
import { blockCatalog } from '../../../src/shared/composition/graph/catalog';
import type { CSSProperties } from 'react';
import type { Json } from '../../../src/shared/types';

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
const ast: Json = fixture === 'summary' ? { type: 'all', of: [{ type: 'viewer', isAdmin: true }, { type: 'viewer-person', in: ['home'] }] }
  : fixture === 'warm' ? warm
  : fixture === 'meter' ? choose
  : { type: 'math', op: 'add', args: [{ type: 'literal', value: 21 }, { type: 'literal', value: 3 }] };
function Harness() {
  const followed = useStudioTheme(true);
  const theme = params.get('theme') === 'custom' ? deriveTheme({
    '--primary-background-color': '#f4edf9', '--card-background-color': '#fcf8ff', '--primary-text-color': '#342447',
    '--secondary-text-color': '#806c8f', '--primary-color': '#8665a6', '--ha-card-border-radius': '16px',
  }, false) : followed;
  const [closed, setClosed] = useState(false), [writes, setWrites] = useState(0);
  const graph = useMemo(() => {
    const graph = arrangeCanvas(lift(ast, { kind: fixture === 'summary' ? 'condition' : 'operand', anchor }).graph);
    return fixture !== 'warm' ? graph : { ...graph, nodes: graph.nodes.map(node => {
      const position = warmPositions[node.origins[0]];
      if (!position) throw new Error(`Missing authored fixture position: ${node.origins[0]}`);
      return { ...node, position };
    }) };
  }, []);
  const host = useMemo<CanvasHost>(() => {
    let snapshot: CanvasSnapshot = { document: ast, revision: '1' };
    return {
      snapshot: () => snapshot, open: () => {}, openOutput: () => {}, compareConflict: () => {}, uses: () => [], preview: () => {},
      data: { sources: [{ id: 'light', name: 'Hallway Light' }] }, targetCapabilities: [...new Set(blockCatalog.flatMap(entry => entry.capabilities)), 'sh.operands@1', 'sh.conditions@1'],
      apply: async transaction => {
        if (params.get('conflict')) return { status: 'conflict', remote: { document: ast, revision: 'remote-2' } };
        snapshot = { document: transaction.replacements[0].ast, revision: String(Number(snapshot.revision) + 1) };
        setWrites(count => count + 1); return { status: 'applied', snapshot };
      },
      save: async () => ({ status: 'saved', snapshot }),
    };
  }, []);
  const meterInspector = <Inspector graph={graph} node={graph.nodes.find(node => node.catalogKey === 'operand.literal.number') ?? graph.nodes[0]} host={host} budgets={[...(fixture === 'meter' ? [observedFixture(choose, 'operand')] : [])]} outputNames={['Subtitle']} send={() => {}} close={() => setClosed(true)} locate={() => {}} move={() => {}} remove={() => {}} onLocate={() => {}}/>;
  if (closed) return <p>Canvas closed. Draft writes: {writes}</p>;
  if (fixture === 'meter') return <div className="w2-canvas" style={{ ...theme.variables, ...canvasTheme(theme), colorScheme: theme.dark ? 'dark' : 'light' } as CSSProperties}>
    <header className="w2-canvas-header"><div><h1>Subtitle · Compiler accounting fixture</h1><small>52 steps from one real checker pass. No simulation.</small></div></header>
    <div className="w2-canvas-work"><main className="w2-canvas-main"><div className="w2-canvas-viewport"><div className="w2-canvas-connections"><h2>Fixture, not production accounting</h2><p>The inspector renders accounting captured from the compiler observer. Production stays unavailable until #28 is integrated; this fixture does not inject counters into FlowCanvas.</p><p>One If / Otherwise, 16 comparisons in All Of, and literal branches. Accepted by the compiler.</p></div></div></main>
      {window.matchMedia('(max-width: 599px)').matches ? <CanvasDialog title="Block inspector" sheet theme={theme} close={() => setClosed(true)}>{meterInspector}</CanvasDialog> : meterInspector}
    </div>
  </div>;
  return <FlowCanvas host={host} graph={graph} theme={theme} title={fixture === 'summary' ? 'Hallway Light' : fixture === 'warm' ? 'Too Warm Warning' : 'Temperature Offset'} outputNames={['Subtitle']} onClose={() => setClosed(true)}/>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
