import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { isEnabled, ruleHolds, tileFaces, tileProgress } from '../../shared/composition/evaluator';
import { useElementWidth } from '../useElementWidth';
import { discTileWidths } from './tile-minimum';
import { tileFit } from './vacuum';
import { shownEntity } from '../projections';
import { useRender } from '../render-context';
import { resolveTileStyle, ruleFor } from '../../shared/composition/state-styles';
import { previewTile } from '../../shared/composition/state-style-preview';
import { families, familyLook, roomBackground, roomFace, type FamilyName } from '../room-face';
import { cardState, contactTileSubtitle, ventSubtitle, withUnit } from '../room-overview';
import type { NativeState } from '../../shared/native-state';
import { useEntity } from './device-shared';
import { Face } from './tile-face';
import { evaluateOperand } from '../evaluate';
import { overviewLine } from '../state-words';
import { bandShare, SwipeFrame, type SwipeSpec } from './swipe';
import { Badge, isTrue, familyStyle, Glyph, Pressable, rgb, useBadge, useEnabled, useFill, useOperand, useSourceRead, useSourceText, useSymbol, type NodeOf, type SfSymbol } from './shared';

/** The state ids an alarm tile reads as having no value yet or none at all (`EntityState.isUnavailable`). */
const alarmGone = (state: unknown) => state === 'unavailable' || state === 'unknown';
/**
 * `navigation-tile`: opens a page or sheet. With an action it draws the app's trailing chevron, centred (`UKGlassTileView`); no action is the skeleton.
 * With `props.alarm` it draws the alarm's own look, the Security System tile: the icon, colour and words of the alarm's state, the fallback for a state
 * the document does not list, and its loading or unavailable words (`UKServerUIPage` `.navigationTile`). A solid fill is the coloured face: white ink, filled glyph.
 */
export function NavigationTileNode({ node }: { node: NodeOf<'navigation-tile'> }) {
  const alarm = node.props.alarm;
  const subtitle = useOperand(node.props.subtitle, '', `${node.id}/subtitle`);
  const own = rgb(useFill(node.props.presentation?.fill, 'fill', `${node.id}/fill`));
  const alarmState = useSourceRead(alarm?.sourceId, ['state']);
  const look = alarm ? alarm.states.find(item => alarmState.status === 'value' && item.state === alarmState.value)?.appearance ?? alarm.fallback : undefined;
  const fill = look ? rgb(look.fill) : own;
  const line = !alarm ? subtitle.text : alarmState.status === 'loading' ? alarm.loadingText : alarmState.status !== 'value' || alarmGone(alarmState.value) ? alarm.unavailableText : look!.text;
  const badge = useBadge(node.badge, `${node.id}/badge`);
  return <Face icon={look?.icon ?? node.icon} title={node.title} line={line} action={node.action} badge={badge}
    className={`${node.props.presentation?.layout === 'anchored-bottom' ? 'sh-anchored' : ''} ${fill ? 'sh-colored' : ''}`.trim()}
    style={{ ...familyStyle(node.props.family), ...(fill ? { '--fill': fill } : {}) } as CSSProperties} lit={Boolean(fill)}>
    {node.action && <ChevronRight className="sh-tile-chevron" size={14} aria-hidden="true"/>}
  </Face>;
}
/** `action-tile`: a power tile; lit while its source is on. */
export function ActionTileNode({ node }: { node: NodeOf<'action-tile'> }) {
  const state = useSourceText(node.binding.sourceId, 'Unavailable');
  const on = isTrue(useSourceRead(node.binding.sourceId, ['isOn']));
  const labels = node.props.powerLabels;
  const badge = useBadge(node.badge, `${node.id}/badge`);
  return <Face icon={node.icon} title={node.title} line={state.state === 'ready' && labels ? on ? labels.on : labels.off : state.text} action={node.action} badge={badge} lit={on} unavailable={state.state !== 'ready'} style={familyStyle(node.props.family)}/>;
}
/**
 * `state-tile` (`sh.state-style@1`): a tile whose icon, words, indicator and colour come from a state style, resolved the way the
 * app does (`previewTile`). The entity's state picks the rule; the library style by id wins over the built-in one. The disc's verb
 * is the tile's action and is not run here. With no style the tile shows the entity's state in words.
 */
