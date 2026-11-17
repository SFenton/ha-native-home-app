import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { houseFrom, type House } from '../projections';
import homeDomains from './home-domains.json';

/**
 * The story for the conditions lane (`?preview2=1&fixture=asks`): one page with a bound-color fill, a badge and a disabled state tile, over invented entities.
 * `plain` draws the same page as the preview did before those rules existed (the plain fill, no badge, an enabled tile), for before and after pictures.
 */
const icon = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const lit = (value: unknown) => ({ type: 'literal', value });
const read = (sourceId: string, as: string) => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as, missing: 'unavailable' });
const push = (pageId: string) => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });

export function asksStory(plain: boolean): { document: CompositionDocument; house: House } {
  const home = homeDomains.document as unknown as CompositionDocument;
  const base = home.pages[0];
  const nav = (id: string, title: string, rest: Record<string, unknown>, presentation?: Record<string, unknown>) => ({ id, title, type: 'navigation-tile', layout: { span: 1 }, icon: icon('house'),
    props: { family: 'neutral', selected: 'none', subtitle: lit(title), ...(presentation ? { presentation } : {}) }, action: push(base.id), ...rest });
  const fill = plain ? { type: 'standard' } : { type: 'bound-color', value: read('tint', 'string'), fallback: { type: 'solid-rgb', red: 60, green: 60, blue: 67 } };
  const components = [
    nav('fill-tile', 'Teal from the entity', {}, { layout: 'standard', titleLines: 1, fill }),
    nav('badge-tile', 'Three new', plain ? {} : { badge: { type: 'value', value: lit(3) } }),
    { id: 'door-tile', title: 'Garage door', type: 'state-tile', layout: { span: 1 }, icon: icon('lock'), props: {}, binding: { entityId: 'lock.demo_garage', builtIn: 'lock' },
      ...(plain ? {} : { enabledWhen: { condition: { type: 'compare', op: 'above', left: read('temp', 'number'), right: lit(75) }, whenUnknown: 'disabled' } }) },
  ] as unknown as CompositionNode[];
  const dataSources = [...home.dataSources, { id: 'tint', kind: 'ha-entity', entityId: lit('sensor.demo_tint') }, { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_temp') }];
  const document = { ...home, dataSources, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  const house = houseFrom({ states: [{ entityId: 'sensor.demo_tint', name: 'Tint', state: '#009688' }, { entityId: 'sensor.demo_temp', name: 'Temp', state: '60' }, { entityId: 'lock.demo_garage', name: 'Garage', state: 'locked' }] });
  return { document, house };
}
