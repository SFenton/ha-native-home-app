import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, List, Play, X } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { canonicalCompositionJSON } from '../../shared/composition/json';
import type { GraphNode, SimulationCase, SimulationClock, SimulationPin } from '../../shared/composition/graph/types';
import { allocateGraphId } from '../../shared/composition/graph/recipes';
import { Field, TextField } from '../../ui';
import { Overlay, Tag, useNarrow } from '../kit';
import { captureScenario, mergePins, runAll, runSimulation, type ScenarioResult } from './engine';
import { anchorKey, caseSchema, parseScenarios, pinSchema, readKey, sourceKey, STORE_COUNT } from './contracts';
import { pinProblems, simulationInputs, simulationPort, sourceCaptureForNode, type SimulationProgram } from './program';
import { loadScenarios, saveScenarios } from './storage';
import { sharedFlowRequests, useSimulationSnapshot, type FlowState } from './live';
import { SimulationFlowBridges } from './BridgeOwner';
import { SimulationDrawers } from './Drawers';
import { ClockInspector, SourceInspector, type PinChoice } from './Inspector';
import { ScenariosDrawer } from './Scenarios';
import { canvasObservations, formatObservedValue, type CanvasObservations } from './observations';
import { changedAgo, clockInstant, displayValue, type SimulationPresentation, type ValuePresentation } from './presentation';
import './simulation.css';
import { nodeValueOptions } from '../canvas/value-format';

