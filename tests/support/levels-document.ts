import { readFileSync } from 'node:fs';

/** Read from the repository root, where Playwright runs. */
const homeDomains = JSON.parse(readFileSync('src/preview2/fixtures/home-domains.json', 'utf8')) as { document: Loose };

type Node = Record<string, unknown>;
type Loose = { pages: { id: string; components: Node[] }[]; modals: { id: string; title: string; components: Node[]; presentation?: unknown }[]; levels?: unknown[] };
const push = (pageId: string) => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });

/**
 * The `home-domains` fixture with a made-up sheet `demo_sheet` that Home presents (`demo_home_to_sheet`), the levels `demo_level_a` (opened by the sheet,
 * holding one tile that opens level B), `demo_level_b` (opened by level A, empty) and `demo_level_alone`, which nothing opens (one tile, `demo_alone_tile`).
 * Tiles are cloned from the fixture's own so they draw as real tiles. The levels are the shipped shape (`sh.sheet-levels@1`). A copy.
 */
export function documentWithLevels(): object {
  const document = structuredClone(homeDomains.document);
  const tileTo = (host: string, target: string, action: object) => {
    const tile = structuredClone((document.modals[1].components[0] as unknown as { children: Node[] }).children[0]);
    tile.id = `${host}_to_${target}`;
    tile.action = action;
    return tile;
  };
  const { presentation: _presentation, ...surface } = structuredClone(document.modals[0]);
  const level = (id: string, title: string, ...targets: string[]) => ({ ...structuredClone(surface), id, title, components: targets.map(target => tileTo(id, target, push(target))) });
  const sheet = { ...structuredClone(document.modals[0]), id: 'demo_sheet', title: 'Demo Sheet', components: [{ ...tileTo('demo_sheet', 'demo_level_a', push('demo_level_a')) }] };
  document.modals.push(sheet);
  const alone = level('demo_level_alone', 'Demo Level Alone', 'demo_level_b');
  Object.assign(alone.components[0], { id: 'demo_alone_tile' });
  document.levels = [level('demo_level_a', 'Demo Level A', 'demo_level_b'), level('demo_level_b', 'Demo Level B'), alone];
  const home = document.pages.find(page => page.id === 'page-home')!;
  home.components.unshift(tileTo('demo_home', 'sheet', { type: 'present', modalId: 'demo_sheet', arguments: {}, ifPresented: 'reject' }));
  return document;
}
