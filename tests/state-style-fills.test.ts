import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { convertDoorTile, convertDoorTiles, DoorConversionError, type DoorTileNode } from '../src/shared/composition/door-to-state-tile';
import { securityExample } from '../src/shared/composition/security-example';
import { compositionChildren, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { fillFor, ruleFor, stateStyleSchema, usesStateFills } from '../src/shared/composition/state-styles';
import { builtInStyle } from '../src/shared/composition/state-styles';

const corpus = path.resolve(__dirname, '../contract/corpus');
const accepted = (name: string) => JSON.parse(readFileSync(path.join(corpus, `accept/state-style-${name}.json`), 'utf8'));
const fillsCase = (name: string) => JSON.parse(readFileSync(path.join(corpus, `accept/state-style-fills-${name}.json`), 'utf8'));
const FILLS = 'sh.state-style-fills@1';
const rgb = (red: number, green: number, blue: number) => ({ type: 'solid-rgb' as const, red, green, blue });

const doors = (document: CompositionDocument): DoorTileNode[] => {
  const found: DoorTileNode[] = [];
  const visit = (nodes: CompositionNode[]) => nodes.forEach(node => { if (node.type === 'door-tile') found.push(node); visit(compositionChildren(node)); });
  for (const surface of [...document.pages, ...document.modals]) visit(surface.components);
  return found;
};

describe('sh.state-style-fills@1', () => {
  it('is required by a fill on a rule, on the fallback, or by hidden words, and by nothing else', () => {
    const plain = accepted('authored-vacuum').document;
    expect(compileCompositionDocument(plain).capabilities).not.toContain(FILLS);
    const rule = structuredClone(plain); rule.stateStyles.styles[0].rules[0].fill = rgb(1, 2, 3);
    const fallback = structuredClone(plain); fallback.stateStyles.styles[0].fallback.fill = rgb(1, 2, 3);
    const hidden = structuredClone(plain); hidden.stateStyles.styles[0].hiddenWords = 'Hidden';
    for (const document of [rule, fallback, hidden]) {
      const capabilities = compileCompositionDocument(document).capabilities;
      expect(capabilities).toContain(FILLS);
      expect(capabilities).toContain('sh.state-style@1');
    }
  });
  it('reads usage from the style alone', () => {
    const style = stateStyleSchema.parse(fillsCase('every-state').document.stateStyles.styles[0]);
    expect(usesStateFills(style)).toBe(true);
    expect(usesStateFills(builtInStyle('lock')!)).toBe(false);
  });
  it('gives the fill of the rule a state resolves to, the unknown rule for unavailable states, and the fallback for a state no rule names', () => {
    const style = stateStyleSchema.parse(fillsCase('every-state').document.stateStyles.styles[0]);
    expect(fillFor(style, 'open')).toEqual(rgb(67, 160, 71));
    expect(fillFor(style, 'opening')).toEqual(rgb(251, 140, 0));
    expect(fillFor(style, 'unavailable')).toEqual(rgb(84, 110, 122));
    expect(fillFor(style, 'stopped')).toEqual(ruleFor(style, 'stopped').fill);
    expect(fillFor(builtInStyle('lock')!, 'locked')).toBeUndefined();
  });
  it('is shipped: every fills case is an accept the Studio compiles', () => {
    for (const name of ['every-state', 'fill-on-fallback-only', 'hidden-words-only', 'fill-extremes', 'fill-on-error-and-warning', 'subtitle-from-phase']) {
      expect(compileCompositionDocument(fillsCase(name).document).capabilities, name).toContain(FILLS);
    }
  });
});

describe('door-tile to state-tile', () => {
  const document = securityExample();
  const lock = doors(document).find(door => door.props.kind === 'lock')!;
  const garage = doors(document).find(door => door.props.kind === 'garage')!;

  it('derives a style from the door: per-state fills, words, hidden words, error words and pending words', () => {
    const { style, node } = convertDoorTile(garage, document.dataSources);
    expect(style.base).toBe('garage-door');
    expect(style.hiddenWords).toBe('Hidden');
    expect(fillFor(style, 'open')).toEqual(rgb(67, 160, 71));
    expect(fillFor(style, 'opening')).toEqual(rgb(67, 160, 71));
    expect(ruleFor(style, 'closing').text).toBe('closing');
    expect(ruleFor(style, 'opening').action?.verb).toBe('Reverse');
    expect(ruleFor(style, 'closed').action?.verb).toBe('Open');
    expect(ruleFor(style, 'open').action?.verb).toBe('Close');
    expect(ruleFor(style, 'unavailable')).toMatchObject({ class: 'unknown', text: 'Unavailable', fill: rgb(84, 110, 122) });
    expect(style.fallback).toMatchObject({ text: 'Unknown', fill: rgb(84, 110, 122) });
    expect(style.request).toMatchObject({ errorWords: "Didn't Respond", pendingWords: expect.arrayContaining([{ service: 'open_cover', text: 'Sending Open...' }, { service: 'close_cover', text: 'Sending Close...' }]) });
    expect(node).toMatchObject({ id: garage.id, title: garage.title, type: 'state-tile', binding: { entityId: 'cover.demo_unit', styleId: style.id, builtIn: 'garage-door' } });
  });
  it('keeps the lock classes, marks an authored error state as the error class and drops the sending words a lock never showed', () => {
    const { style, unmapped } = convertDoorTile(lock, document.dataSources);
    expect(style.base).toBe('lock');
    expect(ruleFor(style, 'jammed').class).toBe('error');
    expect(ruleFor(style, 'open').class).toBe('warning');
    expect(ruleFor(style, 'unlocked').action?.verb).toBe('Lock');
    expect(ruleFor(style, 'locked').action?.verb).toBe('Unlock');
    expect(style.request?.pendingWords).toBeUndefined();
    expect(unmapped.some(line => line.includes('lock never showed'))).toBe(true);
  });
  it('gives a built-in state the door does not list the door\'s fallback look, unlit', () => {
    const { style } = convertDoorTile(lock, document.dataSources);
    expect(ruleFor(style, 'opening')).toMatchObject({ active: false, class: 'in-progress', text: 'Unknown', fill: rgb(84, 110, 122) });
    expect(stateStyleSchema.safeParse(style).success).toBe(true);
  });
  it('writes loadingText as an expr subtitle on the source\'s phase read', () => {
    const { node } = convertDoorTile(garage, document.dataSources);
    expect(node.props.subtitle).toMatchObject({
      type: 'expr', value: { type: 'choose', cases: [{ when: { type: 'compare', op: 'eq', left: { type: 'read', from: { sourceId: garage.props.sourceId, path: ['phase'] } } }, then: { value: 'Loading' } }] },
    });
  });
  it('converts a document into one that compiles, names the fills capability and keeps the door sources', () => {
    const result = convertDoorTiles(document);
    expect(doors(result.document)).toEqual([]);
    expect(result.conversions.map(item => item.nodeId).sort()).toEqual(['demo-garage-control', 'demo-lock-control']);
    expect(result.document.dataSources).toEqual(document.dataSources);
    const compiled = compileCompositionDocument(result.document);
    expect(compiled.capabilities).toEqual(expect.arrayContaining([FILLS, 'sh.state-style@1', 'sh.tile-parts@1', 'sh.rules@1', 'sh.conditions@1']));
    expect(result.document.stateStyles?.styles).toHaveLength(2);
  });
  it('shares one style between two doors that derive the same one, and leaves the input alone', () => {
    const twin = structuredClone(document);
    const grid = twin.pages[0].components.find(item => item.type === 'tile-grid')!;
    if (grid.type !== 'tile-grid') throw new Error('no grid');
    const copy = structuredClone(garage); copy.id = 'second-garage'; grid.children.push(copy);
    const before = JSON.stringify(twin);
    const result = convertDoorTiles(twin);
    expect(JSON.stringify(twin)).toBe(before);
    expect(result.document.stateStyles?.styles).toHaveLength(2);
    const ids = result.conversions.filter(item => item.nodeId.includes('garage')).map(item => item.styleId);
    expect(new Set(ids).size).toBe(1);
  });
  it('refuses a door whose source is missing or is not a door source', () => {
    expect(() => convertDoorTile(garage, [])).toThrow(DoorConversionError);
    expect(() => convertDoorTile(garage, document.dataSources.filter(source => source.id !== garage.props.sourceId))).toThrow(DoorConversionError);
  });
  it('returns a document with no door unchanged', () => {
    const plain = accepted('authored-vacuum').document as CompositionDocument;
    const result = convertDoorTiles(plain);
    expect(result.document).toEqual(plain);
    expect(result.conversions).toEqual([]);
  });
});
