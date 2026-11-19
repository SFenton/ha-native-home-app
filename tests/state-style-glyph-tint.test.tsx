// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { patchRule } from '../src/shared/composition/state-style-library';
import { previewTile } from '../src/shared/composition/state-style-preview';
import {
  glyphGroundDark, glyphTintWarning, ruleFor, stateStyleSchema, usesGlyphTint, type StateStyleDefinition,
} from '../src/shared/composition/state-styles';

/**
 * `sh.state-style-glyph-tint@1`: a state style rule's `glyphTint`. The corpus pins the decode answers (`contract/corpus/*state-style-glyph-tint-*`); these
 * tests pin the capability, the first issues, the editing rules, the 3:1 warning and what the preview draws.
 */
afterEach(cleanup);
type J = Record<string, any>;
const TINT = 'sh.state-style-glyph-tint@1';
const corpus = path.resolve(__dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const home = homeDomains.document as unknown as CompositionDocument;
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const warm = solid(242, 166, 90), cool = solid(120, 180, 240);
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const tile = (rest: J = {}): J => ({ id: 'tile', title: 'Main Floor', type: 'state-tile', layout: { span: 1 }, icon: symbol('fan'),
  binding: { entityId: 'vacuum.demo_robot', styleId: 'tidy' }, props: {}, ...rest });
const library = (rules: J[], fallback: J = { class: 'unknown', active: false }): J => ({ type: 'state-styles@1', styles: [
  { id: 'tidy', name: 'Tidy', base: 'robot', domain: 'vacuum', rules, fallback }] });
const rules = (docked: J = {}): J[] => [
  { states: ['docked'], class: 'resting', active: false, ...docked },
  { states: ['cleaning'], class: 'in-progress', active: true, glyphTint: cool },
  { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
];

type Outcome = { capabilities: string[]; issues: string[] };
function compile(components: J[], styles: J = library(rules({ glyphTint: warm }))): Outcome {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.stateStyles = styles;
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { capabilities: [], issues: error.issues.map((issue: CompositionIssue) => `${issue.code} ${issue.pointer}`) };
  }
}
const parsed = (styles: J): StateStyleDefinition => stateStyleSchema.parse(styles.styles[0]) as StateStyleDefinition;

describe('the capability', () => {
  it('is pending until the app ships it', () => {
    expect(pendingCompositionCapabilities).toContain(TINT);
  });
  it('is required by an icon colour on a rule or on the fallback, and by nothing else', () => {
    expect(compile([tile()]).capabilities).toContain(TINT);
    expect(compile([tile()], library(rules(), { class: 'resting', active: false, glyphTint: warm })).capabilities).toContain(TINT);
    const plain = compile([tile()], library(rules().map(({ glyphTint, ...rule }) => rule)));
    expect(plain.issues).toEqual([]);
    expect(plain.capabilities).not.toContain(TINT);
    expect(compile([tile({ glyphTint: warm })], library(rules().map(({ glyphTint, ...rule }) => rule))).capabilities).not.toContain(TINT);
  });
  it('needs the pair id for a pair and not otherwise', () => {
    expect(compile([tile()], library(rules({ glyphTint: pair(solid(1, 2, 3), solid(4, 5, 6)) }))).capabilities).toContain('sh.solid-appearance@1');
    expect(compile([tile()]).capabilities).not.toContain('sh.solid-appearance@1');
  });
  it('reads usage from the style alone', () => {
    expect(usesGlyphTint(parsed(library(rules({ glyphTint: warm }))))).toBe(true);
    expect(usesGlyphTint(parsed(library(rules().map(({ glyphTint, ...rule }) => rule))))).toBe(false);
  });
});

describe('the validation', () => {
  it('accepts a resting or in-progress rule and the fallback of those classes', () => {
    expect(compile([tile()]).issues).toEqual([]);
    expect(compile([tile()], library(rules(), { class: 'in-progress', active: true, indicator: 'none', glyphTint: warm })).issues).toEqual([]);
  });
  it.each(['warning', 'error'])('refuses a colour on a %s rule', (stateClass) => {
    const list = [{ states: ['docked'], class: 'resting', active: false }, { states: ['stuck'], class: stateClass, active: false, glyphTint: warm }, rules()[2]];
    expect(compile([tile()], library(list)).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/rules/1/glyphTint']);
  });
  it('refuses a colour on the unknown rule, an unknown fallback and beside a fill', () => {
    expect(compile([tile()], library([rules()[0], { ...rules()[2], glyphTint: warm }])).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/rules/1/glyphTint']);
    expect(compile([tile()], library(rules(), { class: 'unknown', active: false, glyphTint: warm })).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/fallback/glyphTint']);
    expect(compile([tile()], library(rules({ glyphTint: warm, fill: solid(1, 2, 3) }))).issues).toEqual(['invalid_combination /document/stateStyles/styles/0/rules/0/glyphTint']);
  });
  it('is an exact colour: no standard, no string, no channel over 255', () => {
    expect(compile([tile()], library(rules({ glyphTint: { type: 'standard' } }))).issues[0]).toMatch(/^unknown_variant .*glyphTint\/type$/);
    expect(compile([tile()], library(rules({ glyphTint: '#F2A65A' }))).issues[0]).toMatch(/^invalid_value .*glyphTint$/);
    expect(compile([tile()], library(rules({ glyphTint: solid(256, 0, 0) }))).issues[0]).toMatch(/^limit_exceeded .*glyphTint\/red$/);
  });
});

describe('editing a rule', () => {
  const rule = { states: ['docked'], class: 'resting' as const, active: false, glyphTint: warm as never };
  it('keeps the colour on a resting or in-progress rule and clears it on request', () => {
    expect(patchRule(rule, { class: 'in-progress' }).glyphTint).toEqual(warm);
    expect(patchRule(rule, { glyphTint: undefined })).not.toHaveProperty('glyphTint');
  });
  it('drops a colour the rule can no longer carry: a warning, error or unknown class, or a fill', () => {
    for (const stateClass of ['warning', 'error', 'unknown'] as const) expect(patchRule(rule, { class: stateClass })).not.toHaveProperty('glyphTint');
    expect(patchRule(rule, { fill: solid(1, 2, 3) as never })).not.toHaveProperty('glyphTint');
  });
});

describe('the 3:1 warning', () => {
  it('is silent for colours that read on both grounds and for no colour', () => {
    expect(glyphTintWarning(undefined)).toBeUndefined();
    expect(glyphTintWarning(pair(solid(181, 101, 29), warm) as never)).toBeUndefined();
    expect(glyphTintWarning(solid(142, 142, 147) as never)).toBeUndefined();
  });
  it('names the dark member that falls short on the dark face', () => {
    expect(glyphTintWarning(solid(40, 40, 44) as never)).toMatch(/on the dark face/);
    expect(glyphTintWarning(pair(solid(181, 101, 29), solid(40, 40, 44)) as never)).toMatch(/^The dark color is [\d.]+:1 on the dark face/);
  });
  it('names the light member that falls short on a light sheet', () => {
    expect(glyphTintWarning(pair(solid(250, 250, 250), warm) as never)).toMatch(/^The light color is [\d.]+:1 on a light sheet/);
  });
  it('measures against the lightest ground of the off face', () => {
    expect(glyphGroundDark).toBe(0x3A3A3C);
  });
});

describe('the preview resolution', () => {
  const style = parsed(library(rules({ glyphTint: warm })));
  it('carries the matching rule\'s colour and the rule resolves it', () => {
    expect(previewTile(style, 'docked').glyphTint).toEqual(warm);
    expect(previewTile(style, 'cleaning').glyphTint).toEqual(cool);
    expect(ruleFor(style, 'docked').glyphTint).toEqual(warm);
  });
  it('carries none for an unavailable or unknown tile, which keeps the grey', () => {
    expect(previewTile(style, 'unavailable').glyphTint).toBeUndefined();
    expect(previewTile(style, undefined).glyphTint).toBeUndefined();
  });
  it('changes no word: the voiceover value is the state text alone', () => {
    const bare = parsed(library(rules({ glyphTint: undefined })));
    expect(previewTile(style, 'docked').voiceOver).toBe(previewTile(bare, 'docked').voiceOver);
    expect(previewTile(style, 'docked').text).toBe(previewTile(bare, 'docked').text);
  });
});

/** Draws one state tile of the style and returns its face. */
function draw(rest: J, state: string, styles: J) {
  const page = home.pages[0];
  const document = { ...home, stateStyles: styles, navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
    pages: [{ ...page, toolbar: { type: 'inherit' }, components: [tile(rest)] }], modals: [] } as unknown as CompositionDocument;
  const { container } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: [{ entityId: 'vacuum.demo_robot', name: 'Robot', state }] })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
  const root = container.querySelector<HTMLElement>('[data-sel="node:tile"]')!;
  return root.matches('.sh-tile') ? root : root.querySelector<HTMLElement>('.sh-tile') ?? root;
}

describe('the preview', () => {
  const styles = library(rules({ glyphTint: pair(solid(181, 101, 29), warm) }));
  it('draws the state\'s colour, as a Light and Dark pair', () => {
    const face = draw({}, 'docked', styles);
    expect(face.className).toContain('sh-glyph-tinted');
    expect(face.style.getPropertyValue('--glyph')).toBe('light-dark(rgb(181 101 29), rgb(242 166 90))');
  });
  it('lets the rule beat the tile\'s own icon colour and falls back to it where the rule has none', () => {
    const own = solid(1, 2, 3);
    const rest = library([{ states: ['docked'], class: 'resting', active: false }, ...rules().slice(1)]);
    expect(draw({ glyphTint: own }, 'docked', styles).style.getPropertyValue('--glyph')).toBe('light-dark(rgb(181 101 29), rgb(242 166 90))');
    cleanup();
    expect(draw({ glyphTint: own }, 'docked', rest).style.getPropertyValue('--glyph')).toBe('rgb(1 2 3)');
  });
  it('keeps the grey while unavailable and draws a state with none as it always did', () => {
    const unavailable = draw({}, 'unavailable', styles);
    expect(unavailable.className).not.toContain('sh-glyph-tinted');
    cleanup();
    expect(draw({}, 'docked', library(rules())).className).not.toContain('sh-glyph-tinted');
  });
});
