import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { lift, type CanvasHost, type CanvasSnapshot } from '../../../src/shared/composition/graph';
import FlowCanvas, { arrangeCanvas, LimitsMeter } from '../../../src/workspace2/canvas/FlowCanvas';
import { useStudioTheme } from '../../../src/workspace2/useStudioTheme';
import { canvasTheme } from '../../../src/workspace2/canvas/theme';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, choose, observedFixture } from './fixtures';
import { blockCatalog } from '../../../src/shared/composition/graph/catalog';
import type { CSSProperties } from 'react';
import type { Json } from '../../../src/shared/types';

const params = new URLSearchParams(location.search);
const fixture = params.get('fixture');
const ast: Json = fixture === 'summary' ? { type: 'all', of: [{ type: 'viewer', isAdmin: true }, { type: 'viewer-person', in: ['home'] }] }
  : { type: 'math', op: 'add', args: [{ type: 'literal', value: 21 }, { type: 'literal', value: 3 }] };
function Harness() {
  const followed = useStudioTheme(true);
  const theme = params.get('theme') === 'custom' ? deriveTheme({
    '--primary-background-color': '#f4edf9', '--card-background-color': '#fcf8ff', '--primary-text-color': '#342447',
    '--secondary-text-color': '#806c8f', '--primary-color': '#8665a6', '--ha-card-border-radius': '16px',
  }, false) : followed;
  const [closed, setClosed] = useState(false), [writes, setWrites] = useState(0);
  const graph = useMemo(() => arrangeCanvas(lift(ast, { kind: fixture === 'summary' ? 'condition' : 'operand', anchor }).graph), []);
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
  if (fixture === 'meter') return <main className="w2-canvas" style={{ ...theme.variables, ...canvasTheme(theme) } as CSSProperties}>
    <header className="w2-canvas-header"><h1>Compiler-derived fixture: 52 expression nodes, 17 predicates</h1></header>
    <p>Test fixture only. Captured from the real checker observer, not production graph accounting.</p><LimitsMeter budgets={[observedFixture(choose, 'operand')]}/>
  </main>;
  return closed ? <p>Canvas closed. Draft writes: {writes}</p> : <FlowCanvas host={host} graph={graph} theme={theme} title={fixture === 'summary' ? 'Hallway Light' : 'Temperature Offset'} onClose={() => setClosed(true)}/>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
