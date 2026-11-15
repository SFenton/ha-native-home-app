import { useState, type CSSProperties } from 'react';
import { useTabHint } from '../selection-store';
import { useRender } from '../render-context';
import { Children } from './Children';
import { points, type NodeOf } from './shared';

/** The smallest tile width each grid rule asks for (`tile@1`, Dynamic Type, wide sections). */
const minimumWidth = { 'tile@1': 150, 'tile-dynamic-type@1': 150, 'section-wide@1': 300 } as const;

/** `tile-grid`: columns that are at least the rule's minimum wide, at most `maxColumns`, each child spanning its `layout.span`. */
export function TileGridNode({ node }: { node: NodeOf<'tile-grid'> }) {
  const { props } = node;
  const style = { '--min': `${minimumWidth[props.minimum]}px`, '--max': props.maxColumns, '--gap': `${points(props.spacing)}px` } as CSSProperties;
  return <div className="sh-grid" style={style} data-equal={props.equalRowHeights ? '' : undefined}><Children nodes={node.children}/></div>;
}
/** `section`: an optional header and footer around its children, plain or as one module of rows. */
export function SectionNode({ node }: { node: NodeOf<'section'> }) {
  const { props } = node;
  return <section className={`sh-section sh-section-${props.style}`} data-density={props.density} aria-label={props.header || node.title}>
    {props.header && <h2 className="sh-section-header">{props.header}</h2>}
    <div className="sh-section-body" style={{ '--gap': `${points(props.spacing)}px` } as CSSProperties}><Children nodes={node.children}/></div>
    {props.footer && <p className="sh-section-footer">{props.footer}</p>}
  </section>;
}
/** `status-rail`: the chip row under the title. */
export function StatusRailNode({ node }: { node: NodeOf<'status-rail'> }) {
  return <div className="sh-rail" role="list" aria-label={node.title}><Children nodes={node.children}/></div>;
}
/** `room-section`: a room's nodes in a column, or in two columns when the arrangement fills two. */
export function RoomSectionNode({ node }: { node: NodeOf<'room-section'> }) {
  const two = node.props.arrangement === 'two-column-fill';
  return <section className={`sh-room-section ${two ? 'sh-grid' : 'sh-section-body'}`} data-arrangement={node.props.arrangement} aria-label={node.title}
    style={{ '--min': '150px', '--max': two ? 2 : 1, '--gap': '12px' } as CSSProperties}><Children nodes={node.children}/></section>;
}
/** `paged-row`: children in a snapping row, `perPage` to a page, with the page dots when asked. */
export function PagedRowNode({ node }: { node: NodeOf<'paged-row'> }) {
  const { perPage, showsIndicator } = node.props;
  const pages = Math.max(1, Math.ceil(node.children.length / perPage));
  return <div className="sh-paged" aria-label={node.props.pageLabel}>
    <div className="sh-paged-track" style={{ '--per': perPage } as CSSProperties}><Children nodes={node.children}/></div>
    {showsIndicator && pages > 1 && <div className="sh-dots" aria-hidden="true">{Array.from({ length: pages }, (_, i) => <i key={i} data-on={i === 0 ? '' : undefined}/>)}</div>}
  </div>;
}
/**
 * `local-tabs`: a segmented selector and the active tab's children. Use writes the scene value; Edit only looks at a tab, and
 * follows the selection when it sits inside one.
 */
export function LocalTabsNode({ node }: { node: NodeOf<'local-tabs'> }) {
  const ctx = useRender();
  const hint = useTabHint(ctx.store, node.id);
  const [picked, setPicked] = useState<string>();
  const stored = ctx.local(node.props.stateId);
  const fromState = stored?.type === 'string' ? stored.value : undefined;
  const has = (id: string | undefined) => node.tabs.some(tab => tab.id === id);
  const active = (has(hint) ? hint : undefined) ?? (ctx.mode === 'edit' && has(picked) ? picked : undefined) ?? (has(fromState) ? fromState : undefined) ?? node.tabs[0].id;
  const choose = (id: string) => {
    if (ctx.mode === 'edit') setPicked(id);
    else ctx.run({ type: 'set-local', stateId: node.props.stateId, value: { type: 'string', value: id } });
  };
  const tab = node.tabs.find(item => item.id === active) ?? node.tabs[0];
  return <div className="sh-local-tabs" data-pinned={node.props.pinned ? '' : undefined}>
    {node.props.showsSelector !== false && <div className="sh-segments" role="tablist" aria-label={node.title}>
      {node.tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === tab.id} data-sel={`local-tab:${node.id}/${item.id}`} onClick={() => choose(item.id)}>{item.label}</button>)}
    </div>}
    <div className="sh-local-tab-body" role="tabpanel" data-tab={tab.id}><Children nodes={tab.children}/></div>
  </div>;
}
