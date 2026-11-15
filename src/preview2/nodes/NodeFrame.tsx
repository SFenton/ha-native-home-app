import { memo } from 'react';
import { EyeOff } from 'lucide-react';
import type { CompositionNode } from '../../shared/composition/schema';
import { isShown, type VisibilityRule } from '../evaluate';
import type { SelectionKey } from '../model';
import { renderProbe } from '../probe';
import { useRender } from '../render-context';
import { useIsSelected } from '../selection-store';
import { registry } from './registry';
import { Placeholder } from './Placeholder';

/**
 * One node on the page: the `data-sel` wrapper the selection layer finds, the rule check and the drawing. Memoised by node
 * identity (the document shares structure across edits), so an edit to one title re-renders that node and its ancestors only.
 * In Edit a node hidden by its rule is drawn at 45% with a dashed edge and a tag; in Use it is not drawn.
 */
export const NodeFrame = memo(function NodeFrame({ node }: { node: CompositionNode }) {
  renderProbe.onNode?.(node.id);
  const ctx = useRender();
  const key: SelectionKey = `node:${node.id}`;
  const selected = useIsSelected(ctx.store, key);
  const visible = isShown(node as VisibilityRule, ctx.env, ctx.previous.get(node.id));
  ctx.previous.set(node.id, visible);
  if (!visible && ctx.mode === 'use') return null;
  const Draw = registry[node.type] as ((props: { node: CompositionNode }) => React.JSX.Element) | undefined;
  const selectedInEdit = selected && ctx.mode === 'edit';
  return <div className="sh-node" data-sel={key} data-type={node.type} style={{ gridColumn: `span ${node.layout.span}` }}
    data-selected={selectedInEdit ? '' : undefined} data-hidden={!visible ? '' : undefined}>
    {Draw ? <Draw node={node}/> : <Placeholder node={node}/>}
    {!visible && <span className="sh-tag sh-tag-rule"><EyeOff size={12} aria-hidden="true"/>Hidden by Rule</span>}
    {selectedInEdit && <span className="sh-handle-slot" data-handle-for={key}/>}
  </div>;
});
