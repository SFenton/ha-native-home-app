import { useCallback, useMemo, useState } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { GraphNode, SimulationCase, SimulationClock, SimulationPin } from '../../shared/composition/graph/types';
import { allocateGraphId } from '../../shared/composition/graph/recipes';
import { canonicalCompositionJSON } from '../../shared/composition/json';
import { captureScenario, mergePins, runAll, runSimulation, type ScenarioResult } from './engine';
import { anchorKey, caseSchema, clockSchema, parseScenarios, pinSchema, sourceKey, STORE_COUNT } from './contracts';
import { blockMode, blockSources, pinProblems, simulationPort, sourceCaptureForNode, type SimulationProgram } from './program';
import { loadScenarios, saveScenarios } from './storage';
import { sharedFlowRequests, SimulationFlowBridge, useSimulationSnapshot, type FlowState } from './live';
import { SimulationDrawers } from './Drawers';
import { resultText } from './words';
import './simulation.css';

export interface SimulationHostProps {
  readonly program: SimulationProgram;
  readonly document: Pick<CompositionDocument, 'id' | 'dataSources'>;
  readonly canvasId: string;
  readonly blockNames?: Readonly<Record<string, string>>;
  readonly liveClock?: SimulationClock;
  readonly previousText?: SimulationCase['base']['previousText'];
  /** The existing connection owner supplies freshness; LiveHouse alone cannot detect transport failures. */
  readonly freshness?: { readonly stale: boolean; readonly error?: string };
  /** Set false for a render before unmounting to release the existing shared live-run debounce. */
  readonly active?: boolean;
}
/** Mount inside WorkspaceDataProvider. A new canvas/document identity always opens Live. */
export function SimulationHost(props: SimulationHostProps) {
  return <HostSession key={`${props.document.id}:${props.canvasId}`} {...props} />;
}
function HostSession({ program, document, canvasId, blockNames = {}, liveClock, previousText, freshness, active = true }: SimulationHostProps) {
  const [loaded] = useState(() => loadScenarios(document.id, canvasId));
  const [scenarios, setScenarios] = useState<SimulationCase[]>(loaded.ok ? loaded.value : []);
  const [message, setMessage] = useState(loaded.ok ? '' : loaded.error);
  const [pins, setPins] = useState<SimulationPin[]>([]);
  const [scenarioId, setScenarioId] = useState('');
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [clock, setClock] = useState<SimulationClock>();
  const [clockText, setClockText] = useState(liveClock?.now ?? '');
  const [offset, setOffset] = useState(liveClock?.utcOffsetMinutes ?? 0);
  const [flows, setFlows] = useState<Readonly<Record<string, FlowState>>>({});
  const [paused, setPaused] = useState(false);
  const [editingPin, setEditingPin] = useState<GraphNode>();
  const [pinText, setPinText] = useState('');
  const [pinStatus, setPinStatus] = useState('value');
  const [capture, setCapture] = useState('');
  const [captureName, setCaptureName] = useState('');
  const [results, setResults] = useState<readonly ScenarioResult[]>([]);
  const [exchange, setExchange] = useState('');
  const selected = scenarios.find(scenario => scenario.id === scenarioId);
  const scenario = useMemo(() => {
    const live = program.roots.flatMap(root => root.graph.nodes.filter(node => muted.has(node.id))).flatMap(node => {
      const source = sourceCaptureForNode(node, program); return source ? [sourceKey(source)] : [];
    });
    return selected ? { ...selected, pins: selected.pins.filter(pin => !muted.has(pin.blockId) && !(pin.kind === 'source' && live.includes(sourceKey(pin)))) } : undefined;
  }, [selected, muted, program]);
  const activePins = useMemo(() => mergePins(scenario?.pins ?? [], pins), [scenario, pins]);
  const snapshot = useSimulationSnapshot(program, document, flows, { clock: liveClock, previousText, ...freshness });
  const run = useMemo(() => runSimulation(program, snapshot, { scenario, pins, clock, liveBlocks: muted }), [program, snapshot, scenario, pins, clock, muted]);
  const onRun = useCallback((ids: readonly string[], state: FlowState) => {
    setFlows(previous => {
      if (ids.every(id => previous[id]?.fingerprint === state.fingerprint
        && previous[id]?.run.answer === state.run.answer && previous[id]?.run.error === state.run.error && previous[id]?.run.running === state.run.running)) return previous;
      return { ...previous, ...Object.fromEntries(ids.map(id => [id, state])) };
    });
  }, []);
  const requests = useMemo(() => sharedFlowRequests(program), [program]);
  const enabled = active && run.mode === 'Live' && !paused;
  const nodes = useMemo(() => [...new Map(program.roots.flatMap(root => root.graph.nodes).filter(node =>
    ['operand', 'condition', 'logic-ref', 'source-selection', 'step', 'request'].includes(node.payload.kind)).map(node => [node.id, node])).values()], [program]);
  const stalePins = scenarios.flatMap(scenario => pinProblems(program, scenario.pins));
  const nameOf = (node: GraphNode) => blockNames[node.id] ?? node.catalogKey;
  const returnLive = () => {
    setPins([]); setScenarioId(''); setMuted(new Set()); setClock(undefined); setPaused(false); setResults([]); setEditingPin(undefined);
    setMessage('Live restored. Saved scenarios were not changed.');
  };
  const selectScenario = (id: string) => {
    setScenarioId(id); setPins([]); setClock(undefined); setMuted(new Set()); setPaused(Boolean(id)); setResults([]);
  };
  const persist = (next: SimulationCase[]) => {
    setScenarios(next);
    const saved = saveScenarios(document.id, canvasId, next);
    setMessage(saved.ok ? 'Scenarios saved in this browser.' : saved.error);
    return saved.ok;
  };
  const saveCapture = () => {
    try {
      const candidate = caseSchema.parse(JSON.parse(capture));
      const updated = caseSchema.parse({ ...candidate, name: captureName });
      if (scenarios.length >= STORE_COUNT && !scenarios.some(scenario => scenario.id === updated.id)) throw new Error('A canvas can keep at most 20 scenarios. Delete one before saving.');
      const next = [...scenarios.filter(scenario => scenario.id !== updated.id), updated];
      if (persist(next)) { setCapture(''); setCaptureName(''); }
    } catch (error) { setMessage(error instanceof Error ? `Scenario not saved: ${error.message}` : 'Scenario data is invalid.'); }
  };
  const startCapture = () => {
    try {
      const candidate = captureScenario(program, snapshot, {
        id: allocateGraphId('scenario', new Set(scenarios.map(scenario => scenario.id))),
        name: 'New scenario', pins: activePins, clock,
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
      const json: unknown = pinStatus === 'value' ? JSON.parse(pinText) : undefined;
      if (source) {
        const answer = pinStatus === 'value' ? { status: 'value' as const, value: json } : { status: pinStatus };
        const state = source.access === 'raw-state' || source.path?.length === 1 && source.path[0] === 'state';
        const raw = state && answer.status === 'value' && typeof answer.value === 'number' ? { status: 'value', value: String(answer.value) } : answer;
        candidate = pinSchema.parse({ kind: 'source', blockId: editingPin.id, ...source, answer: raw });
      } else {
        candidate = pinSchema.parse({
          kind: 'output', blockId: editingPin.id, portId: port.id,
          result: type.representation === 'condition' ? { kind: 'condition', answer: json }
            : { kind: 'operand', answer: pinStatus === 'value' ? { status: 'value', value: json } : { status: pinStatus } },
        });
      }
      const errors = pinProblems(program, [candidate]);
      if (errors.length) throw new Error(errors.join(' '));
      setPins(previous => mergePins(previous, [candidate])); setPaused(true); setEditingPin(undefined);
      setMessage(`${nameOf(editingPin)} pinned. No device was operated.`);
    } catch (error) { setMessage(error instanceof Error ? `Pin not applied: ${error.message}` : 'Pin data is invalid.'); }
  };
  return <section className="w2-simulation" aria-label="Flow simulation">
    {requests.map(request => <SimulationFlowBridge key={request.id} {...request} enabled={enabled} onRun={onRun} />)}
    <header>
      <h2>Simulation</h2>
      <p><strong>{run.mode}</strong>{scenario ? ` - ${scenario.name}${run.modified || muted.size ? ' - Modified' : ''}` : ''}{paused && run.mode === 'Live' ? ' - refresh paused' : ''}</p>
      <p>Studio only. This preview never operates real devices. Replay from history - Later.</p>
      <button type="button" onClick={returnLive}>Return to Live</button>
      <button type="button" disabled title="Replay from history is not available">Replay from history - Later</button>
      {snapshot.stale && <p role="note">Held/stale. {snapshot.error ?? 'Live refresh is paused or a newer response has not arrived.'}</p>}
      {!snapshot.stale && snapshot.error && <p role="alert">{snapshot.error}</p>}
      <p role="status" aria-live="polite">{message}</p>
    </header>
    {run.issues.length > 0 && <p role="alert">{run.issues.join(' ')}</p>}
    <section aria-label="Just the Values">
      <h3>Just the Values</h3>
      {run.outputs.map((output, index) => <article key={anchorKey(output.output)} aria-label={`Output ${program.roots[index].name}`}>
        <h4>{program.roots[index].name}</h4>
        <output>{resultText(output.result)}</output>
        <p>{output.source} - captured <time>{output.at}</time></p>
        {program.roots[index].body.kind === 'flow' && <p>Flow clock zone: {program.roots[index].body.value.clock?.zone ?? 'device'}</p>}
        {output.issues.map(issue => <p role="note" key={issue}>{issue}</p>)}
      </article>)}
    </section>
    <section aria-label="Block sources">
      <h3>Per-block sources</h3>
      <ul>{nodes.map(node => {
        const local = pins.find(pin => pin.blockId === node.id), inherited = scenario?.pins.find(pin => pin.blockId === node.id);
        const events = run.outputs.flatMap(output => output.trace.events).filter(event => event.blockId === node.id);
        const mode = blockMode(program, node, activePins, Boolean(scenario), Boolean(clock || scenario?.clock), muted);
        const sources = blockSources(program, node, activePins, Boolean(scenario), Boolean(clock || scenario?.clock), muted);
        const source = sources.size > 1 ? 'Mixed' : sources.has('pin') ? 'Pinned' : sources.has('scenario') ? 'Scenario' : snapshot.origin === 'sample' ? 'Sample' : snapshot.stale ? 'Held/stale' : 'Live';
        return <li key={node.id}>
          <strong>{nameOf(node)}</strong> <span>{mode} - {source}</span>
          <p>{resultText(events.filter(event => event.output).slice(-1)[0]?.output)}</p>
          <label>Source for {nameOf(node)} <select value={local ? 'pin' : scenario && !muted.has(node.id) ? 'scenario' : 'live'} onChange={event => {
            if (event.target.value === 'pin') { setEditingPin(node); setPinText(''); setPinStatus('value'); return; }
            setPins(previous => previous.filter(pin => pin.blockId !== node.id));
            setMuted(previous => { const next = new Set(previous); if (event.target.value === 'live') next.add(node.id); else next.delete(node.id); return next; });
          }}>
            <option value="live">Live</option><option value="scenario" disabled={!selected}>Scenario</option>
            <option value="pin">Pin a typed value</option><option disabled>Replay from history - Later</option>
          </select></label>
        </li>;
      })}</ul>
      {editingPin && <fieldset>
        <legend>Pin {nameOf(editingPin)}</legend>
        <p>{sourceCaptureForNode(editingPin, program) ? 'Source overlay - related reads agree.' : 'Computed-output override - upstream values are not forged.'}</p>
        <label>Pin status <select value={pinStatus} onChange={event => setPinStatus(event.target.value)}><option value="value">Value</option><option value="loading">Loading</option><option value="unavailable">Unavailable</option></select></label>
        <label>Typed value (JSON) <input value={pinText} onChange={event => setPinText(event.target.value)} placeholder={editingPin.outputs[0]?.type.representation === 'condition' ? '"yes", "no" or "unknown"' : '25 or "on"'} /></label>
        <button type="button" onClick={pin}>Apply pin</button><button type="button" onClick={() => setEditingPin(undefined)}>Cancel pin</button>
      </fieldset>}
    </section>
    <section aria-label="Clock simulation">
      <h3>Pinned clock</h3>
      <p>Today and Now use one frozen clock. The authored flow zone is unchanged.</p>
      <label>ISO local clock <input value={clockText} placeholder={snapshot.base.clock.now} onChange={event => setClockText(event.target.value)} /></label>
      <label>UTC offset minutes <input type="number" min={-840} max={840} value={offset} onChange={event => setOffset(event.target.valueAsNumber)} /></label>
      <button type="button" onClick={() => {
        const parsed = clockSchema.safeParse({ now: clockText, utcOffsetMinutes: offset });
        if (!parsed.success) { setMessage('Enter a valid ISO local clock including seconds and UTC offset minutes.'); return; }
        setClock(parsed.data); setPaused(true); setMessage('Clock pinned for every block in this run.');
      }}>Pin clock</button>
    </section>
    <section aria-label="Scenarios">
      <h3>Scenarios</h3>
      <label>Active scenario <select value={scenarioId} onChange={event => selectScenario(event.target.value)}><option value="">Live now</option>
        {scenarios.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.name}{scenario.fingerprint !== program.fingerprint ? ' - Needs review' : ''}</option>)}
      </select></label>
      <div className="w2-sim-actions">
        <button type="button" onClick={startCapture}>Save Live Values as Scenario</button>
        <button type="button" disabled={!scenarios.length || stalePins.length > 0} onClick={() => { setPaused(true); setResults(runAll(program, scenarios, snapshot)); setMessage('Run All complete. No network reads or device writes.'); }}>Run All</button>
        <button type="button" disabled={!selected} onClick={() => { if (selected) { setCaptureName(selected.name); setCapture(JSON.stringify(selected, null, 2)); } }}>Edit scenario</button>
        <button type="button" disabled={!selected} onClick={() => { persist(scenarios.filter(scenario => scenario.id !== scenarioId)); selectScenario(''); }}>Delete scenario</button>
      </div>
      {stalePins.length > 0 && <p role="alert">Unresolved pins block Run All. {stalePins.join(' ')}</p>}
      <ul>{scenarios.map(scenario => <li key={scenario.id}>{scenario.name} - captured {scenario.capturedAt}{scenario.fingerprint !== program.fingerprint ? ' - Needs review' : ''}</li>)}</ul>
      {capture && <fieldset>
        <legend>Review scenario before saving</legend>
        <p>Household states may be personal. Stored only in this browser; never in draft or native exports. Delete any scenario you no longer need.</p>
        <label>Scenario name <input value={captureName} onChange={event => setCaptureName(event.target.value)} /></label>
        <label>Scenario data (JSON) <textarea rows={12} value={capture} onChange={event => setCapture(event.target.value)} /></label>
        <p>Previous-text seeds are separate base.previousText entries. Expected outputs include status and typed value; numeric tolerance is explicit.</p>
        <button type="button" onClick={saveCapture}>Save scenario</button><button type="button" onClick={() => setCapture('')}>Discard capture</button>
      </fieldset>}
      <div aria-label="Scenario results">{results.map(result => <article key={result.id} aria-label={`Scenario result ${result.name}`}>
        <h4>{result.name}: {result.status}</h4><p>Captured {result.at}</p>
        {result.reasons.map(reason => <p key={reason}>{reason}</p>)}
        {result.outputs.map(output => <p key={anchorKey(output.actual.output)}>
          {output.actual.output.id}: {output.status}; expected {output.expected ? resultText(output.expected) : 'Not recorded'}; actual {resultText(output.actual.result)};
          {' '}{output.actual.source}. {output.reasons.join(' ')}
        </p>)}
      </article>)}</div>
      <details><summary>Explicit scenario import / export</summary>
        <label>Scenario exchange JSON <textarea rows={6} value={exchange} onChange={event => setExchange(event.target.value)} /></label>
        <button type="button" onClick={() => { setExchange(JSON.stringify({ version: 1, scenarios }, null, 2)); setMessage('Export prepared. This contains personal captured values, not configuration.'); }}>Prepare export</button>
        <button type="button" onClick={() => {
          try { const imported = parseScenarios(exchange); persist(imported); selectScenario(''); }
          catch (error) { setMessage(error instanceof Error ? `Import refused: ${error.message}` : 'Import refused.'); }
        }}>Import scenarios (replace browser list)</button>
      </details>
    </section>
    <SimulationDrawers outputs={run.outputs} />
  </section>;
}
