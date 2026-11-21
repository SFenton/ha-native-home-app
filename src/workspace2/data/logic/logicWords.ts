/**
 * Every string the Logic Templates surfaces say (studio-logic proposal, section 1, "Copy"). Title Case for buttons, menu commands, tags and titles; sentence
 * case elsewhere; no dashes. Never shown: operand, predicate, hole, parameter, argument, expression.
 */
import { MAX_LOGIC_ENTRIES, MAX_LOGIC_PARAMS } from '../../../shared/composition/logic-library';

export const logicWords = {
  group: 'Logic Templates',
  addTemplate: 'Logic Template', addMenu: 'Add a logic template', addValue: 'Value', addCondition: 'Condition',
  empty: 'No logic templates yet. Choose Save as Logic Template from a value’s or a condition’s More menu.',
  rename: 'Rename', showUses: 'Show Uses', duplicate: 'Duplicate', delete: 'Delete',
  saveAs: 'Save as Logic Template…', saveTitle: 'Save as Logic Template', saveName: 'Name', saveEach: 'Each use sets', saveText: 'Saves this logic. It stays here, linked to the template.', cancel: 'Cancel', save: 'Save',
  nothingToSet: 'This logic reads nothing that a use could set, so every use is the same.',
  editorTitle: 'Logic Template', name: 'Name', settings: (count: number) => `Each use sets (${count})`, addSetting: 'Add Setting…', addSettingMenu: 'Add a setting',
  settingLabel: 'Label', settingKind: 'Kind', tryWith: 'Try With', removeSetting: 'Remove Setting', removeSettingTitle: (label: string) => `Remove “${label}”?`,
  removeSettingText: (tiles: number) => `${tiles === 1 ? '1 tile that fills' : `${tiles} tiles that fill`} it in will lose that value.`,
  removeNeedsSample: (label: string) => `Give “${label}” a Try With value its template can read, then remove it.`,
  settingNotUsed: 'Not used in this template.', kindLocked: 'Kind can change only while the setting is not used in this template.',
  kinds: { entity: 'Entity', person: 'Person', text: 'Text', number: 'Number', time: 'Time', value: 'Value', condition: 'Condition' },
  pickerInside: 'Settings', pickerOutside: 'Logic Templates',
  condAdd: '+ Template', condAddTitle: 'Add a Logic Template', condNone: 'No condition templates yet.',
  openTemplate: 'Open Template', unlink: 'Unlink From Template', removeValue: 'Remove Value', removeCondition: 'Remove Condition', useTitle: (name: string) => `${name} · Logic Template`,
  backTo: (page: string) => `Back to ${page}`,
  missing: 'Missing template', noValue: (label: string) => `${label} has no value`,
  usedBy: (count: number) => count > 0 ? `Used by ${count}` : 'Not Used', usedByLong: (count: number) => `Used by ${count}`, showMore: (count: number) => `Show ${count} More`,
  deleteTitle: (name: string) => `Delete “${name}”?`, deleteText: (count: number) => `It is used by ${count}. Each use keeps its logic, unlinked.`, deleteConfirm: 'Delete Template',
  saved: (name: string) => `Saved ${name}.`, deleted: (name: string) => `Deleted ${name}.`, deletedUnlinked: (name: string) => `Deleted ${name}. Its uses are unlinked.`, unlinked: (name: string) => `Unlinked from ${name}.`,
  limitTemplates: `A document holds at most ${MAX_LOGIC_ENTRIES} logic templates`, limitSettings: `A logic template holds ${MAX_LOGIC_PARAMS} settings.`,
  tooBig: 'This is more than one rule can hold.',
  searchLine: (name: string) => `${name} is a logic template. Show in Data.`, searchShow: 'Show in Data',
  resultNothing: 'Nothing yet', resultTry: 'Worked out with each setting’s Try With value.',
  body: 'Logic', bodyValue: 'Value', bodyCondition: 'Condition',
  valueUse: 'Use a Value…', conditionUse: 'Use a Condition…',
  // The count-case starter.
  countAdd: 'Add Cases for a Count…', countTitle: 'Count', countAsk: 'Which value is counted?', countCases: 'Writes three rules: is 0, is 1 and is more than 1.',
  howMany: 'How Many Are…', howManyState: 'State', howManyTick: 'Entities to count', howManyLimit: 'Counts up to three entities.', howManyNote: 'Counts the ticked entities that are in this state.', howManyAdd: 'Use This Count',
  countNone: 'None', countOne: 'is 0', countTwo: 'is 1', countMany: 'is more than 1',
  sampleDemo: 'Logic Gallery',
} as const;
export type SettingKindWord = keyof typeof logicWords.kinds;
