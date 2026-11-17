/**
 * Every string the condition and value fields say (spec "Copy"). US spelling; Title Case for titles, buttons, menu commands, tags and
 * choices; sentence case for row labels, notes and messages. `…` is one character.
 */

/** The places a condition field is wired into, which pick the result words. */
export type Place = 'show' | 'enable' | 'active' | 'filled' | 'error' | 'ask' | 'rule' | 'filter' | 'opens';

/** What a place calls a true and a not-true condition (spec "Result words by place"). */
export const resultWords: Record<Place, { yes: string; no: string }> = {
  show: { yes: 'Shown now', no: 'Hidden now' },
  enable: { yes: 'Enabled now', no: 'Disabled now' },
  active: { yes: 'Active now', no: 'Not active now' },
  filled: { yes: 'Filled now', no: 'Not filled now' },
  error: { yes: 'Error now', no: 'No error now' },
  ask: { yes: 'Asking now', no: 'Not asking now' },
  rule: { yes: 'True now', no: 'Not true now' },
  filter: { yes: 'True now', no: 'Not true now' },
  opens: { yes: 'True now', no: 'Not true now' },
};
/** What the place does while the condition cannot be told, by its policy. */
export const policyEffect: Record<Place, { show: string; hide: string; keep: string }> = {
  show: { show: 'shown', hide: 'hidden', keep: 'kept as it was' },
  enable: { show: 'enabled', hide: 'disabled', keep: 'kept as it was' },
  active: { show: 'not active', hide: 'not active', keep: 'not active' },
  filled: { show: 'not filled', hide: 'not filled', keep: 'not filled' },
  error: { show: 'not an error', hide: 'not an error', keep: 'not an error' },
  ask: { show: 'not asking', hide: 'not asking', keep: 'not asking' },
  rule: { show: 'not true', hide: 'not true', keep: 'not true' },
  filter: { show: 'not true', hide: 'not true', keep: 'not true' },
  opens: { show: 'not true', hide: 'not true', keep: 'not true' },
};
/** The "If it can't tell" choices for a place that shows and hides, and for one that enables and disables. */
export const policyChoices = {
  show: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }, { value: 'keep', label: 'Keep Last' }],
  enable: [{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }, { value: 'keep', label: 'Keep Last' }],
} as const;

