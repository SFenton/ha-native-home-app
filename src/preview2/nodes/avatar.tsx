import type { CSSProperties } from 'react';
import { initialsOf } from '../../shared/composition/profile-badges';
import { useRender } from '../render-context';
import { useEntity } from './device-shared';
import { Badge, GlyphByName, Pressable, rgb, useBadge, type NodeOf } from './shared';

/** The standard disc colour, the action blue (0, 0.40, 0.80): 5.57 to 1 under white. */
export const STANDARD_DISC = '#0066CC';
/** The points of a Profile Icon node's sizes (scaled with Dynamic Type in the app; the preview draws the default). */
export const avatarPoints = { row: 36, large: 84 } as const;

/** The name the preview knows for the signed-in person: the friendly name of the viewer's `person.*` entity, when the house has one. */
export function useViewerName(): string | undefined {
  const { house } = useRender();
  return useEntity(house.viewer?.personEntityId)?.name;
}

/**
 * The Profile Icon disc: white initials on the fill, drawn the way the app draws a person without a photo (`UKMonogramAvatar`). The preview never draws a
 * photo: the Studio does not proxy a person's picture, which is house data. With no name to take letters from, or for `symbol`, the person glyph is drawn.
 */
export function AvatarDisc({ name, size, look = 'photo', fill, className = '' }: {
  name?: string; size: number; look?: 'photo' | 'initials' | 'symbol'; fill?: CSSProperties['background']; className?: string;
}) {
  const initials = look === 'symbol' ? undefined : initialsOf(name);
  return <span className={`sh-avatar-disc ${className}`.trim()} aria-hidden="true" data-look={initials ? 'initials' : 'symbol'}
    style={{ width: size, height: size, background: fill ?? STANDARD_DISC, fontSize: Math.round(size * 0.4) } as CSSProperties}>
    {initials ?? <GlyphByName name="person" size={Math.round(size * 0.5)}/>}
  </span>;
}

/**
 * `avatar` (`sh.avatar@1`), "Profile Icon" in the Studio: the disc of the signed-in person or of one `person.*` entity, 36 pt (`row`) or 84 pt (`large`, with
 * its title under it). With an action it is a button whose target is at least 44 pt; the title is its VoiceOver label and the badge's spoken words follow it.
 */
export function AvatarNode({ node }: { node: NodeOf<'avatar'> }) {
  const { house } = useRender();
  const person = node.props.person;
  const entity = useEntity(person.type === 'person' ? person.entityId : house.viewer?.personEntityId);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  const size = node.props.size ?? 'row', points = avatarPoints[size], fill = node.props.fill?.type === 'solid-rgb' ? rgb(node.props.fill) : undefined;
  const words = [node.title.trim(), badge.spoken ?? ''].filter(Boolean).join(', ');
  const body = <>
    <span className="sh-avatar-stage" style={{ width: points, height: points, '--disc': `${points}px` } as CSSProperties}>
      <AvatarDisc name={entity?.name} size={points} look={node.props.look} fill={fill}/><Badge badge={badge}/>
    </span>
    {size === 'large' && node.title.trim() ? <span className="sh-avatar-title">{node.title}</span> : null}
  </>;
  const className = `sh-avatar-node sh-avatar-${size}`;
  if (node.action) return <Pressable action={node.action} className={`${className} sh-pressable`} label={words}>{body}</Pressable>;
  return words ? <div className={className} role="img" aria-label={words}>{body}</div> : <div className={className} aria-hidden="true">{body}</div>;
}
