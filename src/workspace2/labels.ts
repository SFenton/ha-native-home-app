/**
 * The authored label map (spec section 7). A field is found by the type of the object that owns it and its path
 * below that object (array indexes dropped), then by the path alone, then by its last key. A mapped field says what
 * it is called, where it sits in the properties and how its values read. An editable field with no entry is shown
 * under Advanced with a mechanical label, so nothing becomes unreachable.
 *
 * Deviation from the spec: this lives in `src/workspace2/` rather than `src/shared/composition/` (the lane owns only the former).
 */

/** The four groups of the properties body, in order. */
export type FieldGroup = 'what' | 'look' | 'behaviour' | 'advanced';
export const groupOrder: readonly FieldGroup[] = ['what', 'look', 'behaviour', 'advanced'];
export const groupTitles: Record<FieldGroup, string> = { what: '', look: '', behaviour: 'Behaviour', advanced: 'Advanced' };

/** One authored entry. */
export interface FieldLabel {
  label: string;
  group?: FieldGroup;
  order?: number;
  /** One sentence under the control, only when it says something the control cannot. */
  caption?: string;
  /** Value to words, for choices. */
  options?: Record<string, string>;
  /** Never shown; the part is edited somewhere else. */
  hidden?: boolean;
}

const entry = (label: string, more: Omit<FieldLabel, 'label'> = {}): FieldLabel => ({ label, ...more });
const behaviour = (label: string, order: number, more: Omit<FieldLabel, 'label' | 'group' | 'order'> = {}) => entry(label, { group: 'behaviour', order, ...more });
const advanced = (label: string, more: Omit<FieldLabel, 'label' | 'group'> = {}) => entry(label, { group: 'advanced', ...more });
const unknownPolicy = { show: 'Show', hide: 'Hide', keep: 'Keep last' };

/** Entries by `<owner type>.<path>` or `*.<path>` / `*.<last key>`. */
export const labelMap: Readonly<Record<string, FieldLabel>> = {
  '*.title': entry('Title', { order: 1 }), '*.label': entry('Label', { order: 1 }), '*.menuLabel': entry('Menu label', { order: 2 }),
  '*.subtitle': entry('Subtitle', { order: 2 }), '*.detail': entry('Subtitle', { order: 2 }),
  '*.icon': entry('Icon', { order: 3 }),
  '*.binding.sourceId': entry('Entity', { order: 4 }), '*.props.sourceId': entry('Entity', { order: 4 }), '*.entityId': entry('Entity', { order: 4 }),
  '*.layout.span': entry('Width', { group: 'look', order: 1 }),
  '*.props.family': entry('Colour', { group: 'look', order: 2, options: { neutral: 'Neutral', lights: 'Lights', occupancy: 'Occupancy' } }),
  '*.action': behaviour('When tapped', 1), '*.visibleWhen': behaviour('Visible when', 2),
  '*.whenUnknown': advanced('While the state is unknown', { options: unknownPolicy }),
  '*.titleSourceId': entry('Title from', { order: 5 }),
  'page.navigation.type': entry('Open pages beside this one', { group: 'look', order: 1, options: { stack: 'Off', 'navigation-columns': 'On' } }),
  'page.navigation.placeholder': entry('Empty side text', { group: 'look', order: 2 }),
  'page.navigation.onDemand': advanced('Start with one pane'), 'page.navigation.standalone': advanced('Start a new column set here'),
  'page.toolbar': entry('Header buttons', { group: 'look', order: 3, options: { inherit: 'Same as app', replace: 'Custom' } }),
  'sheet.presentation.height': entry('Height', { group: 'look', order: 1, options: { full: 'Full', fitted: 'Fitted' } }),
  'sheet.presentation.height.follows': advanced('Fit to', { options: { root: 'First page', 'top-page': 'Top page' } }),
  'sheet.presentation.width': entry('Width on iPad', { group: 'look', order: 2, options: { form: 'Form', page: 'Page' } }),
  'sheet.presentation.appearance': entry('Appearance', { group: 'look', order: 3, options: { system: 'System', dark: 'Dark' } }),
  'sheet.presentation.adaptive': entry('Open beside the list when there is room', { group: 'look', order: 4 }),
  'sheet.presentation.fullScreen': entry('Full screen', { group: 'look', order: 5 }),
  'sheet.presentation.close.visibility': entry('Close button', { group: 'look', order: 6, options: { 'root-only': 'First page only', 'all-depths': 'Every page' } }),
  'sheet.presentation.close.rail': advanced('Close button on the side rail', { options: { automatic: 'Automatic', 'keep-horizontal-when-allowed': 'Top bar only' } }),
  '*.ifPresented': behaviour('If a sheet is already open', 3, { options: { reject: 'Do nothing', replace: 'Replace it' } }),
  '*.confirmation': behaviour('Ask first', 4),
  'navigation.initialTabId': entry('Opens first', { order: 1 }), 'navigation.initialPageId': entry('First page', { group: 'advanced' }),
  'chrome.override': entry('Header buttons'),
  '*.rail': entry('On the side rail', { options: { eligible: 'Allowed', 'horizontal-only': 'Top bar only' } }),
  '*.visibility': entry('Show', { options: { always: 'Always', 'root-only': 'First page only' } }),
  '*.padding': advanced('Padding'), '*.spacing': advanced('Spacing'), '*.maxWidth': advanced('Max width'),
  '*.layout.padding': advanced('Padding'), '*.layout.spacing': advanced('Spacing'), '*.layout.maxWidth': advanced('Max width'),
  '*.path': entry('Path'), '*.aliases': entry('Aliases'), '*.keywords': entry('Keywords'), '*.siri': entry('Siri phrase'),
  '*.anchors': entry('Sheets opened first'),
  '*.arrivalAnnouncement': entry('Ready announcement'),
  '*.recovery.loadingTitle': entry('Loading title'), '*.recovery.unavailableTitle': entry('Unavailable title'),
  '*.recovery.unavailableMessage': entry('Unavailable message'), '*.recovery.retryLabel': entry('Retry button'),
  '*.explanation': entry('Why we ask'),
  '*.id': advanced('ID'),
};

/** `key` split into words, sentence case, with "Id" as "ID". */
export function mechanicalLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim().toLowerCase().split(/\s+/);
  const text = words.map(word => word === 'id' ? 'ID' : word).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The path as the map spells it: dotted, without array indexes. */
export const mapPath = (path: readonly (string | number)[]) => path.filter(part => typeof part === 'string').join('.');

/** The entry for a field, if one is authored. */
export function labelFor(owner: string, path: readonly (string | number)[]): FieldLabel | undefined {
  const dotted = mapPath(path), last = String(path.filter(part => typeof part === 'string').at(-1) ?? '');
  return labelMap[`${owner}.${dotted}`] ?? labelMap[`*.${dotted}`] ?? labelMap[`*.${last}`];
}

/** What a field is called, authored or mechanical. */
export const labelText = (owner: string, path: readonly (string | number)[]) => labelFor(owner, path)?.label ?? mechanicalLabel(String(path.filter(part => typeof part === 'string').at(-1) ?? ''));
