import type { CSSProperties } from 'react';
import { useRender } from '../render-context';
import { Children } from './Children';
import { points, type NodeOf } from './shared';

/**
 * `overlay` (`sh.overlay@1`): a base (a map or a tile) with up to four small controls drawn over it, each at one of five anchors and an inset. The
 * controls take touches before the base. `leading` and `trailing` are the logical edges, so they swap in a right-to-left language. An icon-only command
 * or button draws as a 44 point glass circle; its title is the accessible name. An empty overlay shows a slot to drop the base in (Edit only).
 */
export function OverlayNode({ node }: { node: NodeOf<'overlay'> }) {
  const { mode } = useRender();
  const [base, ...onTop] = node.children;
  const owner = `node:${node.id}` as const;
  if (!base) return mode === 'edit' ? <div className="sh-overlay-empty" data-testid="overlay-empty">Drop a map or a tile here.<Children nodes={[]} owner={owner}/></div> : <></>;
  const anchorOf = (id: string) => node.props.anchors.find(entry => entry.childId === id);
  return <div className="sh-overlay" role="group" aria-label={node.title}>
    <div className="sh-overlay-base"><Children nodes={[base]}/></div>
    {onTop.map(child => {
      const place = anchorOf(child.id);
      return <div key={child.id} className="sh-overlay-child" data-anchor={place?.anchor ?? 'center'} style={{ '--inset': `${points(place?.inset, 12)}px` } as CSSProperties}><Children nodes={[child]}/></div>;
    })}
    {mode === 'edit' && onTop.length < 4 && <Children nodes={[]} owner={owner}/>}
  </div>;
}
