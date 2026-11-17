import { useRef, type CSSProperties } from 'react';
import { faceState, useFaceReport } from '../grid-groups';
import { ChevronRight, Power } from 'lucide-react';
import type { CompositionActionSlot } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { useElementWidth } from '../useElementWidth';
import { useRender } from '../render-context';
import { Face } from './tile-face';
import { brightnessPercent, lightColor, unavailableText, useEntity, useSimulate, UseButton } from './device-shared';
import { lightTileWidths } from './tile-minimum';
import { tileFit } from './vacuum';
import { Badge, familyStyle, Glyph, useBadge, useSourceRead, type BadgeFace, type NodeOf } from './shared';
import { SwipeFrame, type SwipeSpec } from './swipe';
import type { StateWords } from '../../shared/composition/state-words';
import { lightLine } from '../state-words';

const warm = 'rgb(255 214 170)';

/** `LightControl.isDimmable`: a light with any colour mode beyond `onoff`, or one reporting `brightness`; a switch or an on/off light gets the plain power tile. */
export function isDimmable(entity: NativeState | undefined): boolean {
  if (!entity || !entity.entityId.startsWith('light.')) return false;
  return entity.brightness !== undefined || (entity.supportedColorModes ?? []).some(mode => mode !== 'onoff');
}
/** `LightControl.percent(of:)`: 0 when off or unavailable, 100 when on without a reported level. */
export function lightPercent(entity: NativeState | undefined): number {
  if (!entity || entity.state !== 'on') return 0;
  if (entity.brightness === undefined) return 100;
  return brightnessPercent(entity.brightness) || 100;
}

/**
 * The brightness tile (`UKBrightnessTileView`, pattern `entity-tile`): a warm lit tile whose bright band is the brightness, with the percent
 * under the name, a power disc and, when the tile opens details, the chevron. Off, it is the dark tile with "Off"; unavailable, dimmed.
 * The drag that sets the brightness is not drawn: the preview cannot drag.
 */
export function BrightnessTile({ title, entity, open, swipe, words, badge }: { title: string; /** The count in the corner (`sh.badge-nodes@1`). */ badge?: BadgeFace; entity: NativeState | undefined; open?: CompositionActionSlot; swipe?: SwipeSpec; /** The tile's own words for its states (`sh.state-words@1`). */ words?: StateWords }) {
  const send = useSimulate(), { run } = useRender();
  const dead = !entity || entity.state === 'unavailable' || entity.state === 'unknown';
  const live = !entity || entity.state !== 'on' ? 0 : lightPercent(entity), color = lightColor(entity) ?? warm;
  useFaceReport(faceState(dead, live > 0));
  // A swiped tile draws the dragged level: the band and the percent follow the finger, and at 0 the tile shows its off face (`sh.tile-swipe@1`).
  const tile = (shown?: number) => {
    const percent = shown ?? live, off = percent <= 0;
    const line = lightLine(words, { dead, on: !off, percent, dims: true });
    return <div className="sh-dv-lighttile" data-off={off ? '' : undefined} data-state={dead ? 'unavailable' : undefined} style={{ '--band': color, '--level': swipe?.swipe.band === false ? '0%' : `${percent}%` } as CSSProperties}>
      <span className="sh-dv-lighttile-band" aria-hidden="true"/><span className="sh-dv-lighttile-glyph"><Glyph symbol={{ name: 'lightbulb.fill' }} size={20}/></span>
      <span className="sh-row-copy"><strong>{title}</strong><span>{line}</span></span>
      <UseButton className="sh-dv-disc" label={`Power ${title}`} onPress={() => send(entity?.entityId, 'toggle')}><Power size={18}/></UseButton>
      {open ? <UseButton className="sh-dv-chev" label={`Open ${title}`} onPress={() => run(open)}><ChevronRight size={16}/></UseButton> : null}
      <Badge badge={badge}/>
    </div>;
  };
  return swipe ? <SwipeFrame spec={swipe}>{shown => tile(shown)}</SwipeFrame> : tile();
}

/**
 * `light-group-tile` (`UKLightGroupTileView`): a brightness tile when the light dims, else a power tile with "On", "Off" or "Unavailable" and its
 * power disc. The disc sits right of the words while the room allows, else below them, as the app's tile fits (`UKGlassTileView.fit`).
 */
export function LightGroupTileNode({ node }: { node: NodeOf<'light-group-tile'> }) {
  const entityId = useSourceRead(node.props.sourceId, ['entityId']);
  const entity = useEntity(entityId.status === 'value' && typeof entityId.value === 'string' ? entityId.value : undefined);
  const send = useSimulate();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const badge = useBadge(node.badge, `${node.id}/badge`);
  if (isDimmable(entity)) {
    const swipe = node.props.swipe;
    const spec: SwipeSpec | undefined = swipe ? {
      kind: 'light', swipe, label: 'brightness', words: { off: node.props.words?.off, level: node.props.words?.level }, current: entity && entity.state !== 'unavailable' && entity.state !== 'unknown' ? lightPercent(entity) : undefined,
      enabled: Boolean(entity) && entity!.state !== 'unavailable' && entity!.state !== 'unknown',
      commit: value => send(entity?.entityId, value <= 0 ? 'turn_off' : 'turn_on', value <= 0 ? undefined : { brightness_pct: value }),
    } : undefined;
    return <BrightnessTile title={node.title} entity={entity} swipe={spec} words={node.props.words} badge={badge}/>;
  }
  const dead = !entity || entity.state === 'unavailable' || entity.state === 'unknown', on = entity?.state === 'on';
  const fit = tileFit(width, lightTileWidths(node.title, false));
  const line = lightLine(node.props.words, { dead, on, percent: 100, dims: false });
  return <div ref={ref} className="sh-tile-parts" data-fit={fit} style={{ '--reserve': `${fit === 'below' ? 14 : 44 + 22}px` } as CSSProperties}>
    <Face icon={{ name: 'lightbulb' }} title={node.title} line={line} badge={badge} lit={on && !dead} unavailable={dead} className={on && !dead ? 'sh-lit-warm' : ''} style={familyStyle('lights')}/>
    <span className="sh-tile-discs"><UseButton className="sh-tile-disc" label={`${on ? 'Turn Off' : 'Turn On'} ${node.title}`} disabled={dead} style={dead ? { opacity: .35 } : undefined}
      onPress={() => send(entity?.entityId, on ? 'turn_off' : 'turn_on')}><Power size={18}/></UseButton></span>
  </div>;
}
