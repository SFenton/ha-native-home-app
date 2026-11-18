import { memo, useContext } from 'react';
import { OpenTemplateContext } from '../component-library';
import { EyeOff } from 'lucide-react';
import { Link2 } from 'lucide-react';
import type { PlainNode } from '../model';
import { nodeIsShown } from '../evaluate';
import type { SelectionKey } from '../model';
import { renderProbe } from '../probe';
import { useIsCopy } from '../flow-records';
import { useRender } from '../render-context';
import { useIsSelected } from '../selection-store';
import { GridFaces, NodeIdContext } from '../grid-groups';
import { GridPlacement } from './grid-placement';
import { lineStyle } from './useFoldedGrid';
import { registry } from './registry';
import { Placeholder } from './Placeholder';

/**
 * One node on the page: the `data-sel` wrapper the selection layer finds, the rule check and the drawing. Memoised by node
 * identity (the document shares structure across edits), so an edit to one title re-renders that node and its ancestors only.
 * In Edit a node hidden by its rule is drawn at 45% with a dashed edge and a tag; in Use it is not drawn.
 * `linked` (the saved component's name) marks the root of a use of a saved component: `data-linked`, the "Linked component" title and the round badge.
 * The badge is an Edit mark only: in Use it is not drawn. In Edit it is a button ("Edit template Name", `linkedId` is the template) that opens the template in the
 * editor, with its own hit target (28 px on a fine pointer, 44 px on a coarse one); the tile around it still selects the place.
 */
export const NodeFrame = memo(function NodeFrame({ node, linked, linkedId }: { node: PlainNode; linked?: string; linkedId?: string }) {
  const openTemplate = useContext(OpenTemplateContext);
  renderProbe.onNode?.(node.id);
  const ctx = useRender();
  const copy = useIsCopy();
  const placed = useContext(GridPlacement)?.get(node.id);
  const grouped = useContext(GridFaces) !== undefined;
  const key: SelectionKey = `node:${node.id}`;
  const selected = useIsSelected(ctx.store, key);
  const visible = nodeIsShown(node, ctx.env, ctx.previous.get(node.id));
  ctx.previous.set(node.id, visible);
  if (!visible && ctx.mode === 'use') return null;
  const Draw = registry[node.type] as ((props: { node: PlainNode }) => React.JSX.Element) | undefined;
  const selectedInEdit = selected && ctx.mode === 'edit' && !copy;
  return <div className="sh-node" data-sel={copy ? undefined : key} data-copy={copy ? '' : undefined} inert={copy && ctx.mode === 'edit' ? true : undefined} data-group-item={grouped ? node.id : undefined} data-type={node.type} style={lineStyle(placed) ?? { gridColumn: `span ${node.layout.span ?? 1}` }}
    data-selected={selectedInEdit ? '' : undefined} data-hidden={!visible ? '' : undefined}
    data-linked={linked !== undefined ? '' : undefined} title={linked !== undefined ? 'Linked component' : undefined}>
    {linked !== undefined && ctx.mode === 'edit' && (!copy && linkedId !== undefined && openTemplate
      ? <button type="button" className="sh-link-badge" data-passthrough="" data-open-template={linkedId} aria-label={`Edit template ${linked}`} title={`Edit template ${linked}`} onClick={() => openTemplate(linkedId)}><Link2 size={11} aria-hidden="true"/></button>
      : <span className="sh-link-badge" aria-hidden="true"><Link2 size={11}/></span>)}
    <NodeIdContext.Provider value={node.id}>{Draw ? <Draw node={node}/> : <Placeholder node={node}/>}</NodeIdContext.Provider>
    {!visible && <span className="sh-tag sh-tag-rule"><EyeOff size={12} aria-hidden="true"/>Hidden by Rule</span>}
    {selectedInEdit && <span className="sh-handle-slot" data-handle-for={key}/>}
  </div>;
});
