import type { CompositionNode } from '../../shared/composition/schema';
import type { SelectionKey } from '../model';
import { useRender } from '../render-context';
import { NodeFrame } from './NodeFrame';

/**
 * Draws `nodes` in order, each in its own frame. In Edit, `owner` (the selection key of the page, sheet, node or local tab
 * that holds them) adds an empty `.sh-add-slot` at the end for the workspace to fill with its "Add" button, the way the
 * selected node leaves a handle slot.
 */
export function Children({ nodes, owner }: { nodes: readonly CompositionNode[]; owner?: SelectionKey }) {
  const { mode } = useRender();
  return <>{nodes.map(node => <NodeFrame key={node.id} node={node}/>)}{owner && mode === 'edit' && <div className="sh-add-slot" data-add-for={owner}/>}</>;
}