export function StateTileNode({ node }: { node: NodeOf<'state-tile'> }) {
  const { house, overlay, stateStyles, mode, statePreview, ask, note, env, run } = useRender();
  const binding = node.binding;
  const enabled = useEnabled(node.enabledWhen, `${node.id}/enabled`);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  const subtitle = useOperand(node.props.subtitle, '', `${node.id}/subtitle`);
  const entity = shownEntity(house, overlay, binding.entityId);
  const style = resolveTileStyle(binding, stateStyles);
  // In Use a tap plays the style's tap: the in-progress look for a second, then the entity's own state again.
  const [sending, setSending] = useState(false);
  useEffect(() => { if (!sending) return; const timer = window.setTimeout(() => setSending(false), 1000); return () => window.clearTimeout(timer); }, [sending]);
  const frame = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frame);
  const forced = mode === 'edit' && statePreview?.nodeId === node.id ? statePreview : undefined;
  const state = forced ? forced.state : entity?.state;
  const request = forced ? { inFlight: forced.phase === 'sending', failed: forced.phase === 'failed' } : { inFlight: sending };
  // The tile's own look conditions (`sh.tile-look@1`) override the style's class for their face.
  const look = style ? previewTile(style, state, binding.overrides ?? [], request, node.icon.name, tileFaces(node, env)) : undefined;
  const action = !style || !look || look.stateClass === 'unknown' || request.inFlight || request.failed ? undefined : ruleFor(style, state ?? 'unavailable').action;
  const play = () => {
    const start = () => { setSending(true); note?.(`${node.title}: ${action?.verb ?? ''}`.trim()); };
    const confirmation = action?.confirmation;
    if (confirmation && ask) ask({ title: confirmation.title, message: confirmation.message || undefined, confirmLabel: confirmation.confirmVerb, cancelLabel: 'Cancel', destructive: false }, start);
    else start();
  };
  // The tile's own ink (`sh.tile-ink@1`). A face with a fill, or the filled face, keeps its white ink; an error face keeps its red glyph; an unavailable face keeps the muted grey (`TileFaceInk.glyphToken`). The icon tint is for the rest.
  const filledFace = Boolean(look?.filled || look?.fill);
  const glyphTint = !filledFace && look?.stateClass !== 'error' && look?.stateClass !== 'unknown' ? rgb(look?.glyphTint ?? node.glyphTint) : undefined;
  const natural = node.cellFit === 'natural';
  const discTint = !filledFace ? rgb(node.discGlyphTint) : undefined;
  const faceStyle = { ...(look?.fill ? { '--fill': rgb(look.fill) } : {}), ...(glyphTint ? { '--glyph': glyphTint } : {}) } as CSSProperties;
  // Swipe to adjust (`sh.tile-swipe@1`): the number the tile shows now, and a release that sends the authored call with the snapped value as `control`.
  const swipe = node.props.swipe;
  const swiped = swipe?.value ? evaluateOperand(swipe.value, env) : undefined;
  const current = swiped?.status === 'value' && typeof swiped.value === 'number' && Number.isFinite(swiped.value) ? swiped.value : undefined;
  const spec: SwipeSpec | undefined = swipe && swipe.action ? {
    kind: 'state', swipe, current, label: swipe.label ?? 'value', enabled: enabled && current !== undefined && look?.stateClass !== 'unknown',
    commit: value => run(swipe.action!, value),
  } : undefined;
  const faceFor = (shown?: number) => <Face icon={look ? { name: look.icon } : node.icon} title={node.title} line={look ? subtitle.text || look.text : subtitle.text || entity?.state || 'Unavailable'} lit={look?.colour.active || Boolean(look?.fill)}
    style={Object.keys(faceStyle).length ? faceStyle : undefined} action={node.action} press={!node.action && look && action && action.tappable !== false && look.acceptsTaps ? play : undefined}
    badge={badge} enabled={enabled} unavailable={look?.stateClass === 'unknown' || !entity || entity.state === 'unavailable'} className={look ? `sh-state-tile sh-class-${look.colour.class} sh-effect-${look.indicator}${look.filled ? ' sh-filled' : ''}${look.fill ? ` sh-fill-ink-${look.fillInk ?? 'white'}` : ''}${glyphTint ? ' sh-glyph-tinted' : ''}${natural ? ' sh-cell-natural' : ''}` : `${glyphTint ? 'sh-glyph-tinted' : ''}${natural ? ' sh-cell-natural' : ''}`.trim()}>
    {look?.showsArc ? <span className="sh-state-arc" data-testid="state-arc" aria-hidden="true"/> : null}
    {look ? <span className="sh-state-spoken" data-testid="state-voiceover" hidden>{look.voiceOver}</span> : null}
    {spec ? (share => share === null ? null : <span className="sh-swipe-band" data-testid="swipe-band" aria-hidden="true" style={{ '--share': share } as CSSProperties}/>)(bandShare(spec, shown)) : <TileProgress operand={node.props.progress}/>}
  </Face>;
  const discs = (node.props.discs ?? []).filter(disc => mode === 'edit' || ruleHolds(disc, env));
  const compose = (shown?: number) => {
  const face = faceFor(shown);
  if (!discs.length && !node.action && !node.props.progress && !spec) return face;
  // The tile has parts: its buttons trail the text, then drop below it when the room is under the floor (`UKGlassTileView.fit(forWidth:)`).
  const fit = discs.length ? tileFit(width, discTileWidths(node.title, discs.length)) : 'natural';
  const reserve = discs.length * 44 + Math.max(0, discs.length - 1) * 8 + (node.action ? 28 : 0) + 22;
  return <div ref={frame} className="sh-tile-parts" data-fit={fit} data-face={filledFace ? 'filled' : undefined} data-cell-fit={natural ? 'natural' : undefined}
    style={{ '--reserve': `${fit === 'below' ? 14 : reserve}px`, ...(discTint ? { '--disc-glyph': discTint } : {}) } as CSSProperties}>
    {face}
    {discs.length > 0 && <span className="sh-tile-discs">{discs.map(disc => <TileDisc key={disc.id} disc={disc} tile={node} enabled={enabled}/>)}</span>}
    {node.action && <ChevronRight className="sh-tile-chevron" size={14} aria-hidden="true"/>}
  </div>;
  };
  return spec ? <SwipeFrame spec={spec}>{shown => compose(shown)}</SwipeFrame> : compose();
}
type Disc = NonNullable<NodeOf<'state-tile'>['props']['discs']>[number];
/**
 * One round button of a state tile. Its symbol and label follow their rule or expression (`sh.tile-disc-rules@1`); VoiceOver reads the label, and
 * the tile's title after it when the disc `namesTile`. A disc that is hidden by its rule still shows in Edit, dimmed.
 */
