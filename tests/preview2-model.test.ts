import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { childSlots, componentLocations, replaceAt, valueAt } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { compositionChildren, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { buildDocumentIndex, parseSelectionKey, selectionKey, type SelectionKey } from '../src/preview2/model';
import homeDomains from './fixtures/home-domains.json';

const corpus = path.resolve(__dirname, '../contract/corpus/accept');
const corpusDocuments = readdirSync(corpus).filter(name => name.endsWith('.json'))
  .map(name => compileCompositionDocument(JSON.parse(readFileSync(path.join(corpus, name), 'utf8')).document).document);
const homeDocument = () => compileCompositionDocument(structuredClone(homeDomains.document)).document;

/** An independent walk: every node reachable through `compositionChildren`. */
function allNodes(document: CompositionDocument): CompositionNode[] {
  const out: CompositionNode[] = [];
  const visit = (node: CompositionNode) => { out.push(node); compositionChildren(node).forEach(visit); };
  [...document.pages, ...document.modals].forEach(surface => surface.components.forEach(visit));
  return out;
}

describe('document index', () => {
  it('indexes every node the walker reaches, in every accepted corpus document and the home fixture', () => {
    for (const document of [...corpusDocuments, homeDocument()]) {
      const index = buildDocumentIndex(document);
      const nodes = allNodes(document);
      expect(index.keys.filter(key => key.startsWith('node:')).length).toBe(nodes.length);
      for (const node of nodes) expect(index.get(selectionKey('node', node.id))?.node).toBe(node);
    }
  });

  it('covers every container kind, including paged-row, pinned-actions and local tabs', () => {
    const seen = new Set<string>();
    for (const document of [...corpusDocuments, homeDocument()]) {
      const index = buildDocumentIndex(document);
      for (const key of index.keys) {
        const entry = index.get(key)!;
        if (entry.node && index.children(key).length) seen.add(entry.node.type);
        if (entry.kind === 'local-tab') seen.add('local-tab');
      }
    }
    for (const type of ['tile-grid', 'section', 'paged-row', 'pinned-actions', 'local-tabs', 'local-tab']) expect(seen).toContain(type);
  });

  it('round-trips key to path to key, and the path leads to the thing', () => {
    for (const document of [...corpusDocuments, homeDocument()]) {
      const index = buildDocumentIndex(document);
      for (const key of index.keys) {
        const at = index.pathOf(key)!, entry = index.get(key)!;
        expect(index.keyAt(at)).toBe(key);
        const found = valueAt(document, at) as { id: string; tabs?: unknown };
        expect(found).toBeTruthy();
        if (entry.kind !== 'local-tab') expect(found.id).toBe(entry.id);
        if (entry.node) expect(found).toBe(entry.node);
      }
    }
  });

  it('keys nodes, tabs, chrome items, sources and surfaces separately, so a shared id string stays distinct', () => {
    const document = homeDocument(), index = buildDocumentIndex(document);
    expect(index.get('page:' + document.pages[0].id as SelectionKey)?.path).toEqual(['pages', 0]);
    expect(index.get('modal:' + document.modals[0].id as SelectionKey)?.path).toEqual(['modals', 0]);
    expect(index.pathOf('source:' + document.dataSources[0].id as SelectionKey)).toEqual(['dataSources', 0]);
    if (document.navigation.tabs.length) expect(index.pathOf('tab:' + document.navigation.tabs[0].id as SelectionKey)).toEqual(['navigation', 'tabs', 0]);
    const chromeDocument = corpusDocuments.find(item => item.navigation.chrome.groups.some(group => group.items.length))!;
    const group = chromeDocument.navigation.chrome.groups.find(item => item.items.length)!, chrome = buildDocumentIndex(chromeDocument);
    expect(chrome.get(selectionKey('chrome-item', group.items[0].id))?.parent).toBe(selectionKey('chrome-group', group.id));
    expect(chrome.pathOf(selectionKey('chrome-item', group.items[0].id))!.slice(0, 3)).toEqual(['navigation', 'chrome', 'groups']);
    // the same string under two kinds is two entries
    const clash = structuredClone(chromeDocument);
    clash.dataSources.push({ id: group.id, kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_a' } });
    const merged = buildDocumentIndex(clash);
    expect(merged.get(selectionKey('chrome-group', group.id))).toBeDefined();
    expect(merged.get(selectionKey('source', group.id))).toBeDefined();
  });

  it('knows the surface, parent, ancestors and children of a nested node', () => {
    const document = homeDocument(), index = buildDocumentIndex(document);
    const tabs = index.keys.find(key => index.get(key)!.node?.type === 'local-tabs')!;
    const tabKeys = index.children(tabs);
    expect(tabKeys.length).toBeGreaterThan(1);
    expect(tabKeys.every(key => index.get(key)!.kind === 'local-tab')).toBe(true);
    const inner = index.children(tabKeys[0])[0];
    expect(index.get(inner)!.parent).toBe(tabKeys[0]);
    expect(index.ancestors(inner)).toEqual([index.get(inner)!.surface, tabs, tabKeys[0]]);
    expect(index.get(inner)!.surface).toMatch(/^(page|modal):/);
  });

  it('parses and builds keys, and ignores a repeated id inside one kind', () => {
    expect(parseSelectionKey('node:a.b-c')).toEqual({ kind: 'node', id: 'a.b-c' });
    expect(parseSelectionKey('nonsense')).toBeUndefined();
    const document = structuredClone(homeDocument());
    document.pages[0].components.push(structuredClone(document.pages[0].components[0]));
    const index = buildDocumentIndex(document);
    expect(index.pathOf(selectionKey('node', document.pages[0].components[0].id))).toEqual(['pages', 0, 'components', 0]);
  });
});

describe('componentLocations', () => {
  it('lists the same nodes as the walker, with paged-row and pinned-actions children and correct paths', () => {
    for (const document of [...corpusDocuments, homeDocument()]) {
      const locations = componentLocations(document);
      expect(locations.map(item => item.node).sort((a, b) => a.id < b.id ? -1 : 1)).toEqual(allNodes(document).sort((a, b) => a.id < b.id ? -1 : 1));
      for (const item of locations) expect(valueAt(document, item.path)).toBe(item.node);
    }
    const kinds = new Set(corpusDocuments.flatMap(document => componentLocations(document).filter(item => item.parent !== '').map(item => item.node.type)));
    expect(kinds.size).toBeGreaterThan(5);
  });

  it('keeps a paged row child reachable and a pinned-actions node without children harmless', () => {
    const paged = corpusDocuments.flatMap(componentLocations).find(item => item.node.type === 'paged-row' && item.node.children.length)!;
    const child = (paged.node as Extract<CompositionNode, { type: 'paged-row' }>).children[0];
    const found = corpusDocuments.flatMap(componentLocations).find(item => item.node === child)!;
    expect(found.parent).toBe(paged.node.id);
    expect(found.path.at(-2)).toBe('children');
    expect(childSlots({ type: 'pinned-actions', id: 'x' } as unknown as CompositionNode)).toEqual([]);
  });
});

describe('replaceAt structural sharing', () => {
  const leafPath = (document: CompositionDocument) => {
    const leaf = componentLocations(document).find(item => compositionChildren(item.node).length === 0 && item.node.type !== 'camera-tile')!;
    return [...leaf.path, 'title'];
  };

  it('keeps the identity of every untouched node and replaces only the path to the edit', () => {
    const document = homeDocument(), at = leafPath(document);
    const next = replaceAt(document, at, 'Renamed');
    expect(valueAt(next, at)).toBe('Renamed');
    expect(valueAt(document, at)).not.toBe('Renamed');
    const before = componentLocations(document), after = componentLocations(next);
    expect(after.length).toBe(before.length);
    const onPath = (location: { path: (string | number)[] }) => location.path.every((part, i) => at[i] === part);
    for (let i = 0; i < before.length; i += 1) {
      if (onPath(before[i])) expect(after[i].node).not.toBe(before[i].node);
      else expect(after[i].node).toBe(before[i].node);
    }
    expect(next.dataSources).toBe(document.dataSources);
    expect(next.navigation).toBe(document.navigation);
    expect(next).not.toBe(document);
  });

  it('replaces arrays and inserts keys like the old clone did, and rejects a missing parent', () => {
    const document = homeDocument();
    const grown = replaceAt(document, ['dataSources'], [...document.dataSources, document.dataSources[0]]);
    expect(grown.dataSources).toHaveLength(document.dataSources.length + 1);
    expect(grown.pages).toBe(document.pages);
    expect(() => replaceAt(document, ['pages', 99, 'title'], 'x')).toThrow('no longer exists');
    expect(() => replaceAt(document, [], 'x')).toThrow('workspace identity');
  });

  it('measures an edit on the home-domains fixture (logged)', () => {
    const document = homeDocument(), at = leafPath(document), runs = 50;
    const clone = <T,>(root: T, path: (string | number)[], value: unknown): T => {
      const copy = structuredClone(root) as T;
      const owner = valueAt(copy, path.slice(0, -1)) as object;
      Reflect.set(owner, path.at(-1)!, structuredClone(value));
      return copy;
    };
    const time = (run: () => unknown) => { const start = performance.now(); for (let i = 0; i < runs; i += 1) run(); return (performance.now() - start) / runs; };
    const stable = (next: CompositionDocument) => {
      const a = componentLocations(document), b = componentLocations(next);
      return a.filter((item, i) => b[i].node === item.node).length;
    };
    const total = componentLocations(document).length;
    const cloneMs = time(() => clone(document, at, 'x')), shareMs = time(() => replaceAt(document, at, 'x'));
    const result = { nodes: total, stableBefore: stable(clone(document, at, 'x')), stableAfter: stable(replaceAt(document, at, 'x')), cloneMs, shareMs };
    console.log('replaceAt measurement', JSON.stringify(result));
    expect(result.stableBefore).toBe(0);
    expect(result.stableAfter).toBeGreaterThan(total - 8);
  });
});
