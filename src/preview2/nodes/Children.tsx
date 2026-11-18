import { useContext } from 'react';
import { expandRef } from '../../shared/composition/components';
import type { CompositionNode } from '../../shared/composition/schema';
import { ComponentLibraryContext } from '../component-library';
import { isHiddenNode, type PlainNode, type SelectionKey } from '../model';
import { useRender } from '../render-context';
import { MissingComponent } from './MissingComponent';
import { NodeFrame } from './NodeFrame';

/**
 * Draws `nodes` in order, each in its own frame. In Edit, `owner` (the selection key of the page, sheet, node or local tab
 * that holds them) adds an empty `.sh-add-slot` at the end for the workspace to fill with its "Add" button, the way the
 * selected node leaves a handle slot.
 *
 * A `component-ref` is drawn as the saved component's body (`expandRef`, memoised, so an unchanged component is the same
 * node each time) through the same frame as any node; its root's frame is marked linked. A reference whose component is
 * missing draws a placeholder. `orders` gives a top-level component its place in the page's own order (`order`), for a page whose sections are drawn in groups
 * (`sh.fold-sides@1`) and must still read in document order in one column.
 */
export function Children({ nodes, owner, orders }: { nodes: readonly CompositionNode[]; owner?: SelectionKey; orders?: ReadonlyMap<string, number> }) {
  const { mode } = useRender();
  const library = useContext(ComponentLibraryContext);
  return <>{nodes.filter(node => !isHiddenNode(node)).map(node => {
    if (node.type !== 'component-ref') return <NodeFrame key={node.id} node={node} order={orders?.get(node.id)}/>;
    const entry = library.get(node.componentId);
    return entry ? <NodeFrame key={node.id} node={expandRef(node, entry) as PlainNode} linked={entry.name} linkedId={entry.id} order={orders?.get(node.id)}/> : <MissingComponent key={node.id} id={node.id} span={node.layout.span ?? 1}/>;
  })}{owner && mode === 'edit' && <div className="sh-add-slot" data-add-for={owner}/>}</>;
}
