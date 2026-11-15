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
  /** The words on the add button of a list. */
  add?: string;
}

const entry = (label: string, more: Omit<FieldLabel, 'label'> = {}): FieldLabel => ({ label, ...more });
const behaviour = (label: string, order: number, more: Omit<FieldLabel, 'label' | 'group' | 'order'> = {}) => entry(label, { group: 'behaviour', order, ...more });
const advanced = (label: string, more: Omit<FieldLabel, 'label' | 'group'> = {}) => entry(label, { group: 'advanced', ...more });
const unknownPolicy = { show: 'Show', hide: 'Hide', keep: 'Keep last' };

/** Entries by `<owner type>.<path>` or `*.<path>` / `*.<last key>`. */
const authored: Record<string, FieldLabel> = {
  '*.title': entry('Title', { order: 1 }), '*.label': entry('Label', { order: 1 }), '*.menuLabel': entry('Menu label', { order: 2 }),
  '*.subtitle': entry('Subtitle', { order: 2 }), '*.detail': entry('Subtitle', { order: 2 }),
  '*.icon': entry('Icon', { order: 3 }),
  '*.binding.sourceId': entry('Entity', { order: 4 }), '*.props.sourceId': entry('Entity', { order: 4 }), '*.entityId': entry('Entity', { order: 4 }),
  '*.layout.span': entry('Width', { group: 'look', order: 1 }),
  '*.props.family': entry('Colour', { group: 'look', order: 2, options: { neutral: 'Neutral', lights: 'Lights', occupancy: 'Occupancy' } }),
  '*.action': behaviour('When tapped', 1), '*.onAction': behaviour('When turned on', 1), '*.offAction': behaviour('When turned off', 2), '*.visibleWhen': behaviour('Visible when', 2),
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
  '*.icon.name': entry('Icon', { order: 3 }),
  'project.dataSources': entry('Data', { add: 'Add Source' }), 'project.localState': entry('Local State', { add: 'Add State' }),
  'project.liveActivities': entry('Live Activities', { add: 'Add Activity' }), 'project.extensions.routes': entry('Links', { add: 'Add Link' }),
  'project.extensions.cameras': entry('Camera notifications', { add: 'Add Camera' }),
  'chrome.groups': entry('Header Buttons', { add: 'Add Button' }), 'chrome.groups.items': entry('Buttons', { add: 'Add Button' }),
  'tab.tabs': entry('Tabs', { add: 'Add Tab' }),
  // Project > Live Activities and its camera notifications.
  'activity.jobId': entry('Job ID', { order: 1, caption: 'Matches the job’s tag without “job.”.' }),
  'activity.glyph': entry('Glyph', { group: 'look', order: 1, options: { fan: 'Fan', dishwasher: 'Dishwasher', dryer: 'Dryer', washer: 'Washer', vacuum: 'Vacuum', hot_flash: 'Hot flash', generic: 'Generic' } }),
  'activity.tint': entry('Tint', { group: 'look', order: 2, options: { engine: 'Engine', neutral: 'Neutral', air: 'Air', cleaning: 'Cleaning', water: 'Water', cooling: 'Cooling' } }),
  'background.blur': entry('Blur', { group: 'look', order: 1 }), 'background.scrim': entry('Dimming', { group: 'look', order: 2 }),
  'chrome-group.placement': advanced('Side', { options: { leading: 'Leading', trailing: 'Trailing' } }),
  'chrome-group.horizontal': advanced('Side by side', { options: { 'separate-circles@1': 'Separate circles', 'shared@1': 'One capsule' } }),
  'chrome-group.vertical': advanced('Stacked', { options: { 'shared@1': 'One capsule', 'separate@1': 'Separate circles' } }),
  'chrome-item.priority': advanced('Priority', { options: { required: 'Required', normal: 'Normal', low: 'Low' } }),
  'chrome-item.quickLinksAction': behaviour('Quick Links', 1), 'chrome-item.profileAction': behaviour('Profile', 2),
  'camera-notification.entityId': entry('Camera', { order: 1 }),
  'camera-notification.liveLabel': entry('Live label', { order: 3 }), 'camera-notification.unavailableLabel': entry('Unavailable label', { order: 4 }),
};

