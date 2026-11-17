import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CompositionDocument } from '../../src/shared/composition/schema';

/** The home fixture with a tab container first on its first page: three tabs with icons, a shared footer and a bottom bar with icons and titles. */
export function documentWithTabs(): CompositionDocument {
  const home = (JSON.parse(readFileSync(path.join(process.cwd(), 'src/preview2/fixtures/home-domains.json'), 'utf8')) as { document: CompositionDocument }).document;
  const text = (id: string, value: string) => ({ id, title: value, type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value }, style: 'body', unavailableText: 'None' } });
  const icon = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
  const tabs = [{ id: 'one', label: 'Lights', icon: icon('lightbulb') }, { id: 'two', label: 'Rooms', icon: icon('square.grid.2x2') }, { id: 'three', label: 'Info', icon: icon('info.circle') }];
  const node = {
    id: 'area-tabs', title: 'Area tabs', type: 'local-tabs', layout: { span: 1 },
    props: { stateId: 'area-tab', transition: 'canonical-swap@1', pinned: true, tabBar: { placement: 'bottom', labels: 'icons-and-titles' } },
    tabs: tabs.map(tab => ({ ...tab, children: [] })),
    blocks: [{ id: 'shared-top', tabs: 'all', children: [text('shared-line', 'Shared across every tab')] },
      ...tabs.map(tab => ({ id: tab.id, tabs: [tab.id], children: [text(`line-${tab.id}`, `Only on ${tab.label}`)] }))],
  };
  home.localState = [...(home.localState ?? []), { id: 'area-tab', type: 'choice', initial: 'one', options: tabs.map(tab => ({ id: tab.id, label: tab.label })) }] as CompositionDocument['localState'];
  home.pages[0] = { ...home.pages[0], components: [node as never, ...home.pages[0].components] };
  return home;
}
