import { readFileSync } from 'node:fs';

/** Read from the repository root, where both vitest and Playwright run. */
const homeDomains = JSON.parse(readFileSync('src/preview2/fixtures/home-domains.json', 'utf8')) as { document: object };

/** The page the demo tile opens, and the title of the tile that opens it. Synthetic: both come from the `home-domains` fixture. */
export const PUSH_TARGET = { pageId: 'hc-lights-demo-room-1-detail', title: 'Demo Room 1 Lights', tile: 'Demo Room 1' };

type Loose = { pages: { id: string; components: unknown[] }[]; modals: { components: { children: unknown[] }[] }[] };
/**
 * The `home-domains` fixture with one tile at the top of its Home page that pushes {@link PUSH_TARGET}: the fixture opens its
 * pages only from sheets, and a push from a tab's root page is what the navigation tests need. A copy; the fixture is untouched.
 */
export function documentWithPush(): object {
  const document = structuredClone(homeDomains.document) as unknown as Loose;
  const tile = structuredClone(document.modals[1].components[0].children[0]) as Record<string, unknown>;
  tile.id = 'demo-push-tile';
  tile.action = { type: 'push', pageId: PUSH_TARGET.pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' };
  document.pages.find(page => page.id === 'page-home')!.components.unshift(tile);
  return document;
}
