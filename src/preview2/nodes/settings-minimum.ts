import type { CompositionNode } from '../../shared/composition/schema';
import type { SettingsKind } from '../../shared/composition/settings';
import { titleWidth } from './tile-minimum';

/** The kinds whose row ends in a state or a choice read from the entity: the word "Unavailable" is the widest it shows. */
const valued: readonly SettingsKind[] = ['household-read-only', 'presence-room', 'vacation-status', 'away-status', 'location-status', 'feedback-status', 'location-account', 'ha-value', 'app-version'];
/** The kinds that end in a switch. */
const switched: readonly SettingsKind[] = ['household-toggle', 'household-recovery', 'app-badge', 'performance-recording', 'vacation-toggle', 'solo-toggle'];
/** The kinds that carry the document's glyph before their name (the same list the row draws by). */
const glyphed: readonly SettingsKind[] = ['household-toggle', 'household-recovery', 'household-read-only', 'presence-room', 'presence-choice', 'vacation-toggle', 'solo-toggle',
  'solo-traveler', 'location-account', 'location-action', 'sign-out', 'app-icon-choice', 'away-restore', 'profile-person', 'ha-web'];

/** The widest state a row shows beside its name, in points at the row's 17 point text. */
const WIDEST_VALUE = 92;
/** A switch (`UISwitch`) and the gap before a trailing control. */
const SWITCH = 51, GAP = 12, PADDING = 16, GLYPH = 24, CHEVRON = 16;

/**
 * The least width a settings row declares in a grid, or 0 for a node that is not a settings row. A row is a name beside its state or switch; in a grid whose
 * columns are narrower than that, the name and the state would paint under one another, so the grid gives the row the tracks it needs (the way a tile with
 * discs does, `UKGridMeasuring.gridMinimumWidth`) and the row takes a whole line when the columns are narrow.
 */
export function settingsRowMinimum(node: CompositionNode): number {
  if (node.type !== 'settings-control') return 0;
  const kind = node.props.kind;
  const trailing = valued.includes(kind) ? WIDEST_VALUE + (kind === 'presence-room' || kind === 'location-account' ? GAP + CHEVRON : 0) : switched.includes(kind) ? SWITCH : 0;
  if (trailing === 0) return 0;
  return 2 * PADDING + (glyphed.includes(kind) ? GLYPH + GAP : 0) + titleWidth(node.title) + GAP + trailing;
}