function TileDisc({ disc, tile, enabled }: { disc: Disc; tile: NodeOf<'state-tile'>; enabled: boolean }) {
  const { env } = useRender();
  const symbol = useSymbol(disc.icon, `${tile.id}/disc/${disc.id}/icon`);
  const words = useOperand(typeof disc.label === 'string' ? { type: 'literal', value: disc.label } : disc.label, '', `${tile.id}/disc/${disc.id}/label`).text;
  const holds = ruleHolds(disc, env), on = isEnabled(disc.enabledWhen, env) && enabled;
  const label = disc.namesTile ? `${words} ${tile.title}`.trim() : words;
  return <Pressable action={disc.action} enabled={on} label={label} className="sh-tile-disc" style={holds ? undefined : { opacity: .45 }}><Glyph symbol={symbol} size={18}/></Pressable>;
}
/** The fill from the tile's leading edge to a fraction (`sh.tile-parts@1`): a lighter band, a `progressbar` only while it has a number. */
function TileProgress({ operand }: { operand: NodeOf<'state-tile'>['props']['progress'] }) {
  const { env } = useRender();
  const fraction = tileProgress(operand, env);
  if (fraction === null) return null;
  return <span className="sh-tile-progress" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={fraction} aria-label="Progress" style={{ '--progress': fraction } as CSSProperties}/>;
}
/**
 * How a room card or chip is coloured (`RoomTileFace.resolve`, `RoomFormat.background`, `TileFaceStyle.resolve`): the kind's colour family on the
 * glyph, and the family's face while the entity is active (`activeStates`, else `RoomFormat.isActive`): the lights family is the warm lit tile,
 * any other family its fill with white ink. A `stateColors` entry or the climate action tone paints the fill instead.
 */
