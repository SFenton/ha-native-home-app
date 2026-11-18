import { describe, expect, it } from 'vitest';
import { templateWords as words } from '../src/workspace2/templateWords';
import { usesText } from '../src/workspace2/linked';

describe('the words of the Templates list, the editor and the delete question', () => {
  it('asks about many places with the count and what each becomes', () => {
    expect(words.deleteTitle('Light Tile')).toBe('Delete “Light Tile”?');
    expect(words.deleteText(119)).toBe('It is used in 119 places. Each one becomes its own copy, with the settings it has now, so every page looks the same. After that you change each one on its own.');
  });

  it('asks about one place in the singular', () => {
    expect(words.deleteText(1)).toBe('It is used in 1 place. That place becomes its own copy, with the settings it has now, so its page looks the same. After that you change it on its own.');
  });

  it('says what the delete did, with the count when places became copies', () => {
    expect(words.deleted('Light Tile')).toBe('Deleted Light Tile.');
    expect(words.deletedCopies('Light Tile', 119)).toBe('Deleted Light Tile. 119 places are now their own copies.');
    expect(words.deletedCopies('Light Tile', 1)).toBe('Deleted Light Tile. 1 place is now its own copy.');
    expect([words.cancel, words.deleteConfirm]).toEqual(['Cancel', 'Delete Template']);
  });

  it('summarises the uses and the editor\'s first line', () => {
    expect(words.usesSummary(119, 20)).toBe('119 places on 20 pages');
    expect(words.usesSummary(1, 1)).toBe('1 place on 1 page');
    expect(words.usesSummary(5, 3, 1)).toBe('5 places on 3 pages and 1 sheet');
    expect(words.usesSummary(2, 0, 2)).toBe('2 places on 2 sheets');
    expect(words.editorLine(0)).toBe('Template · Not used yet');
    expect(words.editorLine(1)).toBe('Template · Used in 1 place');
    expect(words.editorLine(119)).toBe('Template · Used in 119 places');
    expect(usesText(119)).toBe('Used in 119 places');
  });

  it('says "A change here shows in all N places." from two places, and nothing for fewer', () => {
    expect(words.everywhere(119)).toBe('A change here shows in all 119 places.');
    expect(words.everywhere(2)).toBe('A change here shows in all 2 places.');
    expect(words.everywhere(1)).toBe('');
    expect(words.everywhere(0)).toBe('');
  });

  it('names the actions and says "places", never "uses", in sentences', () => {
    expect([words.add, words.edit, words.rename, words.showUses, words.usesTitle, words.find]).toEqual(['Add to Page', 'Edit Template', 'Rename', 'Show Uses', 'Uses', 'Find Repeated Pieces']);
    expect(words.addLabel('Light Tile')).toBe('Add Light Tile to the page');
    for (const sentence of [words.deleteText(1), words.deleteText(5), words.everywhere(5), words.deletedCopies('X', 5)]) expect(sentence).not.toMatch(/\buses?\b/i);
  });
});
