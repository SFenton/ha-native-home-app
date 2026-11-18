import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { useGroups } from '../src/workspace2/TemplateUses';

type J = Record<string, any>;
const text = (id: string, title: string): J => ({ id, title, type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: title }, style: 'body', unavailableText: 'None' } });
const ref = (id: string, args?: J): J => ({ id, type: 'component-ref', componentId: 'demo-note', layout: { span: 1 }, ...(args ? { args } : {}) });
const section = (id: string, title: string, children: J[]): J => ({ id, title, type: 'section', layout: { span: 1 }, props: { header: title, footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children });

/** Places on two pages and a sheet, one inside a section, one inside a tab, one named by its Name setting. */
function fixture(): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.componentLibrary = [{ id: 'demo-note', name: 'Note', node: text('demo-note-body', 'Note'), params: [{ name: 'name', kind: 'text', label: 'Name' }], bindings: [{ param: 'name', nodeId: 'demo-note-body', field: 'title' }] }];
  document.pages[0].components = [ref('demo-use-1', { name: 'Hall Note' }), section('demo-box', 'Upstairs', [ref('demo-use-2')])];
  document.pages[1].components = [{
    id: 'demo-tabs', title: 'Tabs', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'panel', transition: 'canonical-swap@1' },
    tabs: [{ id: 'a', label: 'Lights', children: [ref('demo-use-3', { name: 'Tab Note' })] }, { id: 'b', label: 'Other', children: [] }],
  }];
  document.modals[0].components = [ref('demo-use-4')];
  return document as CompositionDocument;
}

describe('useGroups', () => {
  const document = fixture();
  const groups = useGroups(document, document.componentLibrary![0]);

  it('groups the places by page and sheet, in document order', () => {
    expect(groups.map(group => [group.kind, group.title, group.uses.map(row => row.use.ref.id)])).toEqual([
      ['Page', document.pages[0].title, ['demo-use-1', 'demo-use-2']],
      ['Page', document.pages[1].title, ['demo-use-3']],
      ['Sheet', document.modals[0].title, ['demo-use-4']],
    ]);
  });

  it('titles a row by the place\'s Name setting, else the template\'s name', () => {
    expect(groups.flatMap(group => group.uses.map(row => row.title))).toEqual(['Hall Note', 'Note', 'Tab Note', 'Note']);
  });

  it('names the tab and the container a place sits in, "Tab › Container", and nothing for a place at the top', () => {
    expect(groups.flatMap(group => group.uses.map(row => row.where))).toEqual([undefined, 'Upstairs', 'Lights', undefined]);
  });

  it('has no groups for a template that is not used', () => {
    expect(useGroups({ ...document, pages: document.pages.map(page => ({ ...page, components: [] })), modals: document.modals.map(modal => ({ ...modal, components: [] })) }, document.componentLibrary![0])).toEqual([]);
  });
});