/**
 * Words for the fields that recur across node types, found by their last key. Each is `[label, group]`; a field with no group is
 * in the "what it shows" group. Technical ids and per-state tables sit under Advanced.
 */
const byKey: Record<string, readonly [string, FieldGroup?]> = {
  accessory: ['Accessory', 'look'], actionOrder: ['Action order', 'advanced'], activeStates: ['Active states', 'advanced'], alarmSourceId: ['Alarm', 'advanced'],
  announcement: ['Announce changes', 'look'], aqiSourceId: ['Air quality', 'advanced'], arrangement: ['Arrangement', 'look'], automatic: ['Switch tabs by rule', 'advanced'],
  awaySourceIds: ['Away sources', 'advanced'], bedroomLinks: ['Links', 'behaviour'], blue: ['Blue', 'look'], bodyHint: ['Hint', 'look'], bottom: ['Bottom', 'advanced'],
  cancel: ['Cancel button'], climateActionTone: ['Tint by mode', 'look'], closeLabel: ['Close button label'], colorSourceId: ['Colour source', 'advanced'], compactHours: ['Hours, compact', 'look'],
  confirmLabel: ['Confirm button label'], control: ['Control'], controls: ['Controls'], density: ['Density', 'look'], destination: ['Opens', 'behaviour'], detailEntityId: ['Detail entity', 'advanced'],
  disabledStates: ['Disabled states', 'advanced'], dismissLabel: ['Dismiss button label'], domain: ['Domain', 'advanced'], empty: ['Empty message'], emptyText: ['Empty text'],
  enableLabel: ['Enable button label'], equalRowHeights: ['Equal row heights', 'look'], error: ['Error text'], errorText: ['Error text'], failed: ['Failed text'], fallbackName: ['Name when signed out'],
  fields: ['Fields'], fill: ['Fill', 'look'], fold: ['Fold', 'look'], footer: ['Footer'], footnote: ['Footnote'], format: ['Format'], green: ['Green', 'look'], hasGlyphs: ['Show icons', 'look'],
  header: ['Header'], hiddenText: ['Hidden text'], hidesContactSubtitle: ['Hide contact subtitle', 'look'], highTarget: ['High target', 'advanced'], highlights: ['Highlights', 'look'],
  hint: ['Hint'], homeAwaySourceId: ['Home or away', 'advanced'], info: ['Info text'], initialMinutes: ['Starting minutes', 'advanced'], initialMode: ['Starts with', 'look'],
  invalidTarget: ['Invalid target text'], isOn: ['On when', 'behaviour'], item: ['Item'], items: ['Items'], kind: ['Kind', 'look'], layout: ['Layout', 'look'], leadJoinsAtRegularWidth: ['Lead joins when wide', 'advanced'],
  leading: ['Leading', 'advanced'], loading: ['Loading text'], loadingText: ['Loading text'], lock: ['Lock text'], locked: ['Locked text'], max: ['Maximum'], maxColumns: ['Columns', 'look'],
  message: ['Message'], min: ['Minimum'], minimum: ['Smallest tile', 'look'], modalId: ['Sheet', 'behaviour'], modes: ['Modes', 'look'], name: ['Name'], navigation: ['Navigation', 'behaviour'],
  off: ['Off text'], on: ['On text'], open: ['Open text'], openHint: ['Open hint'], openLabel: ['Open button label'], optimistic: ['Show change at once', 'advanced'], options: ['Options'], order: ['Order', 'advanced'],
  otherTitle: ['Title for others', 'advanced'], ownTitle: ['Title for you', 'advanced'], pageLabel: ['Page label'], panel: ['Panel', 'look'], part: ['Part', 'look'], pendingText: ['Pending text'],
  perPage: ['Per page', 'look'], pinned: ['Pinned', 'look'], placeholder: ['Placeholder'], pluralContacts: ['Plural contacts', 'advanced'], powerOff: ['Power off text'], powerOn: ['Power on text'],
  powerSourceId: ['Power', 'advanced'], presentationProviderId: ['Presented by', 'advanced'], primary: ['Title'], primitive: ['Value'], props: ['Settings', 'advanced'], providerId: ['Provider', 'advanced'],
  pullToRefresh: ['Pull to refresh', 'behaviour'], red: ['Red', 'look'], regularHours: ['Hours, regular', 'look'], resetOnPresentation: ['Reset when shown', 'advanced'], residentId: ['Resident', 'advanced'],
  retainsAutomaticSelection: ['Keep the automatic tab', 'advanced'], reverseLabel: ['Reverse button label'], saveLabel: ['Save button label'], scopeProviderId: ['Scope', 'advanced'], searchPrompt: ['Search prompt'],
  searchProviderId: ['Search provider', 'advanced'], secondary: ['Subtitle'], selected: ['Selected', 'look'], selection: ['When chosen', 'behaviour'], selectionOnly: ['Selection only', 'advanced'],
  sendingCloseText: ['Closing text'], sendingOpenText: ['Opening text'], separator: ['Separator', 'look'], service: ['Service', 'behaviour'], shortRow: ['Short row', 'look'], showState: ['Show state', 'look'],
  showsChevron: ['Show chevron', 'look'], showsIndicator: ['Show page dots', 'look'], showsSelector: ['Show selector', 'look'], sincePrefix: ['Since prefix'], sleep: ['Sleep text'],
  sourceId: ['Entity', 'what'], stale: ['Stale text'], staleText: ['Stale text'], stateColors: ['Colours by state', 'look'], stateId: ['State', 'advanced'], stateLabels: ['Words by state', 'look'],
  states: ['By state', 'look'], step: ['Step'], style: ['Style', 'look'], subtitleSourceIds: ['Subtitle from', 'advanced'], success: ['After saving', 'behaviour'], surface: ['Shown as', 'look'],
  tankFault: ['Tank fault text'], template: ['Layout', 'look'], text: ['Text'], titleLines: ['Title lines', 'look'], titleProviderId: ['Title from', 'advanced'], toolbar: ['Header buttons', 'look'],
  tone: ['Tone', 'look'], top: ['Top', 'advanced'], trailing: ['Trailing', 'advanced'], unavailable: ['Unavailable text'], unavailableText: ['Unavailable text'], unlock: ['Unlock text'],
  value: ['Value'], waterFault: ['Water fault text'],
};
/** The label map: the authored entries over the words found by last key. */
export const labelMap: Readonly<Record<string, FieldLabel>> = {
  ...Object.fromEntries(Object.entries(byKey).map(([key, [label, group]]) => [`*.${key}`, group ? { label, group } : { label }])),
  ...authored,
};

/** A stored choice (`two-column-fill`, `tile@1`, `caption1`) as words: sentence case, no version suffix. Authored `options` win over this. */
export function valueWords(value: string): string {
  const text = value.replace(/@\d+$/, '').replace(/([a-z])\d+$/, '$1').replace(/[-_.]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
  const keys = path.filter(part => typeof part === 'string');
  const dotted = mapPath(path), last = String(keys.at(-1) ?? '');
  // A nested field (`props.fallback.icon.name`) is the same field as a shallower one (`icon.name`): try each shorter suffix of two or more keys, longest first.
  let suffix: FieldLabel | undefined;
  for (let from = 1; from <= keys.length - 2 && !suffix; from += 1) suffix = labelMap[`*.${keys.slice(from).join('.')}`];
  return labelMap[`${owner}.${dotted}`] ?? labelMap[`*.${dotted}`] ?? suffix ?? labelMap[`*.${last}`];
}

/** What a field is called, authored or mechanical. */
export const labelText = (owner: string, path: readonly (string | number)[]) => labelFor(owner, path)?.label ?? mechanicalLabel(String(path.filter(part => typeof part === 'string').at(-1) ?? ''));
