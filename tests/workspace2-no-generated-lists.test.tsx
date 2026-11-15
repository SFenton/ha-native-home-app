// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { DialogBody, type DialogKey } from '../src/workspace2/projectDialogs';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import firstSlice from './fixtures/composition-first-slice.json';

vi.mock('../src/api', () => ({
  apiUrl: (path: string) => path,
  request: vi.fn(async (path: string) => path.endsWith('/assets') ? [] : { epoch: 'e', current: null, history: [], storedAssets: 0 }),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

/** Opens every disclosure on screen, and every pushed "Advanced" page, until nothing closed is left. */
export async function openEverything(root: HTMLElement) {
  for (let round = 0; round < 8; round++) {
    const closed = [...root.querySelectorAll<HTMLElement>('.w2-disclosure-head[aria-expanded=false]:not(.w2-advanced-row)')];
    if (!closed.length) break;
    for (const head of closed) await act(async () => { fireEvent.click(head); });
  }
}

/** The generated list markup the redesign removes: a fieldset, a details list, or the legacy item class. */
const generated = (root: HTMLElement) => [...root.querySelectorAll('fieldset, details, .composition-fieldset, .composition-item')].map(element => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(' ')[0]}` : ''}`);

/** How much a walk drew, so a walk that drew nothing cannot pass. */
const drawn = { fields: 0, pushed: 0, disclosures: 0 };
const count = (root: HTMLElement) => { drawn.fields += root.querySelectorAll('[data-field-path]').length; drawn.disclosures += root.querySelectorAll('.w2-disclosure').length; };

const documents: [string, CompositionDocument][] = [
  ['home-domains', homeDomains.document as unknown as CompositionDocument],
  ['first-slice', (firstSlice as unknown as { document: CompositionDocument }).document],
];

describe('acceptance 1: no generated fieldset or details list renders in the workspace', () => {
  for (const [name, document] of documents) {
    it(`draws every kind of node in ${name} as rows, on its page and under Advanced`, async () => {
      const index = buildDocumentIndex(document);
      const seen = new Set<string>(), found: string[] = [];
      for (const entry of index.entries.values()) {
        if (entry.kind !== 'node' || !entry.node || seen.has(entry.node.type)) continue;
        const type = entry.node.type;
        seen.add(type);
        const ws = Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path });
        const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
        await openEverything(container);
        const advanced = container.querySelector<HTMLElement>('.w2-advanced-row');
        if (advanced) { await act(async () => { fireEvent.click(advanced); }); await openEverything(container); }
        count(container);
        found.push(...generated(container).map(item => `${type}: ${item}`));
        unmount();
      }
      expect(seen.size).toBeGreaterThan(name === 'home-domains' ? 5 : 2);
      expect(found).toEqual([]);
    });

    it(`draws every page and sheet of ${name} as rows`, async () => {
      const index = buildDocumentIndex(document);
      const found: string[] = [];
      for (const entry of index.entries.values()) {
        if (entry.kind !== 'page' && entry.kind !== 'modal') continue;
        const ws = Project.workspace(document, { kind: entry.kind, key: entry.key, path: entry.path });
        const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
        await openEverything(container);
        const advanced = container.querySelector<HTMLElement>('.w2-advanced-row');
        if (advanced) { await act(async () => { fireEvent.click(advanced); }); await openEverything(container); }
        count(container);
        found.push(...generated(container).map(item => `${entry.key}: ${item}`));
        unmount();
      }
      expect(found).toEqual([]);
    });
  }

  it('draws the Tabs, Header Buttons and Wallpaper panels as rows', async () => {
    const document = homeDomains.document as unknown as CompositionDocument;
    const found: string[] = [];
    for (const kind of ['tabs', 'header', 'wallpaper'] as const) {
      const ws = Project.workspace(document, { kind });
      const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
      await waitFor(() => expect(container.querySelector('.w2-props-body')).not.toBeNull());
      await openEverything(container);
      count(container);
      found.push(...generated(container).map(item => `${kind}: ${item}`));
      unmount();
    }
    expect(found).toEqual([]);
  });

  const dialogs: DialogKey[] = ['rename', 'data', 'local-state', 'links', 'launch', 'live', 'history', 'import', 'activity', 'about', 'help'];
  for (const dialog of dialogs) {
    it(`draws the ${dialog} dialog, and every row it pushes, without a fieldset or details list`, async () => {
      const document = Project.withEverything(homeDomains.document as unknown as CompositionDocument);
      const ws = Project.workspace(document);
      const { container } = render(<DialogBody dialog={dialog} ws={ws} close={() => {}} onError={() => {}}/>);
      await openEverything(container);
      count(container);
      const found = generated(container);
      // A pushed list row opens its fields in place of the list; walk each one.
      const total = Math.min(40, container.querySelectorAll('[data-pushes]').length);
      for (let at = 0; at < total; at++) {
        const row = container.querySelectorAll<HTMLElement>('[data-pushes]')[at];
        await act(async () => { fireEvent.click(row); });
        await openEverything(container);
        expect(container.querySelector('.w2-pushed'), `row ${at} of ${dialog} opened a page`).not.toBeNull();
        drawn.pushed++; count(container);
        found.push(...generated(container));
        const back = container.querySelector<HTMLElement>('.w2-back');
        if (back) await act(async () => { fireEvent.click(back); });
      }
      expect(found).toEqual([]);
    });
  }

  it('draws a source of every model the Data dialog can add as rows', async () => {
    const base = homeDomains.document as unknown as CompositionDocument;
    const { modelChoices } = await import('../src/workspace2/dialogs/sources');
    const choices = modelChoices();
    expect(choices.length).toBeGreaterThan(15);
    const document = { ...base, dataSources: choices.map(choice => choice.make(base)) } as CompositionDocument;
    const ws = Project.workspace(document);
    const { container } = render(<DialogBody dialog="data" ws={ws} close={() => {}} onError={() => {}}/>);
    const found: string[] = [];
    for (let at = 0; at < choices.length; at++) {
      await act(async () => { fireEvent.click(container.querySelectorAll<HTMLElement>('[data-pushes]')[at]); });
      await openEverything(container);
      drawn.pushed++; count(container);
      found.push(...generated(container).map(item => `${choices[at].model}: ${item}`));
      await act(async () => { fireEvent.click(container.querySelector<HTMLElement>('.w2-back')!); });
    }
    expect(found).toEqual([]);
  });

  it('has drawn real rows, and would see a generated list if one came back', async () => {
    expect(drawn.fields).toBeGreaterThan(150);
    expect(drawn.disclosures).toBeGreaterThan(20);
    expect(drawn.pushed).toBeGreaterThan(30);
    const { default: CompositionFields } = await import('../src/CompositionFields');
    const { schemaAt } = await import('../src/workspace2/rows');
    const document = documents[0][1];
    const { container } = render(<CompositionFields schema={schemaAt(document, ['dataSources'])} value={document.dataSources as never} path={['dataSources']} label="Data" document={document} onChange={() => {}} onError={() => {}}/>);
    expect(generated(container).length).toBeGreaterThan(0);
  });
});
