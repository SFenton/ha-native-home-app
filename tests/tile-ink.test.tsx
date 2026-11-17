// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { patchRule } from '../src/shared/composition/state-style-library';
import { previewTile } from '../src/shared/composition/state-style-preview';
import { stateStyleSchema, type StateStyleDefinition } from '../src/shared/composition/state-styles';
import type { CompositionDocument } from '../src/shared/composition/schema';

/**
 * TC5: the tile ink (`sh.tile-ink@1`): a state tile's `glyphTint` and `discGlyphTint`, and the `fillInk` of a state style's fill. The corpora pin the
 * decode answers; these tests pin the capability each needs, the first issues, and what the preview draws.
 */
afterEach(cleanup);
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const home = homeDomains.document as unknown as CompositionDocument;
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const purple = pair(solid(0x8E, 0x6D, 0xAC), solid(0xC1, 0x8C, 0xEE));
const lit = (value: unknown): J => ({ type: 'literal', value });
const disc: J = { id: 'pause', icon: symbol('pause.fill'), label: 'Pause', action: { type: 'call-service', domain: 'vacuum', service: 'pause', feedback: 'policy', target: { entity_id: lit('vacuum.demo_robot') } } };
const tile = (rest: J = {}): J => ({ id: 'tile', title: 'Main Floor', type: 'state-tile', layout: { span: 1 }, icon: symbol('fan'), binding: { entityId: 'vacuum.demo_robot', styleId: 'tidy' }, props: {}, ...rest });
const style = (rules: J[], fallback: J = {}): J => ({ type: 'state-styles@1', styles: [{ id: 'tidy', name: 'Tidy', base: 'robot', domain: 'vacuum', rules, fallback: { class: 'unknown', active: false, ...fallback } }] });
const rules = (docked: J = {}): J[] => [
  { states: ['docked'], class: 'resting', active: false, ...docked },
  { states: ['cleaning'], class: 'resting', active: true, fill: solid(120, 90, 160), fillInk: 'soft' },
  { states: ['error'], class: 'error', active: false },
  { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
];

type Outcome = { capabilities: string[]; issues: string[] };
function compile(components: J[], library: J | undefined = style(rules())): Outcome {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  if (library) document.stateStyles = library;
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { capabilities: [], issues: error.issues.map((issue: CompositionIssue) => `${issue.code} ${issue.pointer.replace('/document/pages/2/components/0', '~')}`) };
  }
}

describe('TC5: the capability', () => {
  it('is shipped and gates the three fields, and only them', () => {
    expect(pendingCompositionCapabilities).not.toContain('sh.tile-ink@1');
    expect(compile([tile({ glyphTint: solid(1, 2, 3) })]).capabilities).toContain('sh.tile-ink@1');
    expect(compile([tile({ discGlyphTint: solid(1, 2, 3), props: { discs: [disc] } })]).capabilities).toContain('sh.tile-ink@1');
    expect(compile([tile()], style(rules({ fill: solid(1, 2, 3), fillInk: 'soft' }))).capabilities).toContain('sh.tile-ink@1');
    const plain = compile([tile()], style([{ states: ['docked'], class: 'resting', active: false, fill: solid(1, 2, 3) }, ...rules().slice(2)]));
    expect(plain.issues).toEqual([]);
    expect(plain.capabilities).not.toContain('sh.tile-ink@1');
  });
  it('a cell fit needs the id, written or not, and sets the natural class and part marker in the preview', () => {
    expect(compile([tile({ cellFit: 'natural' })]).capabilities).toContain('sh.tile-ink@1');
    expect(compile([tile({ cellFit: 'fill' })]).capabilities).toContain('sh.tile-ink@1');
  });
  it('a pair tint also needs the pair id, and a fill ink needs the fills id', () => {
    const result = compile([tile({ glyphTint: purple })]);
    expect(result.capabilities).toEqual(expect.arrayContaining(['sh.tile-ink@1', 'sh.solid-appearance@1']));
    expect(compile([tile({ glyphTint: solid(1, 2, 3) })]).capabilities).not.toContain('sh.solid-appearance@1');
    expect(compile([tile()], style(rules({ fill: solid(1, 2, 3), fillInk: 'soft' }))).capabilities).toContain('sh.state-style-fills@1');
  });
});

