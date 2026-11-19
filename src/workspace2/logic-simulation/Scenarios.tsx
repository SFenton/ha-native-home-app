import { Drawer } from '@base-ui/react/drawer';
import { FlaskConical, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GraphNode, SimulationCase, SimulationResult } from '../../shared/composition/graph/types';
import type { HeldSnapshot, ScenarioResult, SimulationRun } from './engine';
import type { SimulationProgram } from './program';
import { sourceCaptureForNode } from './program';
import { anchorKey, sourceKey } from './contracts';
import { capturedTime, displayValue, type ValuePresentation } from './presentation';
import { Tag } from '../kit';

export function ScenariosDrawer({ open, onClose, program, scenarios, snapshot, selectedId, savedVersionDiffers, run, results, inputNodes, blockLabel, outputLabel, outputKeys, onSelect, onCapture, onCreate, onRunAll, onEdit, onDelete, blocked, children }: {
  open: boolean; onClose: () => void; program: SimulationProgram; scenarios: readonly SimulationCase[]; snapshot: HeldSnapshot;
  selectedId: string; savedVersionDiffers: boolean; run: SimulationRun; results: readonly ScenarioResult[]; inputNodes: readonly GraphNode[];
  blockLabel: (node: GraphNode) => ValuePresentation; outputLabel: (index: number) => ValuePresentation;
  outputKeys?: readonly string[];
  onSelect: (id: string) => void; onCapture: () => void; onCreate: () => void; onRunAll: () => void;
  onEdit: (scenario: SimulationCase) => void; onDelete: (scenario: SimulationCase) => void; blocked: boolean; children?: ReactNode;
}) {
  const outputs = program.roots.map((root, index) => ({ root, index })).filter(({ root }) => !outputKeys || outputKeys.includes(anchorKey(root.anchor)));
  const inputValue = (node: GraphNode, scenario?: SimulationCase) => {
    const source = sourceCaptureForNode(node, program);
    if (!source) return { text: 'Not captured', pinned: false };
    const pin = scenario?.pins.find(pin => pin.kind === 'source' && sourceKey(pin) === sourceKey(source));
    const captured = (scenario?.base ?? snapshot.base).reads.find(read => sourceKey(read) === sourceKey(source));
    const result: SimulationResult | undefined = pin?.kind === 'source' ? { kind: 'operand', answer: pin.answer }
      : captured ? { kind: 'operand', answer: captured.answer } : undefined;
    return { text: displayValue(result, blockLabel(node)), pinned: Boolean(pin) };
  };
  return <Drawer.Root open={open} onOpenChange={next => { if (!next) onClose(); }} modal={false}>
    <Drawer.Portal><Drawer.Viewport className="w2-sim-scenarios-viewport">
      <Drawer.Popup className="w2-scope w2-sheet w2-simulation-surface w2-sim-scenarios" aria-label="Scenarios">
        <div className="w2-grabber" aria-hidden />
        <header className="w2-sim-drawer-head">
          <div className="w2-sim-drawer-title"><FlaskConical size={18} aria-hidden /><Drawer.Title>Scenarios</Drawer.Title>
            <Drawer.Description>Each pins some values and leaves the rest live</Drawer.Description></div>
          <div className="w2-sim-actions">
            <button type="button" onClick={onCreate}><Plus size={14} aria-hidden />Scenario</button>
            <button type="button" onClick={onCapture}>Save Live Values as Scenario</button>
            <button type="button" className="w2-primary" disabled={!scenarios.length || blocked} onClick={onRunAll}><Play size={14} aria-hidden />Run All</button>
            <button type="button" className="w2-icon-button" aria-label="Close Scenarios" onClick={onClose}><X size={18} aria-hidden /></button>
          </div>
        </header>
        <Drawer.Content className="w2-sheet-content">
          <div className="w2-sim-table-scroll" tabIndex={0} role="region" aria-label="Scenario comparison table">
            <table className="w2-sim-table">
              <thead><tr><th scope="col">Scenario</th>{inputNodes.map(node => <th key={node.id} scope="col">{blockLabel(node).name}</th>)}
                {outputs.map(({ root, index }) => <th key={anchorKey(root.anchor)} scope="col">{outputLabel(index).name}</th>)}<th scope="col">Expected</th><th scope="col"><span className="w2-sr">Row actions</span></th></tr></thead>
              <tbody>
                <tr aria-selected={!selectedId}><th scope="row"><button type="button" onClick={() => onSelect('')}>Live now</button></th>
                  {inputNodes.map(node => <td key={node.id} className="w2-sim-live-value">{inputValue(node).text}</td>)}
                  {outputs.map(({ root, index }) => <td key={anchorKey(root.anchor)}>{!selectedId ? displayValue(run.outputs[index]?.result, outputLabel(index)) : 'Not run'}</td>)}
                  <td>—</td><td /></tr>
                {scenarios.map(scenario => {
                  const result = results.find(result => result.id === scenario.id);
                  const mismatch = result?.outputs.filter(output => output.status === 'Failed');
                  const failed = mismatch?.find(output => output.expected?.kind === 'operand') ?? mismatch?.[0];
                  const failure = failed?.expected ? displayValue(failed.expected) : undefined;
                  return <tr key={scenario.id} aria-selected={selectedId === scenario.id}>
                    <th scope="row"><button type="button" aria-label={`Use scenario ${scenario.name}`} onClick={() => onSelect(scenario.id)} title={`Captured ${capturedTime(scenario.capturedAt)}`}>{scenario.name}</button></th>
                    {inputNodes.map(node => { const value = inputValue(node, scenario); return <td key={node.id} className={value.pinned ? 'w2-sim-pinned-value' : 'w2-sim-live-value'} title={value.pinned ? 'Pinned by the scenario' : 'Live at capture'}>{value.text}</td>; })}
                    {outputs.map(({ root, index }) => <td key={anchorKey(root.anchor)}>{displayValue(result?.outputs[index]?.actual.result ?? (selectedId === scenario.id && !savedVersionDiffers ? run.outputs[index]?.result : undefined), outputLabel(index))}</td>)}
                    <td aria-label={`${scenario.name}: ${result?.status ?? 'Not run'}`}>
                      {!scenario.expected.length ? '—' : !result ? <Tag>Not run</Tag> : <Tag tone={result.status === 'Passed' ? 'success' : result.status === 'Failed' ? 'error' : 'neutral'}>
                        {result.status === 'Passed' ? '✓ Matches' : result.status === 'Failed' ? `✗ Expected ${failure ?? 'a different result'}` : 'Incomplete'}
                      </Tag>}
                    </td>
                    <td><div className="w2-sim-row-actions">
                      <button type="button" className="w2-icon-button" aria-label={`Edit ${scenario.name}`} onClick={() => onEdit(scenario)}><Pencil size={14} aria-hidden /></button>
                      <button type="button" className="w2-icon-button" aria-label={`Delete ${scenario.name}`} onClick={() => onDelete(scenario)}><Trash2 size={14} aria-hidden /></button>
                    </div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="w2-sim-legend"><span className="w2-sim-live-value">Grey italic: live from Home Assistant.</span> <span className="w2-sim-pinned-value">Purple: pinned by the scenario.</span></p>
          {savedVersionDiffers && <p role="note" className="w2-sim-legend">Saved version differs. Reselect to apply.</p>}
          {results.filter(result => result.status === 'Incomplete').map(result => <p key={result.id} className="w2-caption w2-sim-incomplete"><strong>{result.name}: Incomplete.</strong> Captured data or expectations need review. Edit the scenario to inspect the recorded inputs and results.</p>)}
          {children}
        </Drawer.Content>
      </Drawer.Popup>
    </Drawer.Viewport></Drawer.Portal>
  </Drawer.Root>;
}
