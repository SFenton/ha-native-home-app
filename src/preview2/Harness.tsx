import { useEffect, useMemo, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { demoHouse } from './demo-house';
import type { SelectionKey } from './model';
import Preview2, { previewWindows, type PreviewSurface } from './Preview2';
import { emptyOverlay, type Overlay } from './projections';

/**
 * A story page for the 2.0 preview, mounted only in development at `/?preview2=1` until the workspace shell hosts it. It
 * loads the `home-domains` fixture and offers the mode, the surface and the bezel as query parameters:
 * `?preview2=1&mode=use&surface=page:page-home&bezel=0&select=node:hc-chip-0`.
 */
export default function Harness() {
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const [document, setDocument] = useState<CompositionDocument>();
  const [mode, setMode] = useState<'edit' | 'use'>(query.get('mode') === 'use' ? 'use' : 'edit');
  const [selection, setSelection] = useState<SelectionKey | undefined>((query.get('select') ?? undefined) as SelectionKey | undefined);
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const [log, setLog] = useState<string[]>([]);
  const first = query.get('surface')?.split(':');
  const [surface, setSurface] = useState<PreviewSurface | undefined>(first ? { kind: first[0] as 'page' | 'modal', id: first.slice(1).join(':') } : undefined);
  useEffect(() => { void import('../../tests/fixtures/home-domains.json').then(module => setDocument((module.default as { document: CompositionDocument }).document)); }, []);
  const house = useMemo(() => document ? demoHouse(document) : undefined, [document]);
  if (!document || !house) return <p>Loading the fixture…</p>;
  const shown = surface ?? { kind: 'page' as const, id: document.navigation.initialPageId };
  const bezel = query.get('bezel') !== '0';
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', height: '100vh', background: '#e9eaee', font: '13px system-ui' }}>
    <div style={{ minWidth: 0, minHeight: 0, ['--studio-selection' as string]: '#03a9f4' }} data-testid="preview2-host"><Preview2 document={document} mode={mode} surface={shown} onSurfaceChange={setSurface}
      selection={selection} onSelect={setSelection} window={previewWindows[0]} bezel={bezel} house={house} overlay={overlay} onOverlayChange={setOverlay}
      onSimulatedCall={summary => setLog(old => [...old, summary])}/></div>
    <aside style={{ padding: 12, overflow: 'auto' }}>
      <button onClick={() => setMode(mode === 'edit' ? 'use' : 'edit')}>Mode: {mode}</button>
      <p data-testid="surface">{shown.kind}:{shown.id}</p><p data-testid="selection">{selection ?? 'none'}</p>
      <ol data-testid="log">{log.map((line, i) => <li key={i}>{line}</li>)}</ol>
    </aside>
  </div>;
}