describe('TC5: the first issues', () => {
  it('refuses a tint that is not an exact colour or a pair', () => {
    expect(compile([tile({ glyphTint: { type: 'standard' } })]).issues).toEqual(['unknown_variant ~/glyphTint/type']);
    expect(compile([tile({ glyphTint: { type: 'conditional', cases: [], otherwise: solid(1, 2, 3) } })]).issues).toEqual(['unknown_variant ~/glyphTint/type']);
    expect(compile([tile({ discGlyphTint: { type: 'bound-color', value: lit('x'), fallback: solid(1, 2, 3) } })]).issues).toEqual(['unknown_variant ~/discGlyphTint/type']);
    expect(compile([tile({ glyphTint: solid(1, 256, 3) })]).issues).toEqual(['limit_exceeded ~/glyphTint/green']);
    expect(compile([tile({ glyphTint: { type: 'solid-appearance', light: solid(1, 2, 3) } })]).issues).toEqual(['missing_required ~/glyphTint/dark']);
    expect(compile([tile({ discGlyphTint: { ...solid(1, 2, 3), alpha: 0.5 } })]).issues).toEqual(['unknown_field ~/discGlyphTint/alpha']);
  });
  it('refuses a fill ink that is not white or soft, and one with no fill', () => {
    expect(compile([tile()], style(rules({ fill: solid(1, 2, 3), fillInk: 'black' }))).issues).toEqual(['unknown_variant /document/stateStyles/styles/0/rules/0/fillInk']);
    expect(compile([tile()], style(rules({ fillInk: 'soft' }))).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/rules/0/fillInk']);
    expect(compile([tile()], style(rules(), { fillInk: 'soft' })).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/fallback/fillInk']);
  });
  it('refuses a cell fit that is not fill or natural', () => {
    expect(compile([tile({ cellFit: 'stretch' })]).issues).toEqual(['unknown_variant ~/cellFit']);
    expect(compile([tile({ cellFit: 1 })]).issues).toEqual(['unknown_variant ~/cellFit']);
  });
  it('is a state tile field only', () => {
    const nav = { id: 'n', title: 'n', type: 'navigation-tile', layout: { span: 1 }, icon: symbol('house'), glyphTint: solid(1, 2, 3),
      props: { family: 'neutral', selected: 'none', subtitle: lit('x') }, action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } };
    expect(compile([nav]).issues).toEqual(['unknown_field ~/glyphTint']);
  });
});

describe('TC5: the style data', () => {
  it('keeps a fill ink only beside its fill when a rule is patched', () => {
    const rule = { states: ['docked'], class: 'resting' as const, active: false, fill: solid(1, 2, 3) as never, fillInk: 'soft' as const };
    expect(patchRule(rule, { fill: undefined }).fillInk).toBeUndefined();
    expect(patchRule(rule, { fillInk: undefined })).not.toHaveProperty('fillInk');
    expect(patchRule(rule, { class: 'warning' }).fillInk).toBe('soft');
  });
  it('carries the ink to the preview of a state with a fill', () => {
    const library = stateStyleSchema.parse(style(rules()).styles[0]) as StateStyleDefinition;
    expect(previewTile(library, 'cleaning').fillInk).toBe('soft');
    expect(previewTile(library, 'docked').fillInk).toBeUndefined();
  });
});

/** Draws one state tile of the style and returns its button and its wrapper. */
function draw(rest: J, state: string, library: J = style(rules())) {
  const page = home.pages[0];
  const document = { ...home, stateStyles: library, navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
    pages: [{ ...page, toolbar: { type: 'inherit' }, components: [tile(rest)] }], modals: [] } as unknown as CompositionDocument;
  const { container } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: [{ entityId: 'vacuum.demo_robot', name: 'Robot', state }] })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
  const root = container.querySelector<HTMLElement>('[data-sel="node:tile"]')!;
  const face = root.matches('.sh-tile') ? root : root.querySelector<HTMLElement>('.sh-tile') ?? root;
  return { face, parts: root.closest<HTMLElement>('.sh-tile-parts') ?? root.querySelector<HTMLElement>('.sh-tile-parts') ?? undefined, container };
}
const tint = 'light-dark(rgb(142 109 172), rgb(193 140 238))';

