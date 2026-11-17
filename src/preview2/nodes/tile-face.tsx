import type { CSSProperties, ReactNode } from 'react';
import type { CompositionActionSlot } from '../../shared/composition/schema';
import { useRender } from '../render-context';
import { faceState, useFaceReport } from '../grid-groups';
import { Badge, Glyph, Pressable, type SfSymbol } from './shared';

/** The tile face: glyph, title and a line of state, in the tinted-glass finish. `lit` is the active state. */
export function Face({ icon, title, line, action, press, lit, style, className = '', children, badge, enabled = true, unavailable = false }: {
  icon?: SfSymbol; title: string; line?: string; action?: CompositionActionSlot; /** A tap that is not a document action (a state tile's own). */ press?: () => void; lit?: boolean; style?: CSSProperties; className?: string; children?: ReactNode;
  /** The count in the corner: nothing for none, 0 or no value. */ badge?: string | null;
  /** False while the tile's `enabledWhen` does not hold (`sh.enabled-when@1`). */ enabled?: boolean;
  /** The tile's entity cannot answer: its icon keeps the muted grey at 50% and its line the secondary ink (`sh.tile-ink-default@1`). */ unavailable?: boolean;
}) {
  const { mode } = useRender();
  useFaceReport(faceState(unavailable, Boolean(lit)));
  const body = <>
    {icon && <span className="sh-tile-glyph"><Glyph symbol={icon} size={24}/></span>}
    <span className="sh-tile-title">{title}</span>
    {line ? <span className="sh-tile-line">{line}</span> : null}
    {children}
    <Badge text={badge ?? null}/>
  </>;
  if (press) return <button type="button" className={`sh-tile ${lit ? 'sh-lit' : ''} ${unavailable ? 'sh-unavailable' : ''} sh-pressable ${className}`.trim()} style={style} disabled={!enabled} data-disabled={enabled ? undefined : ''}
    onClick={() => { if (mode === 'use' && enabled) press(); }}>{body}</button>;
  return <Pressable action={action} enabled={enabled} className={`sh-tile ${lit ? 'sh-lit' : ''} ${unavailable ? 'sh-unavailable' : ''} ${action ? 'sh-pressable' : ''} ${className}`.trim()} style={style}>{body}</Pressable>;
}
