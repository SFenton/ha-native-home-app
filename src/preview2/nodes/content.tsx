import { ChevronRight } from 'lucide-react';
import { resolveTone } from '../../shared/composition/evaluator';
import { useRender } from '../render-context';
import { isStyledText, StyledText } from './parts';
import { Badge, Glyph, Pressable, useBadge, useEnabled, useOperand, type NodeOf } from './shared';

/** `text`: a styled paragraph from an operand. */
export function TextNode({ node }: { node: NodeOf<'text'> }) {
  return isStyledText(node.props) ? <StyledText node={node}/> : <PlainText node={node}/>;
}
function PlainText({ node }: { node: NodeOf<'text'> }) {
  const value = useOperand(node.props.value, node.props.unavailableText, `${node.id}/value`);
  return <p className={`sh-text sh-text-${node.props.style}`} data-state={value.state}>{value.text}</p>;
}
/** `info-box`: a message in a tinted module. */
export function InfoBoxNode({ node }: { node: NodeOf<'info-box'> }) {
  const message = useOperand(node.props.message, node.props.unavailableText, `${node.id}/message`);
  return <div className={`sh-info sh-tone-${node.props.tone}`} role="note" data-state={message.state}>{message.text}</div>;
}
/** `status-pill`: a glyph, a value and a detail. */
export function StatusPillNode({ node }: { node: NodeOf<'status-pill'> }) {
  const value = useOperand(node.props.value, node.props.unavailableText, `${node.id}/value`);
  const detail = useOperand(node.props.detail, '', `${node.id}/detail`);
  const { env } = useRender();
  const tone = resolveTone(node.props.tone, env);
  return <div className={`sh-pill sh-tone-${tone}`} data-state={value.state} data-tone={tone}>
    <Glyph symbol={node.icon} size={18}/><strong>{value.text || node.title}</strong>{detail.text && <span>{detail.text}</span>}
  </div>;
}
/** `row`: primary, secondary and trailing value, with an optional chevron. */
export function RowNode({ node }: { node: NodeOf<'row'> }) {
  const primary = useOperand(node.props.primary, node.props.unavailableText, `${node.id}/primary`);
  const secondary = useOperand(node.props.secondary, '', `${node.id}/secondary`);
  const value = useOperand(node.props.value, '', `${node.id}/value`);
  const enabled = useEnabled(node.enabledWhen, `${node.id}/enabled`);
  return <Pressable action={node.action} enabled={enabled} className="sh-row">
    {node.props.icon && <span className="sh-row-glyph"><Glyph symbol={node.props.icon} size={20}/></span>}
    <span className="sh-row-copy"><span className="sh-row-primary">{primary.state === 'loading' ? node.props.loadingText : primary.text}</span>{secondary.text && <span className="sh-row-secondary">{secondary.text}</span>}</span>
    {value.text && <span className="sh-row-value">{value.text}</span>}
    {node.props.accessory === 'disclosure' && <ChevronRight size={16} aria-hidden="true"/>}
  </Pressable>;
}
/** `settings-link`: a glyph, a title, a subtitle and a chevron that opens a page. */
export function SettingsLinkNode({ node }: { node: NodeOf<'settings-link'> }) {
  const hintId = node.props.hint ? `${node.id}-hint` : undefined;
  const badge = useBadge(node.badge, `${node.id}/badge`);
  return <Pressable action={node.action} className="sh-row sh-settings-link" describedBy={hintId}>
    <span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span>
    <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>{node.props.subtitle && <span className="sh-row-secondary">{node.props.subtitle}</span>}</span>
    <Badge badge={badge}/>
    {node.props.showsChevron && <ChevronRight size={16} aria-hidden="true"/>}
    {hintId && <span id={hintId} hidden>{node.props.hint}</span>}
  </Pressable>;
}
/** `primary-button`: the filled action button. */
export function PrimaryButtonNode({ node }: { node: NodeOf<'primary-button'> }) {
  const enabled = useEnabled(node.enabledWhen, `${node.id}/enabled`);
  return <Pressable action={node.action} enabled={enabled} className="sh-primary-button">{node.icon && <Glyph symbol={node.icon} size={18}/>}<span>{node.title}</span></Pressable>;
}
/** `account-header`: an avatar and the name; the profile source is not read in the preview, so the fallback name shows. */
export function AccountHeaderNode({ node }: { node: NodeOf<'account-header'> }) {
  const name = node.props.fallbackName;
  return <div className="sh-account"><span className="sh-avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span><strong>{name}</strong></div>;
}
