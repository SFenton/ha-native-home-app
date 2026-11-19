import { useEffect, useMemo, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { demoHouse } from './demo-house';
import { asksStory } from './fixtures/asks-story';
import { deviceHouse } from './fixtures/device-house';
import { fakePicture } from './fixtures/fake-picture';
import { fidcamlistsStory } from './fixtures/fidcamlists-story';
import { fidtilesStory } from './fixtures/fidtiles-story';
import { fidpanelsStory } from './fixtures/fidpanels-story';
import { tilecontractStory } from './fixtures/tilecontract-story';
import { simfixStory } from './fixtures/simfix-story';
import { mapctlStory, mapctlScenarios, type MapctlScenario } from './fixtures/mapctl-story';
import { wgchartStory } from './fixtures/wgchart-story';
import { wgstyleStory } from './fixtures/wgstyle-story';
import { wgflowRecords, wgflowStory } from './fixtures/wgflow-story';
import { wgchartflowStory } from './fixtures/wgchartflow-story';
import { wgdialStory } from './fixtures/wgdial-story';
import type { SelectionKey } from './model';
import Preview2, { previewWindows, type PreviewSurface } from './Preview2';
import { useAppearance } from '../workspace2/appearance';
import { emptyOverlay, type Overlay } from './projections';

/**
 * A story page for the 2.0 preview, mounted only in development at `/?preview2=1` until the workspace shell hosts it. It
 * loads the `home-domains` fixture (`fixture=devices` loads `device-controls` over its own house; any other `fixture=<name>` loads that
 * document of the contract corpus, for the node types the home fixture lacks) and offers the mode, the surface and the bezel as query parameters:
 * `?preview2=1&mode=use&surface=page:page-home&bezel=0&select=node:hc-chip-0`; `window=<name>` picks a device window by its name (`Duo open, sideways`). `ink=muted` draws the grey tile ink of an app that predates `sh.tile-ink-default@1` and `ink=primary` the primary ink; absent, the shipped default in `tile-ink-gate.ts` draws primary ink.
 */
export default function Harness() {
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const studioAppearance = useAppearance();
  const [document, setDocument] = useState<CompositionDocument>();
  const [mode, setMode] = useState<'edit' | 'use'>(query.get('mode') === 'use' ? 'use' : 'edit');
  const [selection, setSelection] = useState<SelectionKey | undefined>((query.get('select') ?? undefined) as SelectionKey | undefined);
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const [log, setLog] = useState<string[]>([]);
  const first = query.get('surface')?.split(':');
  const [surface, setSurface] = useState<PreviewSurface | undefined>(first ? { kind: first[0] as 'page' | 'modal', id: first.slice(1).join(':') } : undefined);
  const devices = query.get('fixture') === 'devices';
  const asks = useMemo(() => query.get('fixture') === 'asks' ? asksStory(query.get('plain') === '1') : undefined, [query]);
  const simfix = useMemo(() => query.get('fixture') === 'simfix' ? simfixStory() : undefined, [query]);
  const fidtiles = useMemo(() => query.get('fixture') === 'fidtiles' ? fidtilesStory() : query.get('fixture') === 'tilecontract' ? tilecontractStory() : undefined, [query]);
  const [mapctlBase, setMapctlBase] = useState<CompositionDocument>();
  useEffect(() => { if (query.get('fixture') === 'mapctl' || query.get('fixture') === 'fidcamlists') void import('./fixtures/home-domains.json').then(module => setMapctlBase(module.default.document as unknown as CompositionDocument)); }, [query]);
  const mapctl = useMemo(() => mapctlBase && query.get('fixture') === 'mapctl' ? mapctlStory(mapctlBase, mapctlScenarios.find(item => item === query.get('scenario')) as MapctlScenario | undefined) : undefined, [query, mapctlBase]);
  const fidcamlists = useMemo(() => query.get('fixture') === 'fidcamlists' && mapctlBase ? fidcamlistsStory(mapctlBase) : undefined, [query, mapctlBase]);
  const fidpanels = useMemo(() => query.get('fixture') === 'fidpanels' ? fidpanelsStory() : undefined, [query]);
  const wgstyle = useMemo(() => query.get('fixture') === 'wgstyle' ? wgstyleStory() : undefined, [query]);
  const wgflow = useMemo(() => query.get('fixture') === 'wgflow' ? wgflowStory() : undefined, [query]);
  const wgchartflow = useMemo(() => query.get('fixture') === 'wgchartflow' ? wgchartflowStory() : undefined, [query]);
  const wgchart = useMemo(() => query.get('fixture') === 'wgchart' ? wgchartStory() : undefined, [query]);
  const wgdial = useMemo(() => query.get('fixture') === 'wgdial' ? wgdialStory() : undefined, [query]);
  useEffect(() => {
    if (asks) { setDocument(asks.document); return; }
    if (simfix) { setDocument(simfix.document); return; }
    if (fidtiles) { setDocument(fidtiles.document); return; }
    if (mapctl) { setDocument(mapctl.document); return; }
    if (query.get('fixture') === 'fidcamlists') { if (fidcamlists) setDocument(fidcamlists.document); return; }
    if (wgstyle) { setDocument(wgstyle.document); return; }
    if (wgdial) { setDocument(wgdial.document); return; }
    if (fidpanels) { setDocument(fidpanels.document); return; }
    if (wgflow) { setDocument(wgflow.document); return; }
    if (wgchart) { setDocument(wgchart.document); return; }
    if (wgchartflow) { setDocument(wgchartflow.document); return; }
    const name = query.get('fixture');
    const corpus = import.meta.glob('../../contract/corpus/accept/*.json', { import: 'default' });
    const file = `../../contract/corpus/accept/${name}.json`;
    const load = devices ? import('./fixtures/device-controls.json').then(module => module.default)
      : name && corpus[file] ? corpus[file]() : import('./fixtures/home-domains.json').then(module => module.default);
    void Promise.resolve(load).then(module => setDocument((module as { document: CompositionDocument }).document));
  }, [query, devices, asks, simfix, fidtiles, mapctl, wgstyle, fidpanels, fidcamlists, wgflow, wgchart, wgchartflow, wgdial]);
  const house = useMemo(() => document ? wgdial ? wgdial.house : wgchartflow ? wgchartflow.house : wgchart ? wgchart.house : wgflow ? wgflow.house : fidcamlists ? fidcamlists.house : wgstyle ? wgstyle.house : fidpanels ? fidpanels.house : mapctl ? mapctl.house : simfix ? simfix.house : fidtiles ? fidtiles.house : asks ? asks.house : devices ? deviceHouse() : demoHouse(document) : undefined, [document, devices, asks, simfix, fidtiles, mapctl, wgstyle, fidpanels, fidcamlists, wgflow, wgchart, wgchartflow, wgdial]);
  if (!document || !house) return <p>Loading the fixture…</p>;
  const shown = surface ?? { kind: 'page' as const, id: document.navigation.initialPageId };
  const bezel = query.get('bezel') !== '0';
  return <div style={{ display: 'grid', gridTemplateColumns: query.get('panel') === '0' ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 280px', height: '100vh', background: '#e9eaee', font: '13px system-ui' }}>
    <div style={{ minWidth: 0, minHeight: 0, ['--studio-selection' as string]: '#03a9f4' }} data-testid="preview2-host"><Preview2 document={document} mode={mode} surface={shown} onSurfaceChange={setSurface}
      selection={selection} onSelect={setSelection} window={previewWindows.find(item => item.name === query.get('window')) ?? previewWindows[0]} bezel={bezel} appearance={studioAppearance === 'follow' ? undefined : studioAppearance} ink={query.get('ink') === 'primary' ? 'primary' : query.get('ink') === 'muted' ? 'muted' : undefined} house={house} overlay={overlay} onOverlayChange={setOverlay} mapPicture={query.get('picture') === 'fake' ? fakePicture : undefined}
      onSimulatedCall={summary => setLog(old => [...old, summary])} records={wgflow || wgchartflow ? wgflowRecords : undefined}/></div>
    {query.get('panel') !== '0' && <aside style={{ padding: 12, overflow: 'auto' }}>
      <button onClick={() => setMode(mode === 'edit' ? 'use' : 'edit')}>Mode: {mode}</button>
      <p data-testid="surface">{shown.kind}:{shown.id}</p><p data-testid="selection">{selection ?? 'none'}</p>
      <ol data-testid="log">{log.map((line, i) => <li key={i}>{line}</li>)}</ol>
    </aside>}
  </div>;
}
