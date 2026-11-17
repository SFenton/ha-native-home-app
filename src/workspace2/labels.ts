/**
 * The authored label map (spec section 7). A field is found by the type of the object that owns it and its path
 * below that object (array indexes dropped), then by the path alone, then by its last key. A mapped field says what
 * it is called, where it sits in the properties and how its values read. An editable field with no entry is shown
 * under Advanced with a mechanical label, so nothing becomes unreachable.
 *
 * Deviation from the spec: this lives in `src/workspace2/` rather than `src/shared/composition/` (the lane owns only the former).
 */

import { builtInStyles } from '../shared/composition/state-styles';

/** The four groups of the properties body, in order. */
export type FieldGroup = 'what' | 'look' | 'states' | 'behaviour' | 'advanced';
export const groupOrder: readonly FieldGroup[] = ['what', 'look', 'states', 'behaviour', 'advanced'];
export const groupTitles: Record<FieldGroup, string> = { what: '', look: '', states: 'States', behaviour: 'Behavior', advanced: 'Advanced' };

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
  '*.props.family': entry('Color', { group: 'look', order: 2, options: { neutral: 'Neutral', lights: 'Lights', occupancy: 'Occupancy' } }),
  '*.action': behaviour('When tapped', 1), '*.onAction': behaviour('When turned on', 1), '*.offAction': behaviour('When turned off', 2), '*.visibleWhen': behaviour('Only show when', 2), '*.enabledWhen': behaviour('Only enabled when', 2.5),
  '*.badge': entry('Badge', { group: 'look', order: 8 }),
  'local-tabs.props.automatic': entry('Opens on', { group: 'what', order: 30 }), 'local-tabs.props.fallbackTabId': entry('If that tab is hidden', { group: 'what', order: 31 }),
  'state-tile.action': behaviour('Opens', 3, { caption: 'Where a tap on the tile goes. The style still decides what the tile itself does.' }), 'state-tile.props.subtitle': entry('Subtitle', { order: 2 }), 'state-tile.props.progress': entry('Progress', { hidden: true }),
  'light-group-tile.props.words': entry('State Words', { hidden: true }), 'light-group-tile.props.words.count': entry('Count Word', { hidden: true }), 'light-group-tile.props.words.level': entry('Level Word', { hidden: true }), 'room-overview-tile.props.words': entry('State Words', { hidden: true }), 'room-overview-tile.props.words.count': entry('Count Word', { hidden: true }), 'room-overview-tile.props.words.level': entry('Level Word', { hidden: true }),
  'state-tile.props.swipe': entry('Swipe to Adjust', { hidden: true }), 'state-tile.props.swipe.detent': entry('Snap Points', { hidden: true }), 'state-tile.props.swipe.haptic': entry('Haptic', { hidden: true }), 'state-tile.props.swipe.band': entry('Band', { hidden: true }), 'light-group-tile.props.swipe.detent': entry('Snap Points', { hidden: true }), 'light-group-tile.props.swipe.haptic': entry('Haptic', { hidden: true }), 'light-group-tile.props.swipe.band': entry('Band', { hidden: true }), 'light-group-tile.props.swipe': entry('Swipe to Adjust', { hidden: true }),
  'tile-swipe.value': advanced('Value', { caption: 'The number the tile shows now.' }), 'tile-swipe.action': advanced('When you let go', { caption: 'The call a release sends; the value is the number the finger chose.' }),
  'state-tile.props.discs': entry('Buttons', { hidden: true, add: 'Add Button' }), 'choice-option.selectedWhen': behaviour('Selected when', 1), 'choice-option.action': behaviour('When chosen', 2), 'bound-control.props.options': entry('Choices', { hidden: true, add: 'Add Choice' }), 'tile-disc.label': entry('Label', { order: 1 }), 'tile-disc.icon': entry('Icon', { order: 2 }), 'tile-disc.action': behaviour('When tapped', 1), 'tile-disc.visibleWhen': behaviour('Only show when', 2), 'tile-disc.enabledWhen': behaviour('Only enabled when', 3), 'tile-disc.whenUnknown': behaviour('If it can’t tell', 4),
  // The TC3 parts: a tile button names the tile too, a grid keeps its columns, and a toggle row has a subtitle, a glyph tint, a size, a failure caption and a check face.
  'tile-disc.namesTile': entry('Say the tile’s title too', { order: 3, caption: 'VoiceOver reads the label and then the tile’s title: “Start Main Floor”.' }),
  'tile-grid.props.groups': entry('Group by State', { hidden: true }), 'tile-grid.props.groups.by': entry('Group by', { hidden: true }), 'tile-grid.props.groups.items': entry('Groups', { hidden: true, add: 'Add Group' }), 'tile-grid.props.groups.items.id': entry('ID', { hidden: true }), 'tile-grid.props.groups.items.title': entry('Title', { hidden: true }), 'tile-grid.props.groups.items.states': entry('States', { hidden: true }),
  'tile-grid.props.minimumColumns': entry('Least columns', { group: 'look', caption: 'The grid keeps at least this many columns, and a tile with buttons shares them instead of taking a row to itself.' }),
  'bound-control.props.optionsFrom': entry('Choices from an entity', { hidden: true }), 'bound-control.props.optionsFrom.current': entry('Chosen when', { hidden: true }), 'bound-control.props.optionsFrom.labels': entry('Choice words', { hidden: true }),
  'bound-control.props.hint': entry('Hint', { order: 6, caption: 'VoiceOver reads this after the title. While the row is off limits it reads the unavailable text instead.' }),
  'bound-control.props.metrics': entry('Row size', { group: 'look', order: 4, options: { form: 'Form', module: 'Module' }, caption: 'Module: 52 points tall, 60 with a subtitle. Form: 44 points.' }),
  'bound-control.props.failureText': behaviour('If it fails', 5, { caption: 'Shown under the row when the call does not go through.' }),
  'bound-control.props.face': entry('Toggle looks like', { group: 'look', order: 3, options: { switch: 'Switch', check: 'Check Mark' } }),
  'bound-control.props.checkTint': entry('Check color', { group: 'look', order: 5, options: { action: 'Action', success: 'Success' } }),
  'local-tabs.props.tabBar.placement': entry('Placement', { hidden: true }), 'local-tabs.props.tabBar.labels': entry('Labels', { hidden: true }), 'local-tabs.blocks': entry('Areas', { hidden: true }),
  'overlay.props.anchors': entry('Position', { hidden: true }),
  // The Repeat (`sh.repeat@1`): the records flow it draws, its direction and spacing, how many it draws, paging, the placeholder and the five words of its states.
  'repeat.props.providerId': entry('Repeat over', { group: 'what', order: 1 }),
  'repeat.props.axis': entry('Direction', { group: 'what', order: 2, options: { horizontal: 'Row', vertical: 'Column' } }),
  'repeat.props.spacing': entry('Spacing', { group: 'look', order: 3 }),
  'repeat.props.limit': entry('Most to draw', { group: 'what', order: 4, caption: 'Without one it draws every record the flow gives.' }),
  'repeat.props.paging': entry('Paging', { group: 'look', order: 5, caption: 'A row can page: a page holds this many in a compact window and this many in a regular one.' }),
  'repeat.props.paging.compact': entry('Per page, compact'), 'repeat.props.paging.regular': entry('Per page, regular'),
  'repeat.props.paging.scaleByTextSize': entry('Scale with text size', { caption: 'Four factors, from the default text size to the largest. A factor never grows.' }),
  'repeat.props.paging.minimum': entry('Fewest per page'), 'repeat.props.paging.indicator': entry('Page indicator'),
  'repeat.props.paging.buttons': entry('Buttons', { options: { never: 'Never', 'regular-width': 'At regular width' } }), 'repeat.props.paging.label': entry('Name for VoiceOver'),
  'repeat.props.placeholder': entry('Placeholder', { group: 'states', order: 1, caption: 'The second cell is drawn this many times while the flow has not answered.' }), 'repeat.props.placeholder.count': entry('Count'),
  'repeat.props.loadingText': entry('Loading text', { group: 'states', order: 2 }), 'repeat.props.emptyText': entry('Empty text', { group: 'states', order: 3 }),
  'repeat.props.staleText': entry('Out-of-date text', { group: 'states', order: 5 }), 'repeat.props.errorText': entry('Error text', { group: 'states', order: 6 }),
  'repeat.props.unavailableText': entry('Unavailable text', { group: 'states', order: 7 }),
  // The style parts (`sh.text-style@1`, `sh.stack@1`, `sh.symbol-part@1`, `sh.choice-icons@1`): a text's font, color, lines and overflow; a stack and a shape; a symbol; an option's icon and hint.
  'text.props.font': entry('Font', { group: 'look', order: 3 }), 'text.props.font.weight': entry('Weight', { options: { 'ultra-light': 'Ultra light', thin: 'Thin', light: 'Light', regular: 'Regular', medium: 'Medium', semibold: 'Semibold', bold: 'Bold', heavy: 'Heavy', black: 'Black' } }),
  'text.props.font.digits': entry('Digits', { options: { proportional: 'Proportional', monospaced: 'Same width' }, caption: 'Same width keeps a changing number from shifting what is beside it.' }),
  'text.props.font.scale': entry('Size that scales', { caption: 'A fixed size in points that grows with the text size, up to the largest size, like a large title.' }), 'text.props.font.scale.points': entry('Points'),
  'text.props.font.scale.relativeTo': entry('Scales like'), 'text.props.font.scale.maxPoints': entry('Largest size'),
  'text.props.ink': entry('Color', { group: 'look', order: 4, caption: 'Without one the words keep the style’s own color.' }),
  'text.props.lines': entry('Most lines', { group: 'look', order: 5, caption: '0 is as many as the text needs.' }),
  'text.props.align': entry('Alignment', { group: 'look', order: 6, options: { start: 'Start', center: 'Center', end: 'End' } }),
  'text.props.overflow': entry('When it does not fit', { group: 'look', order: 7, options: { wrap: 'Wrap', truncate: 'Cut with …', ticker: 'Slide' }, caption: 'Slide needs the most lines set to 1.' }),
  'stack.props.axis': entry('Direction', { group: 'what', order: 1, options: { horizontal: 'Row', vertical: 'Column' } }),
  'stack.props.spacing': entry('Spacing', { group: 'look', order: 2 }), 'stack.props.padding': entry('Padding', { group: 'look', order: 3 }),
  'stack.props.align': entry('Align across', { group: 'look', order: 4, options: { start: 'Start', center: 'Center', end: 'End' } }),
  'stack.props.distribution': entry('Distribution', { group: 'look', order: 5, options: { natural: 'Together', spread: 'Spread apart' } }),
  'stack.props.surface': entry('Surface', { group: 'look', order: 6 }), 'stack.props.surface.density': entry('Density', { options: { thin: 'Thin', dense: 'Dense' } }),
  'stack.props.surface.fill': entry('Fill'), 'stack.props.surface.border': entry('Border'), 'stack.props.surface.border.ink': entry('Border color'), 'stack.props.surface.radius': entry('Corner radius'),
  'stack.props.dividers': entry('Lines between', { group: 'look', order: 7 }), 'stack.props.dividers.ink': entry('Line color'), 'stack.props.dividers.width': entry('Line width'),
  'stack.props.groups': entry('Groups', { group: 'advanced', add: 'Add Group', caption: 'Which children sit together. Every child is in exactly one group.' }),
  'stack.props.collapse': entry('Collapse to a column', { group: 'behaviour', order: 5 }), 'stack.props.collapse.when': entry('When'), 'stack.props.collapse.fits': entry('Must fit'),
  'stack.props.collapse.spacing': entry('Spacing then'), 'stack.props.collapse.groups': entry('Groups then', { add: 'Add Group' }),
  'stack.action': behaviour('When tapped', 1, { caption: 'The whole stack becomes one button.' }),
  'stack.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'stack.a11y.element': entry('Read as', { options: { group: 'One item', children: 'Each item', hidden: 'Nothing' } }),
  'stack.a11y.role': entry('Role', { options: { button: 'Button', header: 'Heading', text: 'Text' } }), 'stack.a11y.label': entry('Spoken name'), 'stack.a11y.value': entry('Spoken value'), 'stack.a11y.hint': entry('Hint'),
  'shape.props.form': entry('Shape', { group: 'what', order: 1, options: { capsule: 'Capsule', rect: 'Rectangle', circle: 'Circle' } }), 'shape.props.width': entry('Width', { group: 'look', order: 2 }),
  'shape.props.height': entry('Height', { group: 'look', order: 3 }), 'shape.props.fill': entry('Color', { group: 'look', order: 4 }),
  'symbol.props.name': entry('Symbol', { group: 'what', order: 1, caption: 'One symbol, or one that follows an entity’s state.' }), 'symbol.props.size': entry('Size', { group: 'look', order: 2 }),
  'symbol.props.size.points': entry('Points'), 'symbol.props.size.relativeTo': entry('Scales like'), 'symbol.props.size.maxScale': entry('Most it grows', { caption: 'A multiple of the size: 2 at most doubles it.' }),
  'symbol.props.rendering': entry('Colors', { group: 'look', order: 3, options: { multicolor: 'Multicolor', monochrome: 'One color' }, caption: 'Multicolor draws the symbol’s own colors; the preview shows a stand-in glyph.' }),
  'symbol.props.tint': entry('Color', { group: 'look', order: 4 }), 'symbol.props.trim': entry('Trim leading space', { group: 'look', order: 5, options: { none: 'No', leading: 'Yes' }, caption: 'Lines the symbol’s ink up with the text beneath it.' }),
  'symbol.props.rotate': entry('Turn', { group: 'look', order: 6, caption: 'A number of degrees, clockwise.' }),
  'symbol.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'symbol.a11y.element': entry('Read as', { options: { hidden: 'Nothing', image: 'An image' } }), 'symbol.a11y.label': entry('Spoken name'),
  // The data parts (`sh.chart@1`, `sh.linear-gauge@1`): a chart's mark, points, scale, axis and look; a rail's value, span, gradient and marker.
  'chart.props.mark': entry('Chart type', { group: 'what', order: 1, options: { bar: 'Bars', line: 'Line', area: 'Area' } }),
  'chart.props.series': entry('Data', { group: 'what', order: 2, caption: 'The points drawn. A series read from a Data Flow needs a records output, which is not available yet.' }),
  'chart.props.series.type': entry('Source', { options: { literal: 'Points written here', source: 'A Data Flow' } }), 'chart.props.series.points': entry('Points', { add: 'Add Point' }),
  'chart.props.series.points.label': entry('Label'), 'chart.props.series.points.value': entry('Value'), 'chart.props.series.providerId': entry('Data Flow'),
  'chart.props.series.limit': entry('Most points'), 'chart.props.series.x': entry('Label of each point'), 'chart.props.series.x.label': entry('Label'), 'chart.props.series.y': entry('Value of each point'),
  'chart.props.domain': entry('Value scale', { group: 'look', order: 2, caption: 'Round up: the axis ends at the highest value rounded up to the next step, between the minimum and the maximum. Fixed range: from the minimum to the maximum. Two steps: two equal, round steps.' }),
  'chart.props.domain.type': entry('Scale', { options: { ceiling: 'Round up', fixed: 'Fixed range', 'two-step': 'Two steps' } }),
  'chart.props.domain.step': entry('Step'), 'chart.props.domain.min': entry('Minimum'), 'chart.props.domain.max': entry('Maximum'),
  'chart.props.domain.minimumStep': entry('Smallest step', { caption: 'A number: the axis never steps by less.' }), 'chart.props.domain.maximumFractionDigits': entry('Most decimal places'), 'chart.props.domain.factors': entry('Step factors', { caption: 'Each step is one of these times a power of ten, rising from 1 to 10.' }),
  'chart.props.tint': entry('Color', { group: 'look', order: 3 }), 'chart.props.height': entry('Height', { group: 'look', order: 4, caption: 'Points, the plot only.' }),
  'chart.props.labels': entry('Labels under the plot', { group: 'look', order: 5, options: { fit: 'Fit the width', all: 'All', none: 'None' } }),
  'chart.props.axis': entry('Axis', { group: 'look', order: 6 }), 'chart.props.axis.levels': entry('Levels'), 'chart.props.axis.label': entry('Value labels'),
  'chart.props.axis.label.pattern': entry('Pattern', { caption: '{value} stands for the number: {value}% reads 50%.' }), 'chart.props.axis.label.digits': entry('Decimal places'),
  'chart.props.axis.gridInk': entry('Line color'), 'chart.props.axis.labelInk': entry('Label color'),
  'chart.props.bar': entry('Bars', { group: 'look', order: 7 }), 'chart.props.bar.gap': entry('Gap'), 'chart.props.bar.radius': entry('Corner radius'), 'chart.props.bar.minimum': entry('Least height'), 'chart.props.bar.unknownInk': entry('Unknown value color'),
  'chart.props.line': entry('Line', { group: 'look', order: 7 }), 'chart.props.line.width': entry('Width'), 'chart.props.line.dots': entry('Dots'),
  'chart.props.emptyText': entry('With no data', { group: 'what', order: 3 }),
  'chart.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'chart.a11y.label': entry('Spoken name'), 'chart.a11y.value': entry('Spoken value', { options: { series: 'The series' } }),
  'linear-gauge.props.value': entry('Value', { group: 'what', order: 1, caption: 'A number on the scale below; with none, the marker is hidden.' }),
  'linear-gauge.props.scale': entry('Scale', { group: 'what', order: 2, options: { unit: '0 to 1', percent: '0 to 100' } }),
  'linear-gauge.props.fill': entry('Gradient covers', { group: 'look', order: 1, options: { scale: 'The whole track', span: 'The span only' } }),
  'linear-gauge.props.span': entry('Span', { group: 'what', order: 3, caption: 'The part of the track the gradient colors, for a gradient that covers the span only.' }),
  'linear-gauge.props.span.start': entry('Starts at'), 'linear-gauge.props.span.size': entry('Length'),
  'linear-gauge.props.stops': entry('Gradient', { group: 'look', order: 2, add: 'Add Stop', caption: 'Two to eight colors, from the start of what they cover to its end.' }),
  'linear-gauge.props.stops.at': entry('Position', { caption: '0 is the start, 1 the end.' }), 'linear-gauge.props.stops.ink': entry('Color'),
  'linear-gauge.props.track': entry('Track color', { group: 'look', order: 3 }), 'linear-gauge.props.height': entry('Height', { group: 'look', order: 4 }),
  'linear-gauge.props.marker': entry('Marker', { group: 'look', order: 5 }), 'linear-gauge.props.marker.size': entry('Size'), 'linear-gauge.props.marker.ink': entry('Color'),
  'linear-gauge.props.marker.border': entry('Border'), 'linear-gauge.props.marker.border.ink': entry('Border color'), 'linear-gauge.props.marker.border.width': entry('Border width'),
  'linear-gauge.props.animates': entry('Glide when it changes', { group: 'behaviour', order: 5, caption: 'Reduce Motion always turns it off.' }),
  'linear-gauge.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'linear-gauge.a11y.element': entry('Read as', { options: { hidden: 'Nothing', value: 'A value' } }),
  'linear-gauge.a11y.label': entry('Spoken name'), 'linear-gauge.a11y.value': entry('Spoken value', { caption: 'Without one, the percent is spoken.' }),
  '*.options.symbol': entry('Icon', { order: 3 }), '*.options.hint': entry('Hint', { order: 4, caption: 'VoiceOver says it after the label.' }),
  'state-tile.glyphTint': entry('Icon color', { group: 'look', order: 3, caption: 'The icon’s color on a face that is not filled, not an error and not unavailable. Without one, and while unavailable, the icon stays grey.' }),
  'state-tile.discGlyphTint': entry('Button icon color', { group: 'look', order: 4, caption: 'The icons of the buttons on a dark face. Without one they stay white; a filled face keeps white.' }),
  'state-tile.cellFit': entry('In a taller cell', { group: 'look', order: 5, options: { fill: 'Fill the cell', natural: 'Keep its height' }, caption: 'In a grid with equal row heights: stretch to the row, or keep the tile’s own height at the top.' }),
  'state-tile.activeWhen': entry('Active when', { group: 'what', order: 20 }), 'state-tile.filledWhen': entry('Filled when', { group: 'what', order: 21 }), 'state-tile.errorWhen': entry('Error when', { group: 'what', order: 22 }),
  '*.whenUnknown': entry('If it can’t tell', { group: 'behaviour', order: 3, options: unknownPolicy, hidden: true }),
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
  'tile-grid.props.fold': entry('Fold', { group: 'look', caption: 'Page: avoids the Duo’s hinge. Container: ignores it.' }),
  'activity.jobId': entry('Job ID', { order: 1, caption: 'Matches the job’s tag without “job.”.' }),
  'activity.glyph': entry('Glyph', { group: 'look', order: 1, options: { fan: 'Fan', dishwasher: 'Dishwasher', dryer: 'Dryer', washer: 'Washer', vacuum: 'Vacuum', hot_flash: 'Hot flash', generic: 'Generic' } }),
  'activity.tint': entry('Tint', { group: 'look', order: 2, options: { engine: 'Engine', neutral: 'Neutral', air: 'Air', cleaning: 'Cleaning', water: 'Water', cooling: 'Cooling' } }),
  'background.blur': entry('Blur', { group: 'look', order: 1 }), 'background.scrim': entry('Dimming', { group: 'look', order: 2 }),
  'chrome-group.placement': advanced('Side', { options: { leading: 'Leading', trailing: 'Trailing' } }),
  'chrome-group.horizontal': advanced('Side by side', { options: { 'separate-circles@1': 'Separate circles', 'shared@1': 'One capsule' } }),
  'chrome-group.vertical': advanced('Stacked', { options: { 'shared@1': 'One capsule', 'separate@1': 'Separate circles' } }),
  'chrome-item.priority': advanced('Priority', { options: { required: 'Required', normal: 'Normal', low: 'Low' } }),
  'chrome-item.quickLinksAction': behaviour('Quick Links', 1), 'chrome-item.profileAction': behaviour('Profile', 2),
  // A state tile (`sh.state-style@1`): its style and its per-state overrides are the States group, not generated rows.
  'state-tile.binding.styleId': entry('Saved style', { hidden: true }), 'state-tile.binding.builtIn': entry('Built-in style', { hidden: true }),
  'state-tile.binding.overrides': entry('Overrides', { hidden: true }),
  // The List (studio-ux2, L-data): one inspector for `row-collection` and the app's own `collection`.
  'row-collection.props.providerId': entry('Rows from', { group: 'what', order: 1 }), 'collection.props.providerId': entry('Rows from', { group: 'what', order: 1 }),
  'row-collection.props.rowAction': behaviour('Row tapped', 0.5), 'row-collection.props.refreshable': behaviour('Pull to refresh', 1.5),
  'row-collection.props.loadingText': entry('Loading text', { group: 'states', order: 2 }), 'row-collection.props.emptyText': entry('Empty text', { group: 'states', order: 3 }),
  'row-collection.props.emptyMessage': entry('Empty message', { group: 'states', order: 4 }), 'row-collection.props.staleText': entry('Out-of-date text', { group: 'states', order: 5 }),
  'row-collection.props.errorText': entry('Error text', { group: 'states', order: 6 }), 'row-collection.props.unavailableText': entry('Unavailable text', { group: 'states', order: 7 }),
  'collection.props.loadingText': entry('Loading text', { group: 'states', order: 2 }), 'collection.props.emptyText': entry('Empty text', { group: 'states', order: 3 }),
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
  cancel: ['Cancel button'], climateActionTone: ['Tint by mode', 'look'], closeLabel: ['Close button label'], colorSourceId: ['Color source', 'advanced'], compactHours: ['Hours, compact', 'look'],
  confirmLabel: ['Confirm button label'], control: ['Control'], controls: ['Controls'], density: ['Density', 'look'], destination: ['Opens', 'behaviour'], detailEntityId: ['Detail entity', 'advanced'],
  disabledStates: ['Disabled states', 'advanced'], dismissLabel: ['Dismiss button label'], domain: ['Domain', 'advanced'], empty: ['Empty message'], emptyText: ['Empty text'],
  enableLabel: ['Enable button label'], equalRowHeights: ['Equal row heights', 'look'], error: ['Error text'], errorText: ['Error text'], failed: ['Failed text'], fallbackName: ['Name when signed out'],
  fields: ['Fields'], fill: ['Fill', 'look'], glyph: ['Icon color', 'look'], fold: ['Fold', 'look'], footer: ['Footer'], footnote: ['Footnote'], format: ['Format'], green: ['Green', 'look'], hasGlyphs: ['Show icons', 'look'],
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
  sourceId: ['Entity', 'what'], stale: ['Stale text'], staleText: ['Stale text'], stateColors: ['Colors by state', 'look'], stateId: ['State', 'advanced'], stateLabels: ['Words by state', 'look'],
  states: ['By state', 'look'], step: ['Step'], style: ['Style', 'look'], subtitleSourceIds: ['Subtitle from', 'advanced'], success: ['After saving', 'behaviour'], surface: ['Shown as', 'look'],
  tankFault: ['Tank fault text'], template: ['Layout', 'look'], text: ['Text'], titleLines: ['Title lines', 'look'], titleProviderId: ['Title from', 'advanced'], toolbar: ['Header buttons', 'look'],
  tone: ['Tone', 'look'], top: ['Top', 'advanced'], trailing: ['Trailing', 'advanced'], unavailable: ['Unavailable text'], unavailableText: ['Unavailable text'], unlock: ['Unlock text'],
  value: ['Value'], waterFault: ['Water fault text'],
};
/** The gauge parts (`sh.dial@1`, `sh.arc-track@1`): a dial's sweep, ticks, letters, pointer and centre text; an arc's curve, line, horizon and marker. */
const gaugePartLabels: Record<string, FieldLabel> = {
  'dial.props.sweep': entry('Sweep', { group: 'what', order: 1, caption: 'Degrees, clockwise from 3 o’clock: 145 is lower left, 270 is the top. Length is how far round it goes, up to a full turn of 360.' }),
  'dial.props.sweep.start': entry('Starts at'), 'dial.props.sweep.length': entry('Length'),
  'dial.props.scale': entry('Value scale', { group: 'what', order: 2, options: { unit: '0 to 1', percent: '0 to 100', degrees: 'Degrees (full turn)' }, caption: 'How the indicator’s number is read. Degrees needs a sweep of 360; on a full turn a number past the end wraps round.' }),
  'dial.props.pointer': entry('Indicator', { group: 'what', order: 3, caption: 'A lit tick, or the needle. With no number, the indicator is hidden.' }),
  'dial.props.pointer.kind': entry('Kind', { options: { tick: 'Lit tick', needle: 'Needle' } }), 'dial.props.pointer.value': entry('Value'),
  'dial.props.pointer.inner': entry('Inner end', { caption: 'A share of the radius, 0 to 1.' }), 'dial.props.pointer.outer': entry('Outer end', { caption: 'A share of the radius, 0 to 1.' }),
  'dial.props.pointer.width': entry('Width'), 'dial.props.pointer.ink': entry('Color'), 'dial.props.pointer.tailInk': entry('Tail color'), 'dial.props.pointer.dotInk': entry('Dot color'),
  'dial.props.pointer.animates': entry('Turn when it changes', { caption: 'Turns the short way round. Reduce Motion always turns it off.' }),
  'dial.props.ticks': entry('Ticks', { group: 'look', order: 1 }), 'dial.props.ticks.count': entry('How many'), 'dial.props.ticks.inner': entry('Inner end', { caption: 'A share of the radius, 0 to 1.' }),
  'dial.props.ticks.outer': entry('Outer end', { caption: 'A share of the radius, 0 to 1.' }), 'dial.props.ticks.width': entry('Width'), 'dial.props.ticks.ink': entry('Color'),
  'dial.props.ticks.alternate': entry('Every second tick'), 'dial.props.ticks.alternate.inner': entry('Inner end'), 'dial.props.ticks.skip': entry('Skipped ticks', { add: 'Add Tick' }),
  'dial.props.labels': entry('Letters', { group: 'look', order: 2 }), 'dial.props.labels.ink': entry('Color'), 'dial.props.labels.items': entry('Letters', { add: 'Add Letter' }),
  'dial.props.labels.items.at': entry('Place', { caption: '0 is the start of the sweep, 1 the end.' }), 'dial.props.labels.items.text': entry('Letter'), 'dial.props.labels.items.needsValue': entry('Only with a value'),
  'dial.props.flag': entry('Flag', { group: 'look', order: 3, caption: 'A small triangle on the rim.' }), 'dial.props.flag.at': entry('Place'), 'dial.props.flag.ink': entry('Color'),
  'dial.props.center': entry('Text in the middle', { group: 'what', order: 4, add: 'Add Line', caption: 'Up to three lines, centered on the dial.' }),
  'dial.props.size': entry('Size', { group: 'look', order: 4, caption: 'Points, scaled with the text size. Without one the dial fills the room it has.' }),
  'dial.props.size.points': entry('Points'), 'dial.props.size.relativeTo': entry('Scales like'), 'dial.props.size.maxPoints': entry('Most it grows to'),
  'dial.props.maxWidth': entry('Widest', { group: 'look', order: 5 }), 'dial.props.aspect': entry('Width over height', { group: 'look', order: 6 }),
  'dial.props.centerY': entry('Centre down the height', { group: 'look', order: 7, caption: '0 is the top, 1 the bottom.' }),
  'dial.props.mirrors': entry('Flip in right-to-left', { group: 'behaviour', order: 5 }),
  'dial.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'dial.a11y.element': entry('Read as', { options: { hidden: 'Nothing', value: 'A value' } }),
  'dial.a11y.label': entry('Spoken name'), 'dial.a11y.value': entry('Spoken value', { caption: 'Without one, the percent is spoken.' }),
  'arc-track.props.curve': entry('Curve', { group: 'what', order: 1, caption: 'A curve from one end to the other, bent toward the middle point. Points are in the box’s own units.' }),
  'arc-track.props.curve.from': entry('Start'), 'arc-track.props.curve.control': entry('Bend toward'), 'arc-track.props.curve.to': entry('End'),
  'arc-track.props.box': entry('Box', { group: 'what', order: 2, caption: 'Width and height in the same units: their ratio is the arc’s shape.' }),
  'arc-track.props.progress': entry('Progress', { group: 'what', order: 3, caption: 'How far along the curve, on the scale below. With none, the marker is hidden.' }),
  'arc-track.props.scale': entry('Progress scale', { group: 'what', order: 4, options: { unit: '0 to 1', percent: '0 to 100' } }),
  'arc-track.props.ink': entry('Line color', { group: 'look', order: 1 }), 'arc-track.props.width': entry('Line width', { group: 'look', order: 2 }),
  'arc-track.props.dash': entry('Dashes', { group: 'look', order: 3, caption: 'The dash and the gap, in points. Without them the line is solid.' }),
  'arc-track.props.horizon': entry('Horizon', { group: 'look', order: 4 }), 'arc-track.props.horizon.from': entry('Start'), 'arc-track.props.horizon.to': entry('End'),
  'arc-track.props.horizon.ink': entry('Color'), 'arc-track.props.horizon.width': entry('Width'),
  'arc-track.props.marker': entry('Marker', { group: 'look', order: 5 }), 'arc-track.props.marker.size': entry('Size'), 'arc-track.props.marker.ink': entry('Color'),
  'arc-track.props.maxWidth': entry('Widest', { group: 'look', order: 6 }),
  'arc-track.props.mirrors': entry('Flip in right-to-left', { group: 'behaviour', order: 5, caption: 'So progress still runs from the reading start.' }),
  'arc-track.a11y': entry('Accessibility', { group: 'behaviour', order: 6 }), 'arc-track.a11y.element': entry('Read as', { options: { hidden: 'Nothing', value: 'A value' } }),
  'arc-track.a11y.label': entry('Spoken name'), 'arc-track.a11y.value': entry('Spoken value', { caption: 'Without one, the percent is spoken.' }),
};

