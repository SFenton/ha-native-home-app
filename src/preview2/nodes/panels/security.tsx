import { useContext, useMemo, useRef, type CSSProperties } from 'react';
import { convertDoorTile, DoorConversionError } from '../../../shared/composition/door-to-state-tile';
import { RenderCtx } from '../../render-context';
import { StateTileNode } from '../tiles';
import { lineStyle, useFoldedGrid } from '../useFoldedGrid';
import { Glyph, rgb, useSourceRead, type NodeOf } from '../shared';

/** The phase of a source as text: `ready`, `loading` or `unavailable`. */
function usePhase(sourceId: string): 'ready' | 'loading' | 'unavailable' {
  const phase = useSourceRead(sourceId, ['phase']);
  if (phase.status === 'value') return phase.value === 'ready' ? 'ready' : phase.value === 'loading' ? 'loading' : 'unavailable';
  return phase.status === 'loading' ? 'loading' : 'unavailable';
}
/** The state a source reports, or undefined while it has none. */
function useStateText(sourceId: string): string | undefined {
  const state = useSourceRead(sourceId, ['state']);
  return state.status === 'value' && typeof state.value === 'string' ? state.value : undefined;
}

/**
 * `alarm-panel`: the security card (`UKAlarmPanelControl`): a badge in the mode's colour, the mode as a fact, the subtitle,
 * and the four mode buttons with the current mode filled in its colour (`data-chosen`, never `data-selected`: that one is the Edit selection ring). Triggered washes the card red. The mode buttons are
 * drawn but do nothing here; a mode change is the app's own flow, with its Disarm confirmation.
 */
export function AlarmPanelNode({ node }: { node: NodeOf<'alarm-panel'> }) {
  const { props } = node;
  const phase = usePhase(props.sourceId), state = useStateText(props.sourceId);
  const known = phase === 'ready' ? state : undefined;
  const appearance = (known ? props.states.find(item => item.state === known)?.appearance : undefined) ?? props.fallback;
  const title = phase === 'loading' ? props.loadingText : phase === 'unavailable' ? props.unavailableText : appearance.text;
  const triggered = known === 'triggered';
  // The mode row is a grid of 64 pt buttons that follows the fold on a page (`UKServerUISecurityViews.bind`: `followsFold`).
  const row = useRef<HTMLDivElement>(null);
  const spans = useMemo(() => props.modes.map(() => 1), [props.modes.length]);
  const grid = useFoldedGrid(row, { minimum: 64, maxColumns: 4, gap: 12, spans, fill: true, follows: true });
  return <div className="sh-alarm" role="group" aria-label={`${node.title}, ${title}`} data-state={known ?? phase} data-triggered={triggered ? '' : undefined}
    style={triggered ? { '--wash': rgb(props.triggeredWash) } as CSSProperties : undefined}>
    <div className="sh-alarm-head">
      <span className="sh-alarm-badge" data-dim={phase !== 'ready' ? '' : undefined} style={{ background: phase === 'ready' ? rgb(appearance.fill) : undefined }}><Glyph symbol={appearance.icon} size={22}/></span>
      <span className="sh-alarm-copy"><strong>{title}</strong><span>{props.subtitle}</span></span>
    </div>
    <div ref={row} className="sh-alarm-modes" data-columns={grid.columns} data-banded={grid.banded ? '' : undefined} style={grid.template ? { gridTemplateColumns: grid.template } : undefined}>
      {props.modes.map((mode, at) => <span key={mode.state} className="sh-alarm-mode" data-chosen={known === mode.state ? '' : undefined} data-dim={phase !== 'ready' ? '' : undefined}
        style={{ ...lineStyle(grid.lines?.[at]), '--fill': rgb(mode.fill) } as CSSProperties}><Glyph symbol={mode.icon} size={22}/><span>{mode.label}</span></span>)}
    </div>
  </div>;
}

/**
 * `door-tile`, drawn as the app draws it: the compiler lowers it to a `state-tile` over the built-in `lock` or `garage-door` style with the door's words,
 * glyphs and fills written over it (`ServerUIDoorLowering`), so the preview lowers it the same way ({@link convertDoorTile}) and draws that tile. The derived
 * style rides in a context of its own for the tile's lookup. A door that cannot be lowered (no `security-door@1` source) keeps the plain glass tile below.
 */
export function DoorTileNode({ node }: { node: NodeOf<'door-tile'> }) {
  const base = useContext(RenderCtx);
  const lowered = useMemo(() => {
    if (!base?.sources) return undefined;
    try { return convertDoorTile(node, base.sources, `${node.id}.door`); } catch (error) { if (error instanceof DoorConversionError) return undefined; throw error; }
  }, [node, base?.sources]);
  const scope = useMemo(() => base && lowered ? { ...base, stateStyles: { type: 'state-styles@1' as const, styles: [...(base.stateStyles?.styles ?? []), lowered.style] } } : undefined, [base, lowered]);
  if (!scope || !lowered) return <PlainDoorTile node={node}/>;
  return <RenderCtx.Provider value={scope}><StateTileNode node={lowered.node}/></RenderCtx.Provider>;
}

/** The glass tile a door drew before it lowered: the state's colour and words, for a door with no source to lower from. */
function PlainDoorTile({ node }: { node: NodeOf<'door-tile'> }) {
  const { props } = node;
  const phase = usePhase(props.sourceId), state = useStateText(props.sourceId);
  const match = phase === 'ready' ? props.states.find(item => item.state === state) : undefined;
  const appearance = match?.appearance ?? props.fallback;
  const line = phase === 'loading' ? props.loadingText : phase === 'unavailable' ? props.unavailableText : appearance.text;
  const fill = phase === 'ready' ? rgb(appearance.fill) : undefined;
  return <div className={`sh-tile ${match?.active ? 'sh-lit' : ''}`} role="group" aria-label={`${node.title}, ${line}`} data-error={match?.error ? '' : undefined}
    style={{ '--fill': fill, '--glyph': match?.active ? '#fff' : fill } as CSSProperties}>
    <span className="sh-tile-glyph"><Glyph symbol={appearance.icon} size={24}/></span>
    <span className="sh-tile-title">{node.title}</span><span className="sh-tile-line">{line}</span>
  </div>;
}