function useRoomLook(props: NodeOf<'room-card'>['props'], bindingSourceId: string, icon: string): { style: CSSProperties; lit: boolean; className: string; entity: NativeState | undefined } {
  const entityId = useSourceRead(bindingSourceId, ['entityId']);
  const entity = useEntity(entityId.status === 'value' && typeof entityId.value === 'string' ? entityId.value : undefined);
  const face = roomFace(props.kind, icon, entity, props.activeStates), look = familyLook(face.family, face.active);
  const own = face.active ? roomBackground(props, entity) : undefined, fill = own ?? look.fill;
  return { entity, lit: Boolean(fill) || look.className === 'sh-lit-warm', className: own ? 'sh-lit-filled' : look.className,
    style: { '--glyph': look.glyph, ...(fill ? { '--fill': fill } : {}) } as CSSProperties };
}
/** The entities of a list of sources, as the house shows them. One hook however many sources, so a card with more or fewer sources keeps its hooks. */
function useSourceEntities(sourceIds: readonly string[]): (NativeState | undefined)[] {
  const { env, house, overlay } = useRender();
  return sourceIds.map(id => {
    const read = env.read(id, ['entityId']);
    return read.status === 'value' && typeof read.value === 'string' ? shownEntity(house, overlay, read.value) : undefined;
  });
}
/**
 * The state line of a room card (`UKServerUIRooms.bind`): the sources' states with their units joined by " • ", else the card's state when it
 * asks for it (`RoomFormat.cardState`, a vent's `ClimateLogic.ventSubtitle` while it has no label for the state). A contact card with no action,
 * no power, no sources and no state asks for none, but still says Unavailable or Unknown (`RoomFormat.contactTileSubtitle`).
 */
export function roomCardLine(props: NodeOf<'room-card'>['props'], entity: NativeState | undefined, sources: readonly (NativeState | undefined)[]): string {
  if (sources.length) return sources.map(withUnit).join(' • ');
  if (props.showState) {
    return props.kind === 'vent' && !props.stateLabels.some(item => item.state === entity?.state) ? ventSubtitle(entity) : cardState(props.stateLabels, entity);
  }
  return props.kind === 'contact' && !props.action && !props.power ? contactTileSubtitle(entity) : '';
}
/** `room-card`: a room with its glyph and its state line, in its kind's colour family. */
export function RoomCardNode({ node }: { node: NodeOf<'room-card'> }) {
  const look = useRoomLook(node.props, node.binding.sourceId, node.icon.name);
  const sources = useSourceEntities(node.props.subtitleSourceIds);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  return <Face icon={node.icon} title={node.title} line={roomCardLine(node.props, look.entity, sources)} action={node.props.action} badge={badge} lit={look.lit} style={look.style} className={look.className}/>;
}
/** `room-chip`: the compact form of a room card. */
export function RoomChipNode({ node }: { node: NodeOf<'room-chip'> }) {
  const line = useSourceText(node.props.subtitleSourceIds[0], '');
  const look = useRoomLook(node.props, node.binding.sourceId, node.icon.name);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  // The chip has no lit face of its own: the lights family fills it with its amber.
  const fill = (look.style as Record<string, string>)['--fill'] ?? (look.className === 'sh-lit-warm' ? families.lights.fill : undefined);
  return <Pressable action={node.props.action} className={`sh-chip ${node.props.action ? 'sh-pressable' : ''}`}
    style={{ ...look.style, ...(fill ? { background: fill } : {}) }}><span className="sh-chip-glyph"><Glyph symbol={node.icon} size={18}/></span><span className="sh-chip-text"><strong>{node.title}</strong>{line.text && <span>{line.text}</span>}</span><Badge badge={badge}/></Pressable>;
}
/** The state a chip or overview tile shows: the matching `states` entry, else the fallback appearance. */
function useAppearance(nodeId: string, props: NodeOf<'status-chip'>['props']) {
  const state = useSourceRead(props.sourceId, ['state']);
  const text = useSourceText(props.sourceId, '');
  const match = state.status === 'value' ? props.states.find(item => item.state === String(state.value)) : undefined;
  const chosen = match?.appearance ?? props.fallback;
  // A slot that follows a rule or an entity keeps what it showed while its value is loading; a color is clamped to read (`sh.rules@1`).
  const appearance = {
    icon: useSymbol(chosen.icon, `${nodeId}/icon`), glyph: useFill(chosen.glyph, 'glyph', `${nodeId}/glyph`),
    fill: useFill(chosen.fill, 'fill', `${nodeId}/fill`) ?? { type: 'standard' as const },
  };
  return { appearance, text: match?.text ?? text.text, loading: state.status === 'loading' };
}
/**
 * `status-chip`: one chip of the status rail. The title sits over the state, as the app's chip stacks them (`UKStatusChipView.layoutValues`);
 * the capsule is at least 48 points tall (`StatusChipStyle.minHeight`) and grows with its text.
 */
