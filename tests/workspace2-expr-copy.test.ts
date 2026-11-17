import { describe, expect, it } from 'vitest';
import { comparisonWords, groupSentence, policyChoices, policyEffect, resultWords, words } from '../src/workspace2/expr/words';

/** The words of the condition and value fields, as the owner reads them (spec "Copy"). A changed word shows here, in review. */
const dir = './snapshots/copy';
const lines = (heading: string, items: readonly string[]) => `[${heading}]\n${items.join('\n')}\n`;
const pick = (...keys: (keyof typeof words)[]) => keys.map(key => String(words[key]));

describe('the copy of the condition and value fields', () => {
  it('condition', async () => {
    const text = [
      lines('Simple', pick('simple', 'logic', 'when', 'read', 'readAttribute', 'other', 'otherAttribute', 'ifUnknown', 'rawState', 'rawStateNote', 'lastChanged', 'lastChangedNote', 'itemCount', 'includes', 'item')),
      lines('Comparisons', Object.values(comparisonWords)),
      lines('Policy', [...policyChoices.show, ...policyChoices.enable].map(item => item.label)),
      lines('Groups', [...Object.values(groupSentence), ...pick('all', 'any', 'none', 'addCondition', 'addGroup', 'moveIntoGroup', 'turnIntoSingle', 'removeCondition', 'removeGroup', 'compareWithValue')]),
      lines('At rest', pick('always', 'never', 'fromStyle', 'noEntity')),
      lines('Result', Object.entries(resultWords).flatMap(([place, pair]) => [`${place}: ${pair.yes}`, `${place}: ${pair.no}`])),
      lines('Effects', Object.entries(policyEffect).map(([place, effect]) => `${place}: ${effect.show} / ${effect.hide} / ${effect.keep}`)),
      lines('Notes', pick('customCondition', 'customNote', 'simpleCustom', 'editJson')),
      lines('Footer', pick('removeCondition', 'cancel', 'done', 'keepEditing', 'discard')),
    ].join('\n');
    await expect(text).toMatchFileSnapshot(`${dir}/expr-condition.txt`);
  });
  it('value', async () => {
    const text = [
      lines('Modes', pick('fixed', 'fromEntity', 'rules', 'sameValue', 'customValue')),
      lines('From Entity', pick('from', 'read', 'homeAssistantSays', 'readAs', 'inTheApp', 'notAColor', 'noColor', 'noIcon', 'noColorNote', 'noIconNote', 'ifUnavailable', 'ifUnavailableNote')),
      lines('Dates', [words.dateShow, words.dateStyle, ...Object.values(words.dateStyles), words.dateNote]),
      lines('Edge values', [...pick('pickRead', 'lastChangedValue', 'secondsUntil', 'secondsSince', 'nowSecond', 'nowSecondNote')]),
      lines('Places', pick('opensOn', 'firstTab', 'ifTabHidden', 'firstTabShown', 'oneAction', 'byRule', 'sortBy', 'ascending', 'descending', 'addSortField', 'removeSortField', 'fourSortFields', 'badgeZero')),
    ].join('\n');
    await expect(text).toMatchFileSnapshot(`${dir}/expr-value.txt`);
  });
  it('rules', async () => {
    const text = lines('Rules', pick('firstRule', 'ifWord', 'then', 'otherwise', 'addRule', 'removeRule', 'preview', 'live', 'usedNow', 'waiting', 'doNothing', 'duplicate', 'moveUp', 'moveDown', 'firstRuleTrue', 'ruleNeedsCondition', 'testTag'));
    await expect(text).toMatchFileSnapshot(`${dir}/expr-rules.txt`);
  });
  it('tokens', async () => {
    const text = lines('Tokens', [...pick('insertValue', 'value', 'wording01', 'removeValue', 'tryValues', 'resetToLive', 'unavailable', 'loading', 'testValues', 'tryNote', 'keepZeros', 'keepZerosNote', 'capitalize', 'durationShow', 'durationNumber', 'durationUnit', 'durationNote', 'durationNoteMinutes', 'truncate', 'truncateNote'), ...Object.values(words.textCaseChoices), ...Object.values(words.textCaseNotes), ...Object.values(words.durationStyles), ...Object.values(words.durationUnits)]);
    await expect(text).toMatchFileSnapshot(`${dir}/expr-tokens.txt`);
  });
  it('problems', async () => {
    const text = lines('Problems', pick('braces', 'sixteenValues', 'sixteenRules', 'tooLarge', 'tooDeep', 'enterNumber', 'chooseAnother'));
    await expect(text).toMatchFileSnapshot(`${dir}/expr-problems.txt`);
  });
});
