import type { CompositionNode } from '../../shared/composition/schema';

/**
 * What a node type the web preview cannot draw shows: a tile with its title, its type and a tag. Never a look-alike; the
 * app draws the real node.
 */
export function Placeholder({ node }: { node: CompositionNode }) {
  return <div className="sh-placeholder" role="group" aria-label={`${node.title}, ${node.type}`}>
    <strong className="sh-placeholder-title">{node.title}</strong>
    <code className="sh-placeholder-type">{node.type}</code>
    <span className="sh-tag">Shown in the App</span>
  </div>;
}
