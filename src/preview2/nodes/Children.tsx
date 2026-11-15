import type { CompositionNode } from '../../shared/composition/schema';
import { NodeFrame } from './NodeFrame';

/** Draws `nodes` in order, each in its own frame. */
export function Children({ nodes }: { nodes: readonly CompositionNode[] }) {
  return <>{nodes.map(node => <NodeFrame key={node.id} node={node}/>)}</>;
}