export function StatusChipNode({ node }: { node: NodeOf<'status-chip'> }) {
  const { appearance, text, loading } = useAppearance(node.id, node.props);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  const fill = rgb(appearance.fill), glyph = rgb(appearance.glyph);
  return <Pressable action={node.action} className={`sh-chip ${node.action ? 'sh-pressable' : ''}`} style={{ ...(fill ? { background: fill } : {}), ...(glyph ? { '--glyph': glyph } : {}) } as CSSProperties}>
    <span className="sh-chip-glyph"><Glyph symbol={appearance.icon} size={16}/></span>
    <span className="sh-chip-text"><strong>{node.title}</strong><span data-state={loading ? 'loading' : undefined}>{text}</span></span>
    <Badge badge={badge}/>
  </Pressable>;
}
/** The states a contact overview reads as "the contact sensors are fine to show quietly" (`UKServerUIPage` `hiddenSubtitle`). */
const quietContactStates = ['idle', 'open-home', 'open-away', 'open-armed'];
/**
 * `room-overview-tile`: a room's overview as a tile with its state line, in the colour family its source's projection names (lights, climate, vents,
 * contacts, occupancy, air quality), lit while the source is active or an AQI colour or an authored fill is set (`UKServerUIPage` `.roomOverviewTile`,
 * `UKGlassTileModel.isActive`). An authored solid fill is the coloured face. A contact overview may hide its line (`hidesContactSubtitle`).
 */
export function RoomOverviewTileNode({ node }: { node: NodeOf<'room-overview-tile'> }) {
  const { appearance, text } = useAppearance(node.id, node.props);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  const familyName = useSourceRead(node.props.sourceId, ['family']), tint = useSourceRead(node.props.sourceId, ['color']);
  const active = useSourceRead(node.props.sourceId, ['isActive']), state = useSourceRead(node.props.sourceId, ['state']), phase = useSourceRead(node.props.sourceId, ['phase']);
  const facts = { projection: useSourceRead(node.props.sourceId, ['projection']), format: useSourceRead(node.props.sourceId, ['format']), count: useSourceRead(node.props.sourceId, ['count']), total: useSourceRead(node.props.sourceId, ['total']) };
  const said = (read: { status: string; value?: unknown }) => read.status === 'value' ? read.value : undefined;
  const words = node.props.words ? overviewLine(node.props.words, { projection: said(facts.projection), format: said(facts.format), count: said(facts.count), total: said(facts.total), phase: phase.status === 'value' ? phase.value : undefined }, text) : text;
  const name = (familyName.status === 'value' && typeof familyName.value === 'string' && familyName.value in families ? familyName.value : 'neutral') as FamilyName;
  const unavailable = phase.status === 'value' && phase.value === 'unavailable';
  const fill = unavailable ? undefined : rgb(appearance.fill), glyph = rgb(appearance.glyph);
  const lit = !unavailable && (isTrue(active) || Boolean(fill) || (tint.status === 'value' && typeof tint.value === 'string'));
  const look = familyLook(name, lit && !fill);
  const hidden = node.props.hidesContactSubtitle && name === 'contact' && state.status === 'value' && quietContactStates.includes(String(state.value));
  const paint = fill ?? look.fill;
  return <Face icon={appearance.icon} title={node.title} line={hidden ? '' : words} action={node.action} badge={badge} unavailable={unavailable} lit={Boolean(paint) || look.className === 'sh-lit-warm'}
    className={fill ? 'sh-colored' : look.className}
    style={{ '--glyph': glyph ?? look.glyph, ...(paint ? { '--fill': paint } : {}) } as CSSProperties}>
    {node.action && <ChevronRight className="sh-tile-chevron" size={14} aria-hidden="true"/>}
  </Face>;
}
