import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { runChecks } from '../src/workspace2/checks';
import { buildOutline, collectLinks } from '../src/workspace2/outline';

const fixture = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const present = (modalId: string) => ({ type: 'present', modalId, arguments: {}, ifPresented: 'reject' });
const sheet = (id: string) => ({ ...structuredClone(fixture.document.modals[0]), id, title: `Demo ${id}` });

/** The fixture plus three synthetic sheets that only the header, a device control and a data source open, and one a route anchors. */
function document() {
  const base = structuredClone(fixture.document) as unknown as Record<string, any>;
  base.modals.push(sheet('demo_quick_links'), sheet('demo_profile'), sheet('demo_fan'), sheet('demo_source_sheet'), sheet('demo_anchor_sheet'), sheet('demo_orphan'));
  base.navigation.chrome.groups.push({ id: 'demo_utilities', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'separate@1',
    items: [{ id: 'demo_header', type: 'shell-header', visibility: 'root-only', quickLinksAction: present('demo_quick_links'), profileAction: present('demo_profile') }] });
  base.pages[0].components.push(
    { id: 'demo_fan_control', title: 'Fan', type: 'room-device-control', layout: { span: 1 }, props: { modalId: 'demo_fan' } },
    { id: 'demo_rooms', title: 'Rooms', type: 'room-navigation-grid', layout: { span: 2 }, binding: { sourceId: 'demo_rooms_source' } });
  base.dataSources.push({ id: 'demo_rooms_source', kind: 'model', model: 'room-navigation@1', items: [{ id: 'demo_room', title: 'Demo room', action: present('demo_source_sheet') }] });
  base.extensions = { ...(base.extensions ?? {}), routes: [{ id: 'demo_route', path: 'demo', pageId: base.pages[0].id, anchors: [{ fragment: 'anchor', modalId: 'demo_anchor_sheet' }] }] };
  return base as unknown as CompositionDocument;
}

describe('no way in', () => {
  const doc = document();
  const flagged = buildOutline(doc).noWayIn.map(surface => surface.id);

  it('reads the shared header: Quick Links and Your Summary are reached, with the header named as where from', () => {
    expect(flagged).not.toContain('demo_quick_links');
    expect(flagged).not.toContain('demo_profile');
    const link = collectLinks(doc).find(item => item.to.id === 'demo_profile')!;
    expect(link.from.kind).toBe('chrome');
    expect(link.holder?.id).toBe('demo_header');
  });

  it('reads a room-device-control modalId, a data source action and a route anchor', () => {
    expect(flagged).not.toContain('demo_fan');
    expect(flagged).not.toContain('demo_source_sheet');
    expect(flagged).not.toContain('demo_anchor_sheet');
  });

  it('still flags a sheet nothing opens, once, and words it in the checks', () => {
    expect(flagged.filter(id => id === 'demo_orphan')).toHaveLength(1);
    const sentences = runChecks(doc).suggestions.map(row => row.sentence);
    expect(sentences).toContain('Demo demo_orphan has no way in.');
    expect(sentences).not.toContain('Demo demo_quick_links has no way in.');
  });

  it('says where a sheet is opened from in the Sheets group', () => {
    const rows = buildOutline(doc).groups.find(group => group.id === 'sheets')!.rows;
    expect(rows.find(row => row.surface.id === 'demo_profile')?.via).toBe('Opened from the header');
    expect(rows.find(row => row.surface.id === 'demo_anchor_sheet')?.via).toBe('Opened from a route');
  });
});
