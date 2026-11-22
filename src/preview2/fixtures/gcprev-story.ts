import type { CompositionDocument } from '../../shared/composition/schema';
import homeDomains from './home-domains.json';

const base = homeDomains.document as unknown as CompositionDocument;

/** A push the way the contract writes it. */
export const push = (pageId: string) => ({ type: 'push' as const, pageId, arguments: {}, origin: 'sender' as const, duplicate: 'reuse-nearest' as const });

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const button = (id: string, visibility: 'always' | 'root-only') => ({ id, type: 'button', label: id, menuLabel: id, icon: symbol('star'), visibility, priority: 'normal', rail: 'eligible', badge: { type: 'none' }, action: push('page-home') });
const present = { type: 'present', modalId: 'demo_sheet', arguments: {}, ifPresented: 'reject' };

/** A tile that runs `action`, cloned from the fixture's own so it draws as a real node. Its node id is `<host>_to_<target>`, unique in the document. */
const tileTo = (host: string, target: string, action: object) => {
  const tile = structuredClone((base.modals[1].components[0] as unknown as { children: unknown[] }).children[0]) as Record<string, unknown>;
  tile.id = `${host}_to_${target}`;
  tile.action = action;
  return tile;
};
const pushes = (host: string, ...targets: string[]) => targets.map(target => tileTo(host, target, push(target)));

/** What a page of the demo document sets: the page's own `hides` and `wideOpen`, and whether it opens pages beside itself. */
export interface DemoPageOptions {
  hides?: { tabs?: boolean; items?: string[] };
  wideOpen?: 'automatic' | 'full' | 'beside';
  columns?: boolean | 'on-demand';
}

/**
 * The story the harness draws for `fixture=gcprev`, and the unit tests' document: the demo document of the global-chrome rules: the fixture's tabs and sheets, plus made-up pages (`demo_*`) and levels. The app's header holds the
 * shell menu, three buttons (`demo_btn_always`, `demo_btn_first` which shows on the first page only, `demo_btn_hidden`; leading) and the Quick Links and Profile pair (trailing).
 * Pages: `demo_settings` (a columns page), `demo_vacation`, `demo_trip`, `demo_plain` (a plain page), `demo_full` and `demo_beside` (set to Full width and Beside), `demo_hides` (hides the tabs and `demo_btn_hidden`).
 * `page-security` (a tab's first page) opens pages beside itself. Levels of the sheet `demo_sheet`: `demo_level_a`, `demo_level_b`. `demo_level_alone` is a level no sheet opens: the Studio draws it alone.
 */
export function demoDocument(options: Partial<Record<string, DemoPageOptions>> = {}, extra: Partial<CompositionDocument['navigation']> = {}): CompositionDocument {
  const { presentation: _presentation, ...surface } = base.modals[0];
  const template = base.pages[0];
  /** The tiles each made page carries: what it opens. */
  const links: Record<string, string[]> = { demo_settings: ['demo_vacation'], demo_vacation: ['demo_trip', 'demo_full'] };
  const made = (id: string, title: string, own: DemoPageOptions = {}) => ({
    ...structuredClone(template), id, title, components: pushes(id, ...(links[id] ?? [])),
    ...(own.hides ? { hides: own.hides } : {}), ...(own.wideOpen ? { wideOpen: own.wideOpen } : {}),
    navigation: own.columns ? { type: 'navigation-columns', placeholder: `Pick from ${title}`, standalone: false, ...(own.columns === 'on-demand' ? { onDemand: true } : {}) } : { type: 'stack' },
  });
  const pages = [
    ...base.pages.map(page => page.id === 'page-home'
      ? { ...page, components: [...pushes('home', 'demo_settings', 'demo_beside', 'demo_plain', 'demo_hides'), tileTo('home', 'sheet', present), ...page.components] }
      // A tab's first page that opens pages beside it (the owner's case): Security, whose tile opens Vacation, which opens Trip.
      : page.id === 'page-security'
        ? { ...page, components: [...pushes('security', 'demo_vacation'), ...page.components], navigation: { type: 'navigation-columns', placeholder: 'Pick from Security', standalone: false } } : page),
    made('demo_settings', 'Demo Settings', { columns: true, ...options.demo_settings }),
    made('demo_vacation', 'Demo Vacation', options.demo_vacation),
    made('demo_trip', 'Demo Trip', options.demo_trip),
    made('demo_plain', 'Demo Plain', options.demo_plain),
    made('demo_full', 'Demo Full', { wideOpen: 'full', ...options.demo_full }),
    made('demo_beside', 'Demo Beside', { wideOpen: 'beside', ...options.demo_beside }),
    made('demo_hides', 'Demo Hides', { hides: { tabs: true, items: ['demo_btn_hidden'] }, ...options.demo_hides }),
  ];
  // The sheet follows the system's appearance (`system`), so light and dark differ in it; its levels are drawn in it.
  const modal = { ...structuredClone(base.modals[0]), id: 'demo_sheet', title: 'Demo Sheet', components: pushes('sheet', 'demo_level_a', 'demo_plain') };
  modal.presentation = { ...modal.presentation, appearance: 'system' } as typeof modal.presentation;
  const level = (id: string, title: string) => ({ ...structuredClone(surface), id, title, components: pushes(id, 'demo_level_b', 'demo_plain') });
  const groups = [
    ...base.navigation.chrome.groups,
    { id: 'demo_buttons', placement: 'leading', horizontal: 'separate-circles@1', vertical: 'separate@1', items: [
      button('demo_btn_always', 'always'), button('demo_btn_first', 'root-only'), button('demo_btn_hidden', 'always'),
    ] },
    { id: 'demo_trailing', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [
      { id: 'demo_header', type: 'shell-header', visibility: 'always', quickLinksAction: present, profileAction: present },
    ] },
  ];
  return {
    ...base, pages: pages as CompositionDocument['pages'], modals: [...base.modals, modal] as CompositionDocument['modals'],
    levels: [level('demo_level_a', 'Demo Level A'), level('demo_level_b', 'Demo Level B'), { ...level('demo_level_alone', 'Demo Level Alone'), components: pushes('demo_level_alone', 'demo_plain') }] as unknown as CompositionDocument['levels'],
    navigation: { ...base.navigation, chrome: { groups } as CompositionDocument['navigation']['chrome'], ...extra },
  };
}
