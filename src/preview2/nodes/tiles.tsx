import type { CSSProperties, ReactNode } from 'react';
import { Camera, ChevronRight } from 'lucide-react';
import type { CompositionAction } from '../../shared/composition/schema';
import { isTrue, familyStyle, Glyph, Pressable, rgb, useOperand, useSourceRead, useSourceText, type NodeOf, type SfSymbol } from './shared';

/** The tile face: glyph, title and a line of state, in the tinted-glass finish. `lit` is the active state. */
function Face({ icon, title, line, action, lit, style, className = '', children }: {
  icon?: SfSymbol; title: string; line?: string; action?: CompositionAction; lit?: boolean; style?: CSSProperties; className?: string; children?: ReactNode;
}) {
  return <Pressable action={action} className={`sh-tile ${lit ? 'sh-lit' : ''} ${action ? 'sh-pressable' : ''} ${className}`.trim()} style={style}>
    {icon && <span className="sh-tile-glyph"><Glyph symbol={icon} size={24}/></span>}
    <span className="sh-tile-title">{title}</span>
    {line ? <span className="sh-tile-line">{line}</span> : null}
    {children}
  </Pressable>;
}

/** `navigation-tile`: opens a page or sheet. */
export function NavigationTileNode({ node }: { node: NodeOf<'navigation-tile'> }) {
  const subtitle = useOperand(node.props.subtitle, '');
  const fill = rgb(node.props.presentation?.fill);
  return <Face icon={node.icon} title={node.title} line={subtitle.text} action={node.action} className={node.props.presentation?.layout === 'anchored-bottom' ? 'sh-anchored' : ''}
    style={{ ...familyStyle(node.props.family), ...(fill ? { '--fill': fill } : {}) } as CSSProperties} lit={Boolean(fill)}/>;
}
/** `action-tile`: a power tile; lit while its source is on. */
export function ActionTileNode({ node }: { node: NodeOf<'action-tile'> }) {
  const state = useSourceText(node.binding.sourceId, 'Unavailable');
  const on = isTrue(useSourceRead(node.binding.sourceId, ['isOn']));
  const labels = node.props.powerLabels;
  return <Face icon={node.icon} title={node.title} line={state.state === 'ready' && labels ? on ? labels.on : labels.off : state.text} action={node.action} lit={on} style={familyStyle(node.props.family)}/>;
}
/** `light-group-tile`: a group of lights and how many are on. */
export function LightGroupTileNode({ node }: { node: NodeOf<'light-group-tile'> }) {
  const state = useSourceText(node.props.sourceId, 'Unavailable');
  const on = isTrue(useSourceRead(node.props.sourceId, ['isOn']));
  const count = useSourceRead(node.props.sourceId, ['memberCount']), active = useSourceRead(node.props.sourceId, ['membersOn']);
  const members = count.status === 'value' && typeof count.value === 'number' && count.value > 0 && active.status === 'value' ? `${active.value} of ${count.value} on` : undefined;
  return <Face icon={{ name: 'lightbulb' }} title={node.title} line={members ?? state.text} lit={on} style={familyStyle('lights')}/>;
}
/** `room-card`: a room with its glyph and the first state its subtitle sources give. */
export function RoomCardNode({ node }: { node: NodeOf<'room-card'> }) {
  const line = useSourceText(node.props.subtitleSourceIds[0], '');
  return <Face icon={node.icon} title={node.title} line={line.text} action={node.props.action}/>;
}
/** `room-chip`: the compact form of a room card. */
export function RoomChipNode({ node }: { node: NodeOf<'room-chip'> }) {
  const line = useSourceText(node.props.subtitleSourceIds[0], '');
  return <Pressable action={node.props.action} className={`sh-chip ${node.props.action ? 'sh-pressable' : ''}`}><Glyph symbol={node.icon} size={18}/><strong>{node.title}</strong>{line.text && <span>{line.text}</span>}</Pressable>;
}
/** `camera-tile`: a poster tile that opens the viewer; the preview never streams. */
export function CameraTileNode({ node }: { node: NodeOf<'camera-tile'> }) {
  return <Face icon={{ name: 'video' }} title={node.title} line={node.props.openHint} action={node.action} className="sh-camera"><Camera className="sh-camera-mark" size={44} aria-hidden="true"/></Face>;
}

/** The state a chip or overview tile shows: the matching `states` entry, else the fallback appearance. */
function useAppearance(props: NodeOf<'status-chip'>['props']) {
  const state = useSourceRead(props.sourceId, ['state']);
  const text = useSourceText(props.sourceId, '');
  const match = state.status === 'value' ? props.states.find(item => item.state === String(state.value)) : undefined;
  const appearance = match?.appearance ?? props.fallback;
  return { appearance, text: match?.text ?? text.text, loading: state.status === 'loading' };
}
/** `status-chip`: one chip of the status rail. */
export function StatusChipNode({ node }: { node: NodeOf<'status-chip'> }) {
  const { appearance, text, loading } = useAppearance(node.props);
  const fill = rgb(appearance.fill), glyph = rgb(appearance.glyph);
  return <Pressable action={node.action} className={`sh-chip ${node.action ? 'sh-pressable' : ''}`} style={{ ...(fill ? { background: fill } : {}), ...(glyph ? { '--glyph': glyph } : {}) } as CSSProperties}>
    <span className="sh-chip-glyph"><Glyph symbol={appearance.icon} size={16}/></span><strong data-state={loading ? 'loading' : undefined}>{text || node.title}</strong>
  </Pressable>;
}
/** `room-overview-tile`: a room's overview as a tile with its state line. */
export function RoomOverviewTileNode({ node }: { node: NodeOf<'room-overview-tile'> }) {
  const { appearance, text } = useAppearance(node.props);
  const fill = rgb(appearance.fill), glyph = rgb(appearance.glyph);
  return <Face icon={appearance.icon} title={node.title} line={text} action={node.action} lit={Boolean(fill)}
    style={{ ...(fill ? { '--fill': fill } : {}), ...(glyph ? { '--glyph': glyph } : {}) } as CSSProperties}>
    {node.action && <ChevronRight className="sh-tile-chevron" size={14} aria-hidden="true"/>}
  </Face>;
}
