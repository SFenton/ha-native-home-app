import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { componentUses, expandDocument } from '../src/shared/composition/components';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { wgflowStory } from '../src/preview2/fixtures/wgflow-story';
import { valueAt } from '../src/composition-editor';
import { deleteComponent, unlinkPlace } from '../src/workspace2/linked';
import { deleteTemplate, type TemplateDeleteHost } from '../src/workspace2/templateActions';

vi.mock('../src/workspace2/toasts', () => ({ toastManager: { add: vi.fn() } }));

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const tile = (id: string, title = id): J => ({
  id, title, type: 'navigation-tile', layout: { span: 1 }, icon: symbol('info.circle'),
  props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Open') },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});
const ref = (id: string, componentId: string, rest: J = {}): J => ({ id, type: 'component-ref', componentId, layout: { span: 1 }, ...rest });

/** The expanded, compiled document without its library, as canonical JSON: what the app would draw. */
const worked = (document: CompositionDocument) => { try { compileCompositionDocument(document); } catch (error) { throw new Error(JSON.stringify((error as any).issues?.slice(0, 3))); }
   const { componentLibrary: _, ...rest } = expandDocument(compileCompositionDocument(document).expanded); return canonicalCompositionJSON(rest); };
/** `text` with each derived id `<place>~<inner>` written as the id the copy gets, `<place>-<inner>`. */
const mapped = (text: string, places: string[]) => places.reduce((out, place) => out.replaceAll(`${place}~`, `${place}-`), text);

const base = (): J => JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;

describe('deleting a template with 119 places', () => {
  const TEMPLATE = 'demo-light-tile';
  /** 119 places of a one-node template, spread over three pages and a sheet, each with its own Name setting. */
  function many(): CompositionDocument {
    const document = base();
    document.componentLibrary = [{ id: TEMPLATE, name: 'Light Tile', node: tile('demo-light-body', 'Light'),
      params: [{ name: 'name', kind: 'text', label: 'Name' }], bindings: [{ param: 'name', nodeId: 'demo-light-body', field: 'title' }] }];
    const surfaces = [document.pages[0], document.pages[1], document.pages[2], document.modals[0]];
    for (let at = 0; at < 119; at++) {
      const surface = surfaces[at % surfaces.length];
      surface.components = [...surface.components, ref(`demo-place-${at}`, TEMPLATE, { args: { name: `Light ${at}` } })];
    }
    return document as CompositionDocument;
  }

  it('replaces every place with its own copy and the expanded document is byte-equal', () => {
    const before = many();
    expect(componentUses(before, TEMPLATE)).toHaveLength(119);
    const after = deleteComponent(before, TEMPLATE);
    expect(after.componentLibrary).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain('component-ref');
    expect(worked(after)).toBe(worked(before));
  });

  it('keeps each place\'s id, width and settings', () => {
    const before = many();
    const after = deleteComponent(before, TEMPLATE);
    const places = [...after.pages, ...after.modals].flatMap(surface => surface.components).filter(node => node.id.startsWith('demo-place-'));
    expect(places).toHaveLength(119);
    for (const place of places) {
      const at = Number(place.id.slice('demo-place-'.length));
      expect(place).toMatchObject({ type: 'navigation-tile', title: `Light ${at}`, layout: { span: 1 } });
    }
  });

  it('is one studio.apply, and one undo restores a document deep-equal to the original', () => {
    const before = many();
    const original = structuredClone(before);
    const history: CompositionDocument[] = [];
    let current = before;
    const host: TemplateDeleteHost = {
      document: before, templateId: TEMPLATE, usesId: TEMPLATE, openTemplate: vi.fn(), setUsesId: vi.fn(),
      studio: { apply: vi.fn((next: CompositionDocument) => { history.push(current); current = next; }), undo: vi.fn(() => { current = history.pop()!; }) } as never,
      linked: { say: vi.fn() },
    };
    deleteTemplate(host, TEMPLATE);
    expect(host.studio.apply).toHaveBeenCalledTimes(1);
    expect(current.componentLibrary).toBeUndefined();
    expect(host.openTemplate).toHaveBeenCalledWith(undefined);
    expect(host.setUsesId).toHaveBeenCalledWith(undefined);
    host.studio.undo();
    expect(current).toEqual(original);
    expect(before).toEqual(original);
  });
});

describe('deleting a template with nodes inside', () => {
  const lamps = (): CompositionDocument => JSON.parse(readFileSync('tests/fixtures/templates-lamps.json', 'utf8')).document;
  const places = ['demo-place-a', 'demo-place-b'];

  it('gives the inner nodes the ids <place>-<inner>, the same on every run', () => {
    const first = deleteComponent(lamps(), 'demo-lamp-pair'), second = deleteComponent(lamps(), 'demo-lamp-pair');
    expect(canonicalCompositionJSON(first)).toBe(canonicalCompositionJSON(second));
    const root = (id: string) => [...first.pages, ...first.modals].flatMap(surface => surface.components).flatMap(function find(node: J): J[] { return [node, ...(node.children ?? []).flatMap(find)]; }).find(node => node.id === id);
    expect(root('demo-place-a')).toMatchObject({ type: 'section' });
    expect((root('demo-place-a')?.children as J[]).map(child => child.id)).toEqual(['demo-place-a-demo-lamp', 'demo-place-a-demo-fan']);
    expect((root('demo-place-b')?.children as J[]).map(child => child.id)).toEqual(['demo-place-b-demo-lamp', 'demo-place-b-demo-fan']);
  });

  it('draws what the places drew once each derived id is mapped to its copy', () => {
    const before = lamps();
    expect(worked(deleteComponent(before, 'demo-lamp-pair'))).toBe(mapped(worked(before), places));
  });

  it('takes the next free id when one is taken', () => {
    const before = lamps() as unknown as J;
    // Put a node with the id the first copy would take onto another page.
    before.pages[0].components.push({ id: 'demo-place-a-demo-lamp', title: 'Taken', type: 'text', layout: { span: 1 }, props: { value: lit('Taken'), style: 'body', unavailableText: 'None' } });
    const after = deleteComponent(before as CompositionDocument, 'demo-lamp-pair');
    const ids = JSON.stringify(after);
    expect(ids).toContain('"demo-place-a-demo-lamp-2"');
    expect(ids).toContain('"demo-place-a-demo-fan"');
    expect(worked(after)).toContain('demo-place-a-demo-lamp-2');
  });

  it('unlinks one place the same way and leaves the others linked', () => {
    const before = lamps();
    const path = componentUses(before, 'demo-lamp-pair')[0].path;
    const after = unlinkPlace(before, path);
    expect(componentUses(after, 'demo-lamp-pair').map(use => use.ref.id)).toEqual(['demo-place-b']);
    expect((valueAt(after, path) as J).children.map((child: J) => child.id)).toEqual(['demo-place-a-demo-lamp', 'demo-place-a-demo-fan']);
    expect(worked(after)).toBe(mapped(worked(before), ['demo-place-a']));
  });
});

describe('deleting a template that owns a source and a flow', () => {
  const story = () => wgflowStory().document;
  const places = ['wf-use-a', 'wf-use-b'];

  it('copies each place\'s source into the document, and the copy reads it', () => {
    const before = story();
    const after = deleteComponent(before, 'wf-strip');
    const ids = after.dataSources.map(source => source.id);
    expect(ids).toEqual(expect.arrayContaining(['wf-use-a-own', 'wf-use-b-own']));
    expect(ids.filter(id => id.includes('~'))).toEqual([]);
    const text = JSON.stringify(after);
    expect(text).not.toContain('~');
    expect(text).toContain('"providerId":"wf-use-a-own"');
    expect(text).toContain('"providerId":"wf-use-b-own"');
    expect(() => compileCompositionDocument(after)).not.toThrow();
  });

  it('draws what the places drew once each derived id is mapped', () => {
    const before = story();
    expect(worked(deleteComponent(before, 'wf-strip'))).toBe(mapped(worked(before), places));
  });

  it('is the same for one place on its own', () => {
    const before = story();
    const [first] = componentUses(before, 'wf-strip');
    const after = unlinkPlace(before, first.path);
    expect(after.dataSources.map(source => source.id)).toContain('wf-use-a-own');
    expect(after.dataSources.map(source => source.id)).not.toContain('wf-use-b-own');
    expect(worked(after)).toBe(mapped(worked(before), ['wf-use-a']));
  });
});

describe('the unused and last-template cases', () => {
  it('deletes an unused template at once, with no question', () => {
    const document = base();
    document.componentLibrary = [{ id: 'demo-unused', name: 'Spare', node: tile('demo-unused-body') }];
    const apply = vi.fn();
    deleteTemplate({ document: document as CompositionDocument, templateId: undefined, usesId: undefined, openTemplate: vi.fn(), setUsesId: vi.fn(), studio: { apply, undo: vi.fn() } as never, linked: { say: vi.fn() } }, 'demo-unused');
    expect(apply).toHaveBeenCalledTimes(1);
    expect((apply.mock.calls[0][0] as CompositionDocument).componentLibrary).toBeUndefined();
  });

  it('drops sh.component-ref@1 when the last template goes, and adds no capability', () => {
    const before = JSON.parse(readFileSync('tests/fixtures/templates-lamps.json', 'utf8')).document as CompositionDocument;
    const had = compileCompositionDocument(before).capabilities;
    const after = compileCompositionDocument(deleteComponent(before, 'demo-lamp-pair')).capabilities;
    expect(had).toContain('sh.component-ref@1');
    expect(after).not.toContain('sh.component-ref@1');
    expect(after.filter(id => !had.includes(id))).toEqual([]);
  });
});
