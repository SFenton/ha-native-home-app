import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { lightSwipe, presetOf, presetsFor, presetSwipe, swipeChecks, swipeSummary, type SwipePreset } from '../src/workspace2/layout/swipe-presets';
import type { TileSwipe } from '../src/shared/composition/tile-swipe';

const corpus = path.resolve(import.meta.dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: { code: string; pointer: string }; issue?: { code: string; pointer: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const ours = index.cases.filter(item => /^(accept|reject)\/(pending-)?tile-swipe-/.test(item.file));
const bytes = (file: string) => readFileSync(path.join(corpus, file));
const envelope = (file: string) => JSON.parse(bytes(file).toString('utf8'));

describe('sh.tile-swipe@1 corpus', () => {
  it('is shipped and sorted, and holds the cases of the design: 13 compile and 34 are refused', () => {
    expect(pendingCompositionCapabilities).not.toContain('sh.tile-swipe@1');
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
    expect(ours.filter(item => item.outcome === 'accept' || (item.pending && !item.studioIssue)).length).toBe(13);
    expect(ours.filter(item => item.outcome === 'reject').length).toBe(34);
  });
  it.each(ours.filter(item => item.outcome === 'accept' && !item.file.includes('no-swipe')))('compiles $file and declares the id', item => {
    const document = envelope(item.file);
    expect(() => decodeCompositionPublication(bytes(item.file))).not.toThrow();
    expect(document.capabilities).toContain('sh.tile-swipe@1');
    expect(legacyManifest(compileCompositionDocument(document.document).capabilities)).toEqual(legacyManifest(document.capabilities));
  });
  it.each(ours.filter(item => item.outcome === 'reject'))('refuses $file with its own code at its own pointer', item => {
    let first: { code: string; pointer: string } | undefined;
    try { decodeCompositionPublication(bytes(item.file)); } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      first = error.issues[0];
    }
    expect({ code: first?.code, pointer: first?.pointer }).toEqual({ code: item.issue!.code, pointer: item.issue!.pointer });
  });
  it('gives every refusal an expect: the corpus holds the code and the pointer', () => {
    for (const item of ours.filter(entry => entry.outcome === 'reject' && !entry.pending || entry.studioIssue)) expect(item.studioIssue ?? item.issue).toMatchObject({ code: expect.any(String), pointer: expect.any(String) });
  });
  it('declares the id only on a document that has a swipe', () => {
    const plain = envelope('accept/tile-swipe-light-with-no-swipe-needs-no-id.json');
    expect(plain.capabilities).not.toContain('sh.tile-swipe@1');
    const swiped = envelope('accept/tile-swipe-light-minimal.json');
    swiped.document.pages[2].components[0].props = { sourceId: 'light-main' };
    expect(compileCompositionDocument(swiped.document).capabilities).not.toContain('sh.tile-swipe@1');
    // Turning the swipe off removes the object, and the document equals one that never had it.
    expect(JSON.stringify(swiped.document)).toBe(JSON.stringify(plain.document));
  });
});

describe('Swipe to Adjust presets', () => {
  const base = envelope('accept/tile-swipe-cover-position.json');
  const compileWith = (entityId: string, swipe: TileSwipe) => {
    const document = structuredClone(base.document);
    const tile = document.pages[2].components[0];
    tile.binding = entityId.startsWith('cover.') ? { entityId, builtIn: 'blind' } : { entityId, styleId: `demo-${entityId.split('.')[0]}` };
    tile.props = { swipe };
    document.stateStyles = { type: 'state-styles@1', styles: ['fan', 'climate', 'media_player', 'light', 'input_number'].map(domain => ({ id: `demo-${domain}`, name: domain, domain, rules: [{ states: ['unavailable', 'unknown'], class: 'unknown', active: false }], fallback: { class: 'resting', active: false } })) };
    return compileCompositionDocument(document);
  };
  const cases: [SwipePreset, string][] = [['brightness', 'light.demo_lamp'], ['cover-position', 'cover.demo_blinds'], ['fan-speed', 'fan.demo_fan'], ['temperature', 'climate.demo_thermostat'], ['volume', 'media_player.demo_speaker'], ['custom', 'input_number.demo_level']];
  it.each(cases)('the %s preset writes a swipe the compiler accepts, and it reads back as that preset', (preset, entityId) => {
    const swipe = presetSwipe(preset, entityId, 'blinds', { minTemp: 60, maxTemp: 85, targetTempStep: 0.5, percentageStep: 10 });
    expect(compileWith(entityId, swipe).capabilities).toContain('sh.tile-swipe@1');
    expect(presetOf(swipe)).toBe(preset);
    expect(swipeChecks(swipe, { tile: 'state-tile', hasOtherControl: true }).filter(check => check.tone === 'warning')).toEqual([]);
  });
  it('lists only the presets the entity supports, then Custom', () => {
    expect(presetsFor('cover.demo')).toEqual(['cover-position', 'custom']);
    expect(presetsFor('climate.demo')).toEqual(['temperature', 'custom']);
    expect(presetsFor('sensor.demo')).toEqual(['custom']);
    expect(presetsFor(undefined)).toEqual(['custom']);
  });
  it('expands the documented fields per domain', () => {
    const cover = presetSwipe('cover-position', 'cover.demo_blinds', 'blinds');
    expect(cover.range).toEqual({ min: 0, max: 100, step: 1 });
    expect(cover.label).toBe('position');
    expect(cover.action).toMatchObject({ domain: 'cover', service: 'set_cover_position' });
    const temperature = presetSwipe('temperature', 'climate.demo', 'thermostat', { minTemp: 60, maxTemp: 85, targetTempStep: 0.5 });
    expect(temperature.range).toEqual({ min: 60, max: 85, step: 0.5 });
    expect(temperature.format).toBe('{value}°');
    const volume = presetSwipe('volume', 'media_player.demo', 'speaker');
    expect(JSON.stringify(volume.action)).toContain('"op":"divide"');
    expect(lightSwipe()).toEqual({ axis: 'horizontal', range: { min: 0, max: 100, step: 1 }, commit: 'release' });
  });
  it('summarises the row: Off, Brightness, Cover Position', () => {
    expect(swipeSummary(undefined, 'state-tile')).toBe('Off');
    expect(swipeSummary(lightSwipe(), 'light-group-tile')).toBe('Brightness');
    expect(swipeSummary(presetSwipe('cover-position', 'cover.demo', 'blinds'), 'state-tile')).toBe('Cover Position');
  });
});

describe('the checks the page shows', () => {
  const cover = presetSwipe('cover-position', 'cover.demo_blinds', 'blinds');
  const ids = (swipe: TileSwipe, context: Parameters<typeof swipeChecks>[1] = { tile: 'state-tile', hasOtherControl: true }) => swipeChecks(swipe, context).map(check => check.id);
  it('says nothing about a sound swipe', () => expect(ids(cover)).toEqual([]));
  it('range: minimum below maximum, at most 100 steps', () => {
    expect(ids({ ...cover, range: { min: 5, max: 5, step: 1 } })).toContain('range');
    expect(ids({ ...cover, range: { min: 0, max: 100, step: 0.5 }, detent: 10 })).toContain('range');
  });
  it('tick: a multiple of the step, at most 25 across the range', () => {
    expect(ids({ ...cover, range: { min: 0, max: 100, step: 5 }, detent: 7 })).toContain('tick');
    expect(ids({ ...cover, detent: 2 })).toContain('tick');
  });
  it('value text: the longest value must fit the narrowest tile', () => expect(ids({ ...cover, format: 'Open all the way to {value} percent' })).toContain('text'));
  it('call: it never uses the value, or asks first', () => {
    expect(ids({ ...cover, action: { type: 'call-service', domain: 'cover', service: 'open_cover' } })).toContain('call');
    expect(ids({ ...cover, action: { ...cover.action!, confirmation: { type: 'additional', style: 'alert', title: 'Sure?', confirmLabel: 'Go', cancelLabel: 'Cancel', destructive: false } } })).toContain('asks');
  });
  it('sideways row, door, volume, progress and the only way', () => {
    expect(ids(cover, { tile: 'state-tile', inSidewaysRow: true, hasOtherControl: true })).toContain('sideways');
    expect(ids(cover, { tile: 'state-tile', deviceClass: 'garage', hasOtherControl: true })).toContain('door');
    expect(ids(presetSwipe('volume', 'media_player.demo', 'speaker'))).toContain('volume');
    expect(ids(cover, { tile: 'state-tile', hasProgress: true, hasOtherControl: true })).toContain('progress');
    expect(ids(cover, { tile: 'state-tile', hasOtherControl: false })).toContain('only');
  });
});
