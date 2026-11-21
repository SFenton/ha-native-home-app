import { useMemo } from 'react';
import type { LogicGraph } from '../../shared/composition/graph';
import type { CanvasObservations, ObservedValue } from '../logic-simulation/observations';
import { formatObservedValue } from '../logic-simulation/observations';
import { nodeFor, simulationInputs, type SimulationProgram } from '../logic-simulation/program';
import { Tag } from '../kit';
import { nodeTitle } from '../canvas/blocks';

function provenance(value?: ObservedValue): string {
  if (!value?.observed || value.state !== 'known') return "Can't tell";
  if (value.source === 'mixed') return 'Mixed';
  if (value.source === 'pinned') return 'Pinned';
  if (value.source === 'scenario' || value.freshness === 'captured') return 'Scenario';
  return value.freshness === 'sample' ? 'Demo' : 'Live';
}

export default function ResultSummary({ graph, program, observations, blockNames, error }: {
  graph: LogicGraph; program?: SimulationProgram; observations?: CanvasObservations;
  blockNames: Readonly<Record<string, string>>; error?: string;
}) {
  const inputs = useMemo(() => {
    if (!program) return [];
    const nodes = program.roots.flatMap(root => root.graph.nodes);
    const readings = simulationInputs(program, nodes);
    const representedSettings = new Set(graph.nodes.flatMap(node => node.payload.kind === 'hole' && graph.edges.some(edge =>
      edge.from.nodeId === node.id && readings.some(reading => reading.id === edge.to.nodeId)) ? [node.payload.value.name] : []));
    const settings = graph.nodes.filter(node => node.payload.kind === 'hole');
    const rows = new Map<string, { id: string; label: string }>();
    for (const node of readings) rows.set(node.id, { id: node.id, label: blockNames[node.id] ?? nodeTitle(node, graph) });
    for (const node of settings) {
      if (node.payload.kind !== 'hole' || representedSettings.has(node.payload.value.name)) continue;
      const label = nodeTitle(node, graph);
      const key = `setting:${node.payload.value.name}`;
      if (!rows.has(key)) rows.set(key, { id: node.id, label });
    }
    for (const root of program.roots) if (root.body.kind === 'flow') root.body.value.parameters.forEach((parameter, index) => {
      const key = `param:${root.anchor.id}:${parameter.name}`, node = nodeFor(root, `/parameters/${index}/value`);
      rows.set(key, { id: node?.id ?? key, label: parameter.name });
    });
    return [...rows.values()];
  }, [graph, program, blockNames]);
  const result = program ? observations?.results?.[program.roots[0].graph.roots[0].nodeId] : undefined;
  const badge = provenance(result);
  return <section className="w2-logic-result-summary" aria-label="Result summary">
    <div className="w2-logic-result-line"><strong>Result</strong><output aria-label="Result value">{formatObservedValue(result, program?.roots[0].body.kind === 'flow' && program.roots[0].body.value.output.kind === 'rows')}</output>
      <Tag tone={badge === 'Live' ? 'success' : 'neutral'}>{badge}</Tag></div>
    {inputs.length > 0 && <dl aria-label="Current inputs">{inputs.map(input => <div key={input.id}><dt>{input.label}</dt><dd>{formatObservedValue(observations?.blocks[input.id])}</dd></div>)}</dl>}
    {result?.freshness === 'held' && <p className="w2-caption">Last known values · waiting for Home Assistant.</p>}
    {error && <p role="status" className="w2-caption">{error}</p>}
  </section>;
}
