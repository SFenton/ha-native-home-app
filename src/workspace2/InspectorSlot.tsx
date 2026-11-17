import { useRef, type CSSProperties, type ReactNode } from 'react';
import { usePresence } from './usePresence';

/**
 * The inspector column and its slide. Its presence (mounted, then shown a frame later) is state, so it is held here and not in the
 * workspace: opening the inspector would otherwise re-render the whole workspace twice more, inside the same task as the
 * selection that opened it. It also keeps the last properties drawn while the column slides out.
 */
export default function InspectorSlot({ open, ms, tier, width, fallbackWidth, properties }: {
  open: boolean; /** How long the slide out lasts. */ ms: number; tier: string;
  /** The column's width while open, in points; 0 while closed. */ width: number;
  /** The width to hold while the column slides out and no `width` is left. */ fallbackWidth: number;
  /** The properties of the selection, or nothing once it is cleared. */ properties: ReactNode;
}) {
  const presence = usePresence(open, ms);
  const last = useRef<ReactNode>(null);
  if (properties) last.current = properties; else if (!presence.mounted) last.current = null;
  if (!presence.mounted) return null;
  return <div className="w2-inspector-slot"><aside className="w2-inspector" data-open={presence.shown ? '' : undefined} data-tier={tier} aria-label="Properties" inert={!open}
    style={{ '--w2-inspector-w': `${width || (last.current ? fallbackWidth : 0)}px` } as CSSProperties}>{properties ?? last.current}</aside></div>;
}
