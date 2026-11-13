import { describe, expect, it } from 'vitest';
import { createComponent } from '../src/shared/catalog';
import { resolveCollection } from '../src/shared/collection';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';
import type { Json } from '../src/shared/types';

describe('configured collection queries', () => {
  it('filters by a selected variable and sorts naturally without changing source data', () => {
    const component = createComponent('carousel');
    component.props = { filterPath: 'group', filterVariable: 'group', sortBy: 'title', sortDirectionVariable: 'direction' };
    const records = [{ title: 'Item 2', group: 'a' }, { title: 'Item 12', group: 'a' }, { title: 'Item 1', group: 'b' }];
    expect(resolveCollection(component, records, { group: 'a', direction: 'desc' })).toEqual([{ value: records[1], sourceIndex: 1 }, { value: records[0], sourceIndex: 0 }]);
    expect(records[0].title).toBe('Item 2');
    expect(resolveCollection(component, records, { group: '', direction: 'asc' }).map(record => record.value)).toEqual([records[2], records[0], records[1]]);
  });
  it('keeps false and zero as real filters, and missing sort values last in either direction', () => {
    const component = createComponent('list');
    component.props = { filterPath: 'done', filterVariable: 'selected', sortBy: 'rank', sortDirection: 'desc' };
    const records: Json[] = [{ done: false }, { done: false, rank: 0 }, { done: true, rank: 2 }];
    expect(resolveCollection(component, records, { selected: false }).map(record => record.value)).toEqual([records[1], records[0]]);
    component.props.filterPath = 'rank';
    expect(resolveCollection(component, records, { selected: 0 }).map(record => record.value)).toEqual([records[1]]);
  });
  it('rejects invalid collection dimensions and missing query variables before publication', () => {
    const document = createSampleDocument();
    const carousel = createComponent('carousel');
    document.pages[0].components.push(carousel);
    const invalid: Record<string, Json>[] = [{ columns: 0 }, { columns: 'two' }, { rows: 9 }, { filterVariable: 'missing' }, { filterPath: '__proto__.x' }];
    for (const props of invalid) {
      carousel.props = props;
      expect(() => validateDocument(document)).toThrow();
    }
    carousel.props = { columns: 3, rows: 2, sortBy: 'title', filterVariable: 'guestMode' };
    expect(() => validateDocument(document)).not.toThrow();
  });
});
