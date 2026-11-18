import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: Record<string, any> };

/** The home fixture with Quick Links and Profile in the header (the Profile badge as given) and `count` tabs. */
export function documentWith(count: number, badge: unknown = { type: 'none' }) {
  const document = structuredClone(fixture.document);
  const present = { type: 'present', modalId: document.modals[0].id, arguments: {}, ifPresented: 'reject' };
  document.navigation.chrome.groups.push({ id: 'demo_utilities', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1',
    items: [{ id: 'demo_header', type: 'shell-header', visibility: 'always', quickLinksAction: present, profileAction: present, profile: { look: 'photo', badge } }] });
  const tabs = document.navigation.tabs;
  while (tabs.length < count) { const copy = structuredClone(tabs[tabs.length % 3]); copy.id = `demo_tab_${tabs.length}`; copy.label = `Extra ${tabs.length - 2}`; tabs.push(copy); }
  tabs.length = count;
  return document;
}

/** A Profile badge showing this literal: "3", or "9+". */
export const literalBadge = (value: string | number) => ({ type: 'value', value: { type: 'literal', value } });