describe('TC5: the preview', () => {
  it('draws the icon grey without a tint, and in the tint with one, as a Light and Dark pair', () => {
    expect(draw({}, 'docked').face.style.getPropertyValue('--glyph')).toBe('');
    cleanup();
    const tinted = draw({ glyphTint: purple }, 'docked').face;
    expect(tinted.className).toContain('sh-glyph-tinted');
    expect(tinted.style.getPropertyValue('--glyph')).toBe(tint);
  });
  it('ignores the tint on an unavailable tile, whose grey icon the sheet draws at half opacity', () => {
    const face = draw({ glyphTint: purple }, 'unavailable').face;
    expect(face.className).not.toContain('sh-glyph-tinted');
    expect(face.style.getPropertyValue('--glyph')).toBe('');
    expect(face.className).toContain('sh-class-unknown');
  });
  it('ignores the tint on an error face, a face with a fill and a filled face', () => {
    expect(draw({ glyphTint: purple }, 'error').face.className).not.toContain('sh-glyph-tinted');
    cleanup();
    expect(draw({ glyphTint: purple }, 'cleaning').face.className).not.toContain('sh-glyph-tinted');
    cleanup();
    const filledWhen = { type: 'compare', op: 'eq', left: lit(1), right: lit(1) };
    expect(draw({ glyphTint: purple, filledWhen }, 'docked').face.className).not.toContain('sh-glyph-tinted');
  });
  it('tints the button icons on a dark face and keeps white without one', () => {
    const withTint = draw({ discGlyphTint: purple, props: { discs: [disc] } }, 'docked').parts!;
    expect(withTint.style.getPropertyValue('--disc-glyph')).toBe('light-dark(rgb(142 109 172), rgb(193 140 238))');
    expect(withTint.hasAttribute('data-face')).toBe(false);
    cleanup();
    expect(draw({ props: { discs: [disc] } }, 'docked').parts!.style.getPropertyValue('--disc-glyph')).toBe('');
  });
  it('keeps the black 18% button on a filled face, whatever the tint', () => {
    const filledWhen = { type: 'compare', op: 'eq', left: lit(1), right: lit(1) };
    const parts = draw({ discGlyphTint: purple, filledWhen, props: { discs: [disc] } }, 'docked').parts!;
    expect(parts.getAttribute('data-face')).toBe('filled');
    expect(parts.style.getPropertyValue('--disc-glyph')).toBe('');
    cleanup();
    expect(draw({ discGlyphTint: purple, props: { discs: [disc] } }, 'cleaning').parts!.getAttribute('data-face')).toBe('filled');
  });
  it('marks a tile that keeps its own height, with or without parts, and not one that fills', () => {
    expect(draw({ cellFit: 'natural' }, 'docked').face.className).toContain('sh-cell-natural');
    cleanup();
    expect(draw({ cellFit: 'natural', props: { discs: [disc] } }, 'docked').parts!.getAttribute('data-cell-fit')).toBe('natural');
    cleanup();
    expect(draw({ cellFit: 'fill' }, 'docked').face.className).not.toContain('sh-cell-natural');
    cleanup();
    expect(draw({}, 'docked').face.className).not.toContain('sh-cell-natural');
  });
  it('draws the words on a fill in the ink the state names, white by default', () => {
    expect(draw({}, 'cleaning').face.className).toContain('sh-fill-ink-soft');
    cleanup();
    const white = style([{ states: ['docked'], class: 'resting', active: false, fill: solid(1, 2, 3) }, ...rules().slice(2)]);
    expect(draw({}, 'docked', white).face.className).toContain('sh-fill-ink-white');
    cleanup();
    expect(draw({}, 'unavailable').face.className).not.toContain('sh-fill-ink');
  });
});
