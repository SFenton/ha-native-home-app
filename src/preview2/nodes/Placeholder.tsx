import type { PlainNode } from '../model';

/**
 * What a node type the preview has no drawing for (an unknown or future one) shows: a tile with its title, its type and a tag. Never a look-alike; the
 * app draws the real node.
 */
export function Placeholder({ node }: { node: PlainNode }) {
  return <div className="sh-placeholder" role="group" aria-label={`${node.title}, ${node.type}`}>
    <strong className="sh-placeholder-title">{node.title}</strong>
    <code className="sh-placeholder-type">{node.type}</code>
    <span className="sh-tag">Not Previewed</span>
  </div>;
}
