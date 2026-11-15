import {
  colourAllowed, ruleFor, type StateClass, type StateIndicator, type StateOverride, type StateStyleDefinition,
} from './state-styles';

/**
 * The Studio's preview of a state-styled tile, resolved the way the app resolves it: `StateStyle.resolve` and `UKStateTileLooks`
 * (`.agents/design/state-styled-tile.md`). The preview has no live entity, so it takes the state as a value and the request phase as a
 * choice. The four layers, the disc or the arc in its place, and the VoiceOver value all come from here, so the panel and the tests
 * read one function.
 */

/** Where the request stands in the preview, which the style cannot know. */
export interface PreviewRequest { inFlight?: boolean; failed?: boolean }

/** The tile's face: the class tint and whether it is lit. */
export interface PreviewColour { class: StateClass; active: boolean }

/** What one state of one tile draws. */
export interface TilePreview {
  state: string;
  stateClass: StateClass;
  active: boolean;
  /** The icon layer: the action's symbol, else the rule's icon, else the node's own icon, else a plain circle. */
  icon: string;
  /** The text layer. */
  text: string;
  /** The indicator layer after the defaults and the request. */
  indicator: StateIndicator;
  /** The colour layer: the class face, lit or unlit. The class is always the resolved one; a token sets only the lit flag. */
  colour: PreviewColour;
  /** The disc's action verb, when the state offers one. */
  verb?: string;
  /** The disc takes a tap now. */
  acceptsTaps: boolean;
  /** The arc stands in the disc's place. */
  showsArc: boolean;
  /** The disc's opacity: 0 while the arc stands in, 0.5 for the unknown class, else 1. */
  discOpacity: number;
  /** What VoiceOver reads for the value. */
  voiceOver: string;
}

/** The indicator a class takes when the style names none: Warning pulses, Error wiggles, in-progress spins an arc unless a tap works. */
export function defaultIndicator(stateClass: StateClass, hasAction: boolean): StateIndicator {
  switch (stateClass) {
    case 'in-progress': return hasAction ? 'none' : 'arc-spinner';
    case 'warning': return 'pulse';
    case 'error': return 'wiggle';
    default: return 'none';
  }
}

/** Home Assistant's state name as words: `armed_home` reads "Armed Home". */
export const titleCase = (state: string | undefined): string =>
  !state ? 'Unavailable' : state.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** The VoiceOver suffix a class adds to the words, unless they already say it. */
export function spokenValue(text: string, stateClass: StateClass): string {
  const suffix = ({ 'in-progress': 'in progress', warning: 'warning', error: 'error', resting: undefined, unknown: undefined } as const)[stateClass];
  if (!suffix || text.toLowerCase().includes(suffix)) return text;
  return text ? `${text}, ${suffix}` : suffix;
}

const isUnavailable = (state: string | undefined) => !state || state === 'unavailable' || state === 'unknown';

/**
 * Resolves `state` against `style` for one tile.
 * @param overrides The tile's per-layer overrides; the one for `state` replaces the layers it sets.
 * @param request A call in flight makes the tile in-progress from the same frame; a failed one is an error.
 * @param nodeIcon The node's own icon (SF Symbol name), drawn when no state layer gives a glyph, as the app does.
 */
export function previewTile(style: StateStyleDefinition, state: string | undefined, overrides: StateOverride[] = [], request: PreviewRequest = {}, nodeIcon?: string): TilePreview {
  const unknown = isUnavailable(state);
  const base = ruleFor(style, unknown ? 'unavailable' : state!);
  const layer = overrides.find(item => item.state === state);
  const rule = { ...base, ...(layer?.icon ? { icon: layer.icon } : {}), ...(layer?.text ? { text: layer.text } : {}),
    ...(layer?.indicator ? { indicator: layer.indicator } : {}), ...(layer?.colour ? { colour: layer.colour } : {}) };
  const action = rule.action;
  // A style with no unknown rule gets one made for it (`ruleFor`): the node's own icon, not the copied action's.
  const synthesized = unknown && !style.rules.some(item => item.class === 'unknown');
  const stateClass: StateClass = unknown ? 'unknown' : request.failed ? 'error' : request.inFlight ? 'in-progress' : rule.class;
  const takesTap = Boolean(action) && action?.tappable !== false && !request.inFlight && !unknown;
  const resolved = rule.indicator ?? defaultIndicator(rule.class, action?.tappable !== false && Boolean(action));
  let indicator: StateIndicator = stateClass === rule.class && !request.inFlight ? resolved : defaultIndicator(stateClass, takesTap);
  if (stateClass === 'in-progress' && !takesTap) indicator = 'arc-spinner';
  if (stateClass === 'in-progress' && takesTap && indicator === 'arc-spinner') indicator = 'none';
  const showsArc = indicator === 'arc-spinner';
  // A token sets the lit flag of a resting or in-progress face and nothing else: the class, the words and the effects stay the map's.
  const lit = rule.colour && colourAllowed(stateClass) ? rule.colour === 'lit' : rule.active;
  const colour: PreviewColour = { class: stateClass, active: lit };
  const text = rule.text ?? titleCase(state);
  const spoken = spokenValue(text, stateClass);
  return {
    state: state ?? 'unavailable', stateClass, active: rule.active, icon: synthesized ? nodeIcon ?? action?.icon ?? 'circle' : action?.icon ?? rule.icon ?? nodeIcon ?? 'circle', text, indicator, colour,
    ...(action ? { verb: action.verb } : {}), acceptsTaps: !showsArc && stateClass !== 'unknown',
    showsArc, discOpacity: showsArc ? 0 : stateClass === 'unknown' ? 0.5 : 1,
    voiceOver: showsArc ? `${spoken}, dimmed` : spoken,
  };
}

/** The viewport widths the preview shows, in CSS points: iPhone, iPhone Duo (one folded page) and iPad. */
export const previewWidths = [{ id: 'iphone', label: 'iPhone', width: 393 }, { id: 'duo', label: 'Duo', width: 540 }, { id: 'ipad', label: 'iPad', width: 820 }] as const;
/** The cross-fade between the disc and the arc, in seconds (`state-styled-tile.md`, Transitions). */
export const arcCrossFadeSeconds = 0.2;