export interface SimulationHostProps {
  readonly program: SimulationProgram;
  readonly document: Pick<CompositionDocument, 'id' | 'dataSources'>;
  readonly canvasId: string;
  readonly blockNames?: Readonly<Record<string, string>>;
  readonly presentation?: SimulationPresentation;
  readonly selectedBlockId?: string;
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onObservation?: (observations: CanvasObservations) => void;
  readonly liveClock?: SimulationClock;
  /** IANA zone matching liveClock. Required for home-clock editing; device defaults to the browser's zone. */
  readonly clockTimeZone?: string;
  readonly previousText?: SimulationCase['base']['previousText'];
  /** The existing connection owner supplies freshness; LiveHouse alone cannot detect transport failures. */
  readonly freshness?: { readonly stale: boolean; readonly error?: string };
  /** Pause live requests while this canvas is inactive. Unmount also retires its bridges. */
  readonly active?: boolean;
}
/** Mount inside WorkspaceDataProvider. A new canvas/document identity always opens Live. */
export function SimulationHost(props: SimulationHostProps) {
  return <HostSession key={`${props.document.id}:${props.canvasId}`} {...props} />;
}
function HostSession({ program, document, canvasId, blockNames = {}, presentation, selectedBlockId, onSelectBlock, onObservation, liveClock, clockTimeZone, previousText, freshness, active = true }: SimulationHostProps) {
  const narrow = useNarrow();
  const [loaded] = useState(() => loadScenarios(document.id, canvasId));
  const [scenarios, setScenarios] = useState<SimulationCase[]>(loaded.ok ? loaded.value : []);
  const [message, setMessage] = useState(loaded.ok ? '' : loaded.error);
  const [pins, setPins] = useState<SimulationPin[]>([]), [selectedCase, setSelectedCase] = useState<SimulationCase>();
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [clock, setClock] = useState<SimulationClock>();
  const [clockLive, setClockLive] = useState(false);
  const [flows, setFlows] = useState<Readonly<Record<string, FlowState>>>({});
  const [paused, setPaused] = useState(false), [simulating, setSimulating] = useState(false);
  const [selection, setSelection] = useState<string>(), [inspecting, setInspecting] = useState(false);
  const [pinChoice, setPinChoice] = useState<PinChoice>(), [numeric, setNumeric] = useState('25'), [state, setState] = useState('unavailable');
  const [pinText, setPinText] = useState(''), [pinStatus, setPinStatus] = useState('value');
  const [capture, setCapture] = useState(''), [captureName, setCaptureName] = useState('');
  const [results, setResults] = useState<readonly ScenarioResult[]>([]), [exchange, setExchange] = useState('');
  const [drawer, setDrawer] = useState<'scenarios' | 'evidence'>();
  const selected = selectedCase;
  const savedVersionDiffers = useMemo(() => {
    const saved = scenarios.find(scenario => scenario.id === selected?.id);
    return Boolean(selected && saved && canonicalCompositionJSON(saved) !== canonicalCompositionJSON(selected));
  }, [scenarios, selected]);
  const scenarioId = selected?.id ?? '';
  const scenario = useMemo(() => {
    const live = program.roots.flatMap(root => root.graph.nodes.filter(node => muted.has(node.id))).flatMap(node => {
      const source = sourceCaptureForNode(node, program); return source ? [sourceKey(source)] : [];
    });
    return selected ? { ...selected, pins: selected.pins.filter(pin => !muted.has(pin.blockId) && !(pin.kind === 'source' && live.includes(sourceKey(pin)))) } : undefined;
  }, [selected, muted, program]);
  const activePins = useMemo(() => mergePins(scenario?.pins ?? [], pins), [scenario, pins]);
  const snapshot = useSimulationSnapshot(program, document, flows, { clock: liveClock, previousText, ...freshness });
  const run = useMemo(() => runSimulation(program, snapshot, { scenario, pins, clock, liveClock: clockLive, liveBlocks: muted }), [program, snapshot, scenario, pins, clock, clockLive, muted]);
  const observation = useMemo(() => canvasObservations(program, run, {
    pins: activePins, localPins: pins, scenario, clockPinned: Boolean(!clockLive && (clock || scenario?.clock)), localClockPinned: Boolean(clock), liveClock: clockLive,
    freshness: snapshot.origin === 'sample' ? 'sample' : snapshot.stale ? 'held' : 'live', liveBlocks: muted, previousText: scenario?.base.previousText ?? snapshot.base.previousText, blockNames,
    clock: clockLive ? snapshot.base.clock : clock ?? scenario?.clock ?? scenario?.base.clock ?? snapshot.base.clock, timeZone: clockTimeZone,
  }), [program, run, activePins, pins, scenario, clock, clockLive, muted, snapshot.base.clock, snapshot.base.previousText, snapshot.origin, snapshot.stale, blockNames, clockTimeZone]);
  useEffect(() => onObservation?.(observation), [onObservation, observation]);
  const onRun = useCallback((ids: readonly string[], state: FlowState) => {
    setFlows(previous => {
      if (ids.every(id => previous[id]?.fingerprint === state.fingerprint
        && previous[id]?.run.answer === state.run.answer && previous[id]?.run.error === state.run.error && previous[id]?.run.running === state.run.running)) return previous;
      return { ...previous, ...Object.fromEntries(ids.map(id => [id, state])) };
    });
  }, []);
  const requests = useMemo(() => sharedFlowRequests(program), [program]);
  const enabled = active && run.mode === 'Live' && !paused && !simulating;
  const nodes = useMemo(() => [...new Map(program.roots.flatMap(root => root.graph.nodes).filter(node =>
    ['operand', 'condition', 'logic-ref', 'source-selection', 'step', 'request', 'slot'].includes(node.payload.kind)).map(node => [node.id, node])).values()], [program]);
  const inputNodes = nodes.filter(node => {
    const source = sourceCaptureForNode(node, program);
    return node.payload.kind !== 'source-selection' && source && program.reads.some(read => sourceKey(read) === sourceKey(source));
  });
  const uniqueInputs = simulationInputs(program, nodes);
  const editingPin = nodes.find(node => node.id === (selectedBlockId ?? selection)) ?? inputNodes[0] ?? nodes[0];
  const blockLabel = (node: GraphNode): ValuePresentation => presentation?.blocks?.[node.id] ?? { name: blockNames[node.id] ?? 'Value' };
  const outputLabel = (index: number): ValuePresentation => presentation?.outputs?.[anchorKey(program.roots[index].anchor)]
    ?? { name: program.roots[index].name === program.roots[index].anchor.id ? `Output ${index + 1}` : program.roots[index].name };
  const issueText = (issue: string) => {
    const read = program.reads.find(read => issue.includes(readKey(read)));
    if (read) {
      const node = inputNodes.find(node => { const source = sourceCaptureForNode(node, program); return source && sourceKey(source) === sourceKey(read); });
      return `Missing captured input: ${node ? blockLabel(node).name : 'a required value'}.`;
    }
    if (issue.startsWith('Unresolved')) return 'A pin points to a block or port that no longer exists. Edit the scenario before running.';
    const flowIndex = program.roots.findIndex(root => root.body.kind === 'flow' && issue.includes(root.body.sourceId));
    return flowIndex < 0 ? issue : issue.replace(program.roots[flowIndex].anchor.id, outputLabel(flowIndex).name);
  };
  const selectBlock = (node: GraphNode) => { setSelection(node.id); setPinChoice(undefined); setInspecting(true); setDrawer(undefined); onSelectBlock?.(node.id); };
  const stalePins = scenarios.flatMap(scenario => pinProblems(program, scenario.pins));
  const returnLive = () => {
    setPins([]); setSelectedCase(undefined); setMuted(new Set()); setClock(undefined); setClockLive(false); setPaused(false); setSimulating(false); setResults([]); setPinChoice(undefined);
    setMessage('Live restored. Saved scenarios were not changed.');
  };
  const selectScenario = (id: string) => {
    if (!id) { returnLive(); return; }
    setSelectedCase(scenarios.find(scenario => scenario.id === id)); setPins([]); setClock(undefined); setClockLive(false); setMuted(new Set()); setPaused(true); setSimulating(true); setPinChoice(undefined);
  };
  const persist = (next: SimulationCase[], action = 'Scenario changes') => {
    const saved = saveScenarios(document.id, canvasId, next);
    if (saved.ok) {
      setScenarios(next);
      setResults([]);
    }
    setMessage(saved.ok ? 'Scenarios saved in this browser.' : `${action} not saved. ${saved.error} The saved scenario list is unchanged.`);
    return saved.ok;
  };
  const saveCapture = () => {
    try {
      const candidate = caseSchema.parse(JSON.parse(capture));
      const updated = caseSchema.parse({ ...candidate, name: captureName });
      if (scenarios.length >= STORE_COUNT && !scenarios.some(scenario => scenario.id === updated.id)) throw new Error('A canvas can keep at most 20 scenarios. Delete one before saving.');
      if (persist([...scenarios.filter(scenario => scenario.id !== updated.id), updated])) { setCapture(''); setCaptureName(''); }
    } catch (error) { setMessage(error instanceof Error ? `Scenario not saved: ${error.message}` : 'Scenario data is invalid.'); }
  };
  const startCapture = (empty = false) => {
    try {
      const candidate = captureScenario(program, snapshot, {
        id: allocateGraphId('scenario', new Set(scenarios.map(scenario => scenario.id))),
        name: 'New scenario', pins: empty ? [] : activePins, clock: empty ? undefined : clockLive ? snapshot.base.clock : clock ?? scenario?.clock,
      });
      setCapture(JSON.stringify(candidate, null, 2)); setCaptureName(candidate.name);
      setMessage('Review the captured values before saving. Household states may be personal.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Capture failed.'); }
  };
  const pin = () => {
    if (!editingPin) return;
    try {
      const source = sourceCaptureForNode(editingPin, program), port = editingPin.outputs[0], type = simulationPort(program, editingPin)!;
      let candidate: SimulationPin;
      const json: unknown = pinChoice === 'number' ? Number(numeric) : pinChoice === 'state' ? state : pinStatus === 'value' ? JSON.parse(pinText) : undefined;
      if (pinChoice === 'number' && (!numeric.trim() || !Number.isFinite(json))) throw new Error('Enter a finite number.');
      if (source) {
        const answer = pinChoice === 'number' || pinChoice === 'state' || pinStatus === 'value' ? { status: 'value' as const, value: json } : { status: pinStatus };
        const rawState = source.access === 'raw-state' || source.path?.length === 1 && source.path[0] === 'state';
        const raw = rawState && answer.status === 'value' && typeof answer.value === 'number' ? { status: 'value', value: String(answer.value) } : answer;
        candidate = pinSchema.parse({ kind: 'source', blockId: editingPin.id, ...source, answer: raw });
      } else {
        candidate = pinSchema.parse({ kind: 'output', blockId: editingPin.id, portId: port.id,
          result: type.representation === 'condition' ? { kind: 'condition', answer: json }
            : { kind: 'operand', answer: pinStatus === 'value' ? { status: 'value', value: json } : { status: pinStatus } } });
      }
      const errors = pinProblems(program, [candidate]);
      if (errors.length) throw new Error(errors.join(' '));
      setPins(previous => mergePins(previous, [candidate])); setPaused(true); setSimulating(true);
      setMessage(`${blockLabel(editingPin).name} pinned. No device was operated.`);
    } catch (error) { setMessage(error instanceof Error ? `Pin not applied: ${error.message}` : 'Pin data is invalid.'); }
  };
  const source = editingPin ? sourceCaptureForNode(editingPin, program) : undefined;
  const clockZone = [...program.flows.values()][0]?.clock?.zone ?? 'device';
  const sourceCapture = source ? snapshot.base.reads.find(read => sourceKey(read) === sourceKey(source)) : undefined;
  const inherited = source ? scenario?.pins.find(pin => pin.kind === 'source' && sourceKey(pin) === sourceKey(source)) : undefined;
  const local = source ? pins.find(pin => pin.kind === 'source' && sourceKey(pin) === sourceKey(source)) : pins.find(pin => pin.blockId === editingPin?.id);
  const choice: PinChoice = pinChoice ?? (local ? local.kind === 'source' && local.answer.status === 'value' && Number.isFinite(Number(local.answer.value)) ? 'number' : source ? 'state' : 'typed' : scenario && !muted.has(editingPin?.id ?? '') ? 'scenario' : 'live');
  const inspector = editingPin && <>
    <header className="w2-props-head"><span className="w2-props-icon"><FlaskConical size={20} aria-hidden /></span>
      <div className="w2-props-titles"><h2>{blockLabel(editingPin).name}</h2><p>Block · {source ? 'From Home' : 'Computed value'}</p></div>
      {narrow && <button type="button" className="w2-primary" onClick={() => setInspecting(false)}>Done</button>}
    </header>
    <SourceInspector name={blockLabel(editingPin).name} presentation={blockLabel(editingPin)} source={Boolean(source)} choice={choice}
      live={`${sourceCapture ? displayValue({ kind: 'operand', answer: sourceCapture.answer }, blockLabel(editingPin), undefined, { ...nodeValueOptions(editingPin), clock: snapshot.base.clock, timeZone: clockTimeZone }) : 'Not observed'} · ${changedAgo(blockLabel(editingPin).changedAt, clockInstant(snapshot.base.clock))}`}
      scenario={scenario ? { name: scenario.name, value: inherited?.kind === 'source' ? displayValue({ kind: 'operand', answer: inherited.answer }, blockLabel(editingPin), undefined, { ...nodeValueOptions(editingPin), clock: scenario.clock ?? scenario.base.clock, timeZone: clockTimeZone }) : 'Captured live value' } : undefined}
      onChoice={value => {
        setPinChoice(value);
        if (value !== 'live' && value !== 'scenario') return;
        setPins(previous => previous.filter(pin => pin.blockId !== editingPin.id && !(source && pin.kind === 'source' && sourceKey(pin) === sourceKey(source))));
        setMuted(previous => { const next = new Set(previous); if (value === 'live') next.add(editingPin.id); else next.delete(editingPin.id); return next; });
      }} numeric={numeric} onNumeric={setNumeric} state={state} onState={setState} typed={pinText} onTyped={setPinText} status={pinStatus} onStatus={setPinStatus} onApply={pin} />
    <ClockInspector live={snapshot.base.clock} clock={clockLive ? undefined : clock ?? scenario?.clock} zone={clockZone}
      timeZone={clockTimeZone ?? (clockZone === 'device' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)}
      onClock={value => { setClock(value); setClockLive(!value); if (value) { setPaused(true); setSimulating(true); } }} onError={setMessage} />
    <section className="sec w2-group w2-sim-trace" aria-label="Evaluation trace">
      <h3 className="w2-group-title">Trace · in the order the app works it out</h3>
      <div className="w2-sim-trace-chips">{observation.order.map(id => {
        const block = observation.blocks[id], node = nodes.find(node => node.id === id);
        if (!node || !block?.observed || presentation?.traceBlocks && !presentation.traceBlocks.includes(id)) return null;
        return <button type="button" className={`w2-sim-trace-chip${block.pinned ? ' pinned' : ''}`} aria-description={formatObservedValue(block, false, true)}
          key={id} onClick={() => selectBlock(node)}>{blockLabel(node).traceName ?? blockLabel(node).name} <strong>{block.kept ? 'kept' : node.payload.kind === 'operand' && node.payload.value.type === 'literal' ? formatObservedValue(block) : displayValue(block.result, blockLabel(node), block)}</strong></button>;
      })}</div>
      {observation.truncated && <p className="w2-caption">Trace truncated. Unrecorded values are not evidence.</p>}
      <div className="w2-sim-actions"><button type="button" onClick={() => { setInspecting(false); setDrawer('evidence'); }}>Each Run &amp; Items</button></div>
    </section>
  </>;
  return <section className="w2-scope w2-simulation w2-simulation-surface" aria-label="Flow simulation">
    <SimulationFlowBridges requests={requests} enabled={enabled} onRun={onRun} />
    <header className="w2-sim-toolbar">
      <div className="w2-sim-heading"><FlaskConical size={18} aria-hidden /><h2>Simulation</h2><span className="w2-caption">Studio only · no device controls</span></div>
      <div className="w2-sim-toolbar-cluster">
        <div className="w2-segment-pill" role="group" aria-label="Simulation mode">
          <button type="button" aria-pressed={!simulating && run.mode === 'Live'} onClick={returnLive}><span className="w2-sim-live-dot" />Live</button>
          <button type="button" aria-pressed={simulating || run.mode === 'Simulated'} onClick={() => { setSimulating(true); setPaused(true); }}>Simulated</button>
        </div>
        {(scenario || activePins.length > 0) && <Tag className="tag pinned"><FlaskConical size={12} aria-hidden />{scenario?.name ?? `${activePins.length} pinned`}{run.modified || muted.size ? ' · Modified' : ''}</Tag>}
        <button type="button" className="w2-tonal" onClick={() => { setInspecting(false); setDrawer('scenarios'); }}><FlaskConical size={15} aria-hidden />Scenarios</button>
      </div>
    </header>
    {(snapshot.stale || snapshot.error) && <p role="note" className="w2-sim-notice">Waiting for Home Assistant.{run.outputs.some(output => output.source === 'Held/stale') && ' Showing the last values.'}{snapshot.error && <> {snapshot.error}</>}</p>}
    {run.issues.length > 0 && <p role="alert" className="w2-sim-notice">{run.issues.map(issueText).join(' ')}</p>}
    <p role="status" aria-live="polite" className="w2-sim-status">{message}</p>
    {savedVersionDiffers && drawer !== 'scenarios' && <p role="note" className="w2-sim-notice">Saved version differs. Reselect to apply.</p>}
    <div className="w2-sim-body">
      <main className="w2-sim-values-area">
        <section className="sec w2-group" aria-label="Just the Values">
          <h3 className="w2-group-title"><List size={15} aria-hidden />Just the Values</h3>
          <p className="w2-caption">The preview is a lens. These are the actual outputs, not device actions.{scenario ? ' Unpinned Live values are frozen at capture.' : ''}</p>
          <div className="w2-sim-values">{run.outputs.map((output, index) => <article className="kv2" key={anchorKey(output.output)} aria-label={`Output ${outputLabel(index).name}`}>
            <span>{outputLabel(index).name}</span><output title={formatObservedValue(observation.results?.[program.roots[index].graph.roots[0].nodeId], false, true)}>{program.roots[index].body.kind === 'operand' && program.roots[index].body.value.type === 'literal' ? formatObservedValue(observation.results?.[program.roots[index].graph.roots[0].nodeId]) : displayValue(output.result, outputLabel(index), observation.results?.[program.roots[index].graph.roots[0].nodeId])}</output>
            <Tag className={`tag ${output.source === 'Live' ? 'live' : output.source === 'Pinned' ? 'pinned' : ''}`} tone={output.source === 'Live' ? 'success' : 'neutral'} title={output.source === 'Scenario' ? 'Live at capture, not a fresh network read' : undefined}>{output.source === 'Scenario' ? 'Live' : output.source === 'Held/stale' ? 'Last value kept' : output.source === 'Sample' ? 'Demo' : output.source}</Tag>
            {output.issues.length > 0 && <p className="w2-caption">{output.issues.map(issueText).join(' ')}</p>}
          </article>)}</div>
        </section>
        <section className="sec w2-group" aria-label="Block sources">
          <h3 className="w2-group-title">Inputs</h3>
          <div className="w2-sim-values">{uniqueInputs.map(node => {
            const block = observation.blocks[node.id];
            return <div key={node.id} className="kv2"><button type="button" className="w2-link-button" aria-label={`Inspect ${blockLabel(node).name}`} onClick={() => selectBlock(node)}>{blockLabel(node).name}</button>
              <span>{displayValue(block?.result, blockLabel(node), block)}</span><Tag className={`tag ${block?.pinned ? 'pinned' : block?.freshness === 'live' ? 'live' : ''}`} tone={block?.freshness === 'live' && !block?.pinned ? 'success' : 'neutral'} title={block?.freshness === 'captured' && !block.pinned ? 'Live at capture' : undefined}>{block?.pinned ? 'Pinned' : block?.freshness === 'held' ? 'Last value kept' : block?.freshness === 'sample' ? 'Demo' : 'Live'}</Tag></div>;
          })}</div>
          <details className="w2-sim-details"><summary>Other blocks</summary><div className="w2-sim-block-list">{nodes.filter(node => !sourceCaptureForNode(node, program)).map(node => <button type="button" key={node.id} onClick={() => selectBlock(node)}>{blockLabel(node).name}</button>)}</div></details>
          <p className="w2-caption">Select a value to inspect its source, pin it, or try a scenario.</p>
        </section>
        <div className="w2-sim-actions w2-group"><button type="button" onClick={() => setDrawer('evidence')}><Play size={14} aria-hidden />Each Run &amp; Items</button></div>
      </main>
      {!narrow && <aside className="w2-sim-inspector w2-form" aria-label="Simulation inspector">{inspector}</aside>}
    </div>
    {narrow && <Overlay narrow open={inspecting} onOpenChange={setInspecting} label="Simulation inspector" className="w2-simulation-surface w2-form">{inspector}</Overlay>}
    <ScenariosDrawer open={drawer === 'scenarios'} onClose={() => setDrawer(undefined)} program={program} scenarios={scenarios} snapshot={snapshot} timeZone={clockTimeZone}
      selectedId={scenarioId} savedVersionDiffers={savedVersionDiffers} run={run} results={results} inputNodes={uniqueInputs.filter(node => !presentation?.scenarioInputs || presentation.scenarioInputs.includes(node.id))} blockLabel={blockLabel} outputLabel={outputLabel}
      outputKeys={presentation?.scenarioOutputs}
      onSelect={selectScenario} onCapture={() => startCapture()} onCreate={() => startCapture(true)} blocked={stalePins.length > 0}
      onRunAll={() => { setPaused(true); setSimulating(true); setResults(runAll(program, scenarios, snapshot)); setMessage('Run All complete. No network reads or device writes.'); }}
      onEdit={scenario => { setCaptureName(scenario.name); setCapture(JSON.stringify(scenario, null, 2)); }}
      onDelete={scenario => { persist(scenarios.filter(candidate => candidate.id !== scenario.id), `Deletion of "${scenario.name}"`); }}>
      {stalePins.length > 0 && <p role="alert" className="w2-sim-notice">Unresolved pins block Run All. {stalePins.map(issueText).join(' ')}</p>}
      {capture && <fieldset className="w2-sim-review w2-form">
        <legend>Review scenario before saving</legend><p className="w2-caption">Household states may be personal. Stored only in this browser; never in draft or native exports.</p>
        <TextField label="Scenario name" value={captureName} onChange={setCaptureName} />
        <details><summary>Captured values and expectations</summary><Field label="Scenario data (JSON)"><textarea aria-label="Scenario data (JSON)" rows={10} value={capture} onChange={event => setCapture(event.target.value)} /></Field>
          <p className="w2-caption">Previous-text seeds are separate base.previousText entries. Numeric tolerance is explicit.</p></details>
        <div className="w2-sim-actions"><button type="button" className="w2-primary" onClick={saveCapture}>Save scenario</button><button type="button" onClick={() => setCapture('')}>Discard capture</button></div>
      </fieldset>}
      <details className="w2-sim-exchange"><summary>Import or export scenarios</summary><Field label="Scenario exchange JSON"><textarea aria-label="Scenario exchange JSON" rows={6} value={exchange} onChange={event => setExchange(event.target.value)} /></Field>
        <div className="w2-sim-actions"><button type="button" onClick={() => { setExchange(JSON.stringify({ version: 1, scenarios }, null, 2)); setMessage('Export prepared. This contains personal captured values, not configuration.'); }}>Prepare export</button>
          <button type="button" onClick={() => { try { const imported = parseScenarios(exchange); if (persist(imported, 'Import')) setMessage('Scenarios imported. Active simulation was not changed.'); } catch (error) { setMessage(error instanceof Error ? `Import refused: ${error.message}` : 'Import refused.'); } }}>Import scenarios (replace browser list)</button></div>
      </details>
    </ScenariosDrawer>
    <Overlay narrow open={drawer === 'evidence'} onOpenChange={open => { if (!open) setDrawer(undefined); }} label="Run evidence" className="w2-simulation-surface">
      <header className="w2-sim-drawer-head"><h2>Run evidence</h2><button type="button" className="w2-icon-button" aria-label="Close Run evidence" onClick={() => setDrawer(undefined)}><X size={18} aria-hidden /></button></header>
      <SimulationDrawers outputs={run.outputs} program={program} presentation={presentation} blockNames={blockNames} />
    </Overlay>
  </section>;
}