export const words = {
  sortBy: 'Sort by', ascending: 'Ascending', descending: 'Descending', addSortField: 'Add Sort Field', removeSortField: 'Remove Sort Field', fourSortFields: 'A list sorts by 4 fields at most.',
  oneAction: 'One Action', byRule: 'By Rule',
  ifUnavailable: 'If unavailable', ifUnavailableNote: "Used while the value can't be read. Empty keeps the node's own unavailable text.",
  from: 'From', homeAssistantSays: 'Home Assistant says', readAs: 'Read as', inTheApp: 'In the app', notAColor: 'Not a color',
  noColor: "If there's no color", noIcon: "If there's no icon",
  noColorNote: "Used when the entity is unavailable or its value isn't a color.", noIconNote: "Used when the entity is unavailable or its value isn't a symbol the app has.",
  badgeZero: 'A value of 0 draws no badge.',
  opensOn: 'Opens on', firstTab: 'First tab', ifTabHidden: 'If that tab is hidden', firstTabShown: 'First Tab Shown',
  firstRuleTrue: "The first rule that's true opens its tab.", ruleNeedsCondition: 'Every rule needs a condition.',
  dateShow: 'Date', dateStyle: 'Style', dateNote: "In the phone's language and region.",
  dateStyles: { 'short-date': 'Short Date', 'long-date': 'Long Date', 'weekday-date': 'Weekday and Date', time: 'Time', 'date-time': 'Date and Time', relative: 'Relative', hour: 'Hour', weekday: 'Weekday' } as Record<string, string>,
  simple: 'Simple', logic: 'Logic', fixed: 'Fixed', fromEntity: 'From Entity', rules: 'Rules',
  always: 'Always', never: 'Never', fromStyle: 'From the style',
  when: 'When', read: 'Read', state: 'State', rawState: 'Raw State', rawStateNote: 'Says Unknown or Unavailable when Home Assistant does, instead of not being able to tell.',
  itemCount: 'Number of Items', includes: 'Includes…', item: 'Item',
  keepZeros: 'Keep trailing zeros', keepZerosNote: 'Shows exactly this many decimals: 72 reads 72.0.', capitalize: 'Capital letters',
  textCaseChoices: { 'as-written': 'As written', words: 'Capitalize each word', title: 'Capitalize after underscores' } as Record<string, string>,
  textCaseNotes: { words: 'A space or an underscore ends a word: wheel stuck reads Wheel Stuck.', title: 'Only an underscore ends a word: heat_cool reads Heat Cool, and heat cool reads Heat cool.' } as Record<string, string>,
  readAttribute: 'Read an Attribute…', other: 'Other…', otherAttribute: 'Other Attribute…',
  ifUnknown: "If it can't tell", all: 'All', any: 'Any', none: 'None', ofTheseAreTrue: 'of these are true',
  condition: 'Condition', group: 'Group', addCondition: '+ Condition', addGroup: '+ Group',
  compareWithValue: 'Compare With a Value…', edit: 'Edit', duplicate: 'Duplicate', moveUp: 'Move Up', moveDown: 'Move Down',
  moveIntoGroup: 'Move Into a New Group', turnIntoSingle: 'Turn Into a Single Condition', removeCondition: 'Remove Condition', removeGroup: 'Remove Group',
  removeRule: 'Remove Rule', removeValue: 'Remove Value', addRule: 'Add Rule', ifWord: 'If', then: 'Then', otherwise: 'Otherwise', preview: 'Preview', live: 'Live',
  firstRule: "The first rule that's true is used.", sameValue: 'The same value every time.',
  usedNow: 'Used Now', waiting: 'Waiting', doNothing: 'Do Nothing',
  insertValue: 'Insert a Value', value: 'Value', wording01: 'Wording for 0 and 1…',
  tryValues: 'Try Values', resetToLive: 'Reset to Live', unavailable: 'Unavailable', loading: 'Loading', testValues: 'Test Values', testTag: 'Test',
  tryNote: 'The simulator uses these until you close this page. Nothing is saved or sent to Home Assistant.',
  cancel: 'Cancel', done: 'Done', keepEditing: 'Keep Editing', discard: 'Discard Changes',
  customCondition: 'Custom condition', customValue: 'Custom value', customNote: "Made outside this editor. It's kept as it is.", editJson: 'Edit as JSON',
  noEntity: 'Entity not found', braces: "Text can't contain { or }.", sixteenValues: '16 values at most.', sixteenRules: '16 rules at most.',
  tooLarge: 'This condition is too large. Remove some conditions.', tooDeep: 'Groups can go 6 deep.',
  enterNumber: 'Enter a number.', chooseAnother: 'Choose Another',
  simpleCustom: "Simple can't show a custom condition.",
} as const;

/** The comparison words (spec "Words"). */
export const comparisonWords = {
  is: 'is', 'is not': 'is not', 'is one of': 'is one of', 'is not one of': 'is not one of', 'is above': 'is above', 'is below': 'is below',
  'is before': 'is before', 'is after': 'is after', 'has a value': 'has a value', 'has no value': 'has no value',
} as const;
export type Comparison = keyof typeof comparisonWords;

/** "All of these are true", "Any of these are true", "None of these are true". */
export const groupSentence = { all: 'All of these are true', any: 'Any of these are true', none: 'None of these are true' } as const;
/** "All of 3 conditions". */
export const groupCount = (mode: 'all' | 'any' | 'none', count: number) => `${mode === 'all' ? 'All' : mode === 'any' ? 'Any' : 'None'} of ${count} condition${count === 1 ? '' : 's'}`;
/** A group's page title: "All Of", "Any Of", "None Of". */
export const groupTitle = (mode: 'all' | 'any' | 'none') => `${mode === 'all' ? 'All' : mode === 'any' ? 'Any' : 'None'} Of`;