/** The label map: the authored entries over the words found by last key. */
export const labelMap: Readonly<Record<string, FieldLabel>> = {
  ...Object.fromEntries(Object.entries(byKey).map(([key, [label, group]]) => [`*.${key}`, group ? { label, group } : { label }])),
  ...authored,
  ...gaugePartLabels,
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

/**
 * What the contract fixes on a node, in words, by field name. The Advanced fold ends with one line, "Set by the app: ...", built
 * from the node's single-value fields through this map; a field without an entry reads as its mechanical label in lower case.
 */
export const fixedWords: Readonly<Record<string, string>> = {
  action: 'tap action', bodyActionId: 'tap action', rendering: 'how it is drawn', unavailable: 'the unavailable look', projection: 'what data it reads', transition: 'the page transition', actionOrder: 'action order', stateText: 'state text', feedback: 'feedback', intent: 'what a tap does', model: 'data model', kind: 'kind',
  style: 'style', presentation: 'presentation', origin: 'where a page opens from', duplicate: 'what happens to a page already open', arguments: 'page arguments',
  cancelLabel: 'the Cancel button', schemaVersion: 'schema version', tokens: 'design tokens', typography: 'type scale', control: 'control kind', family: 'color family',
};
/** Fields that name the node's kind or identity, never listed as fixed. */
export const fixedSkipped: ReadonlySet<string> = new Set(['type', 'id', 'schemaVersion']);
/** The one line under an open Advanced fold, or undefined when the node has nothing fixed. */
export function fixedLine(keys: readonly string[], extra?: string): string | undefined {
  const words = [...new Set(keys.filter(key => !fixedSkipped.has(key)).map(key => fixedWords[key] ?? mechanicalLabel(key).toLowerCase()))];
  if (extra) return `Set by the app: ${[...words, extra].join(', ')}.`;
  return words.length ? `Set by the app: ${words.join(', ')}.` : undefined;
}
