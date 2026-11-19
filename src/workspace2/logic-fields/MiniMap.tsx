import { useMemo } from 'react';
import type { LogicGraph } from '../../shared/composition/graph';
import type { NameContext } from '../expr/condition';
import { miniMapModel } from './presentation';

export function MiniMap({ graph, ctx, description }: { graph: LogicGraph; ctx: NameContext; description: string }) {
  const model = useMemo(() => miniMapModel(graph, ctx), [graph, ctx]);
  return <div className="w2-logic-map" tabIndex={0} role="region" aria-label="Explore the logic mini-map">
    <svg width={model.width} height={model.height} role="img" aria-label={`Logic mini-map: ${description}`}>
      {model.edges.map(edge => <path key={edge.id} data-wire-kind={edge.from.kind}
        d={`M${edge.from.x + 86},${edge.from.y + 18} C${edge.from.x + 98},${edge.from.y + 18} ${edge.to.x - 12},${edge.to.y + 18} ${edge.to.x},${edge.to.y + 18}`}/>)}
      {model.nodes.map(node => <g key={node.id} transform={`translate(${node.x},${node.y})`} data-wire-kind={node.kind}>
        <title>{[node.name, node.detail].filter(Boolean).join(' · ')}</title>
        <rect width="86" height="38" rx="7"/>
        <foreignObject x="4" y="3" width="78" height="32"><div className="w2-logic-map-label"><strong>{node.name}</strong>{node.detail && <small>{node.detail}</small>}</div></foreignObject>
      </g>)}
    </svg>
  </div>;
}
