import { useMemo } from 'react';
import type { LogicGraph } from '../../shared/composition/graph';
import type { CanvasObservations, ObservedValue } from '../logic-simulation/observations';
import { formatObservedValue, itemContextText } from '../logic-simulation/observations';
import { nodeFor, simulationInputs, sourceCaptureForNode, type SimulationProgram } from '../logic-simulation/program';
import { Tag } from '../kit';
import { nodeTitle } from '../canvas/blocks';

function provenance(value?: ObservedValue): string {
  if (!value?.observed) return "Can't tell";
  if (value.state === 'unavailable') return 'Unavailable';
  if (value.state === 'loading') return 'Loading';
  if (value.state !== 'known') return "Can't tell";
  if (value.source === 'mixed') return 'Mixed';
  if (value.source === 'pinned') return 'Pinned';
  if (value.source === 'scenario' || value.freshness === 'captured') return 'Scenario';
  if (value.freshness === 'held') return 'Last value kept';
  return value.freshness === 'sample' ? 'Demo' : 'Live';
}

export default function ResultSummary({ graph, program, observations, blockNames, error }: {
  graph: LogicGraph; program?: SimulationProgram; observations?: CanvasObservations;
  blockNames: Readonly<Record<string, string>>; error?: string;
}) {
  const inputs = useMemo(() => {
    if (!program) return [];
    const nodes = program.roots.flatMap(root => root.graph.nodes);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const settings = graph.nodes.filter(node => node.payload.kind === 'hole');
    const rows = new Map<string, { id: string; blockId: string; label: string }>();
    const representedReaders = new Set<string>();
    for (const node of settings) {
      if (node.payload.kind !== 'hole') continue;
      const consumers = graph.edges.filter(edge => edge.from.nodeId === node.id).flatMap(edge => {
        const candidate = byId.get(edge.to.nodeId);
        const sourceSetting = node.outputs.find(port => port.id === edge.from.portId)?.type.representation === 'source-selection';
        const sourcePort = candidate?.inputs.find(port => port.id === edge.to.portId)?.type.representation === 'source-selection';
        return sourceSetting && sourcePort && candidate && candidate.payload.kind !== 'source-selection'
          && sourceCaptureForNode(candidate, program) ? [candidate] : [];
      });
      consumers.forEach(consumer => representedReaders.add(consumer.id));
      const consumer = consumers.find(candidate => observations?.blocks[candidate.id]?.observed) ?? consumers[0];
      const key = `setting:${node.payload.value.name}`;
      const current = rows.get(key);
      if (!current || !observations?.blocks[current.blockId]?.observed) rows.set(key, {
        id: key, blockId: consumer?.id ?? node.id, label: nodeTitle(node, graph),
      });
    }
    for (const node of simulationInputs(program, nodes.filter(candidate => !representedReaders.has(candidate.id))))
      rows.set(node.id, { id: node.id, blockId: node.id, label: blockNames[node.id] ?? nodeTitle(node, graph) });
    for (const root of program.roots) if (root.body.kind === 'flow') root.body.value.parameters.forEach((parameter, index) => {
      const key = `param:${root.anchor.id}:${parameter.name}`, node = nodeFor(root, `/parameters/${index}/value`);
      rows.set(key, { id: key, blockId: node?.id ?? key, label: parameter.name });
    });
    return [...rows.values()];
  }, [graph, program, blockNames, observations]);
  const result = program ? observations?.results?.[program.roots[0].graph.roots[0].nodeId] : undefined;
  const badge = provenance(result);
  return <section className="w2-logic-result-summary" aria-label="Result summary">
    <div className="w2-logic-result-line"><strong>Result</strong><output aria-label="Result value">{formatObservedValue(result, program?.roots[0].body.kind === 'flow' && program.roots[0].body.value.output.kind === 'rows')}</output>
      <Tag className={`tag ${badge === 'Live' ? 'live' : badge === 'Pinned' ? 'pinned' : ''}`} tone={badge === 'Live' ? 'success' : 'neutral'}>{badge}</Tag></div>
    {inputs.length > 0 && <dl aria-label="Current inputs">{inputs.map(input => {
      const value = observations?.blocks[input.blockId], item = itemContextText(value?.item);
      return <div key={input.id}><dt>{input.label}</dt><dd>{formatObservedValue(value)}{item && <small> · {item}</small>}</dd></div>;
    })}</dl>}
    {result?.freshness === 'held' && <p className="w2-caption">Last known values · waiting for Home Assistant.</p>}
    {error && <p role="status" className="w2-caption">{error}</p>}
  </section>;
}
