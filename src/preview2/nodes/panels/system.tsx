import { Glyph, type NodeOf } from '../shared';

/**
 * `bootstrap-message`: the app's centred state message (`UKStateMessageView`): a large glyph, the title in bold, the message
 * under it. Read-only; it has no action.
 */
export function BootstrapMessageNode({ node }: { node: NodeOf<'bootstrap-message'> }) {
  return <div className="sh-state-message" role="group" aria-label={node.title}>
    <span className="sh-state-glyph"><Glyph symbol={node.icon} size={44}/></span>
    <strong className="sh-state-title">{node.title}</strong>
    {node.props.message && <p className="sh-state-text">{node.props.message}</p>}
  </div>;
}
