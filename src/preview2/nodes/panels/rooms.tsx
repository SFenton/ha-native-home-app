import type { CSSProperties } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useRender } from '../../render-context';
import { Glyph, useSourceRead, type NodeOf } from '../shared';

interface RoomItem { id: string; title: string; icon: string; fill: string | null; bodyHint: string; visibilitySourceId: string | null; visibleStates: string[] | null }
const isItem = (value: unknown): value is RoomItem => Boolean(value) && typeof value === 'object' && typeof (value as RoomItem).title === 'string';

/**
 * `room-navigation-grid`: the Rooms page's tiles (`UKServerUIRoomNavigationGrid`): a grid of 150 pt tiles, at most 4 across,
 * equal heights, each tile's glyph on top and its title anchored to the bottom in the room's colour. A room whose visibility
 * source reports another state is left out, as the app does. The order is the configured one; the app's visit ranking is
 * not simulated.
 */
export function RoomNavigationGridNode({ node }: { node: NodeOf<'room-navigation-grid'> }) {
  const { env } = useRender();
  const read = useSourceRead(node.binding.sourceId, ['items']);
  const items = read.status === 'value' && Array.isArray(read.value) ? (read.value as unknown[]).filter(isItem) : [];
  const shown = items.filter(item => {
    if (!item.visibilitySourceId || !item.visibleStates) return true;
    const state = env.read(item.visibilitySourceId, ['state']);
    return state.status === 'value' && item.visibleStates.includes(String(state.value));
  });
  return <div className="sh-grid sh-room-grid" role="group" aria-label={node.title} data-equal="" style={{ '--min': '150px', '--max': 4, '--gap': '12px' } as CSSProperties}>
    {shown.map(item => <div key={item.id} className={`sh-tile sh-anchored ${item.fill ? 'sh-lit' : ''}`} role="group" aria-label={item.title}
      style={item.fill ? { '--fill': item.fill, '--glyph': '#fff' } as CSSProperties : undefined}>
      <span className="sh-tile-glyph"><Glyph symbol={{ name: item.icon }} size={24}/></span>
      <span className="sh-tile-title sh-two-lines">{item.title}</span>
    </div>)}
  </div>;
}

/** The options as a segmented choice, none selected: the app waits for the device's state before it selects one. */
function Segments({ node }: { node: NodeOf<'room-device-control'> }) {
  return <span className="sh-segments" role="radiogroup" aria-label={node.title}>
    {node.props.options.map(option => <span key={option.value} role="radio" aria-checked={false}>{option.label}</span>)}
  </span>;
}
/** The dial of the humidifier's mist and target controls: a 270 degree track with the value in the middle. */
function Dial({ title, size }: { title: string; size: number }) {
  return <div className="sh-dial" role="group" aria-label={title} style={{ width: size, height: size }}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M21.7 78.3A40 40 0 1 1 78.3 78.3" fill="none" stroke="currentColor" strokeOpacity=".24" strokeWidth="8" strokeLinecap="round"/></svg>
    <span className="sh-dial-value">--</span><span className="sh-dial-title">{title}</span>
  </div>;
}

/**
 * `room-device-control`: one configured control of a room device (`UKServerUIRoomDeviceAtom`). Options draw as a segmented
 * choice under the title, power and lock controls as a glass tile, switches as a toggle line, the mist and target controls
 * as a dial, the timer as a stepper. The device models are not read in the preview, so every control draws at rest.
 */
export function RoomDeviceControlNode({ node }: { node: NodeOf<'room-device-control'> }) {
  const { props } = node;
  const footnote = props.labels.footnote ? <p className="sh-device-footnote">{props.labels.footnote}</p> : null;
  switch (props.control) {
    case 'fan-power': case 'fan-lock': case 'fan-room': case 'grill-detail':
      return <div className="sh-tile" role="group" aria-label={node.title}><span className="sh-tile-glyph"><Glyph symbol={node.icon} size={24}/></span>
        <span className="sh-tile-title">{node.title}</span><span className="sh-tile-line">{props.labels.off}</span></div>;
    case 'humidifier-power': case 'humidifier-display': case 'humidifier-scheduling':
      return <div className="sh-control sh-control-row" role="group" aria-label={node.title}><span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span>
        <span className="sh-row-primary">{node.title}</span><span className="sh-switch" role="switch" aria-checked={false}><span/></span></div>;
    case 'humidifier-mist': case 'humidifier-target': return <div className="sh-device"><Dial title={node.title} size={props.control === 'humidifier-mist' ? 220 : 160}/>{footnote}</div>;
    case 'humidifier-timer': return <div className="sh-control sh-control-row" role="group" aria-label={node.title}><span className="sh-row-primary">{node.title}</span>
      <span className="sh-stepper"><span aria-hidden="true"><Minus size={16}/></span><output>{props.labels.off}</output><span aria-hidden="true"><Plus size={16}/></span></span></div>;
    case 'humidifier-info': return <div className="sh-pill sh-tone-unavailable" role="group" aria-label={node.title}><Glyph symbol={node.icon} size={18}/><strong>{node.title}</strong><span>{props.labels.loading}</span></div>;
    case 'fan-timer': return <div className="sh-device"><strong className="sh-device-title">{node.title}</strong><Segments node={node}/>
      <span className="sh-primary-button" aria-hidden="true">{props.options.find(option => option.value === String(props.initialMinutes ?? 30))?.actionLabel ?? props.labels.action}</span>{footnote}</div>;
    default: return <div className="sh-device"><strong className="sh-device-title">{node.title}</strong><Segments node={node}/>{footnote}</div>;
  }
}
