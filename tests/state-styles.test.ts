import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import {
  addStateTile, buildStateMap, deleteBlock, deleteStyle, duplicateStyle, editWarning, libraryEntries, newStateTile, overriddenLayers, renameStyle, resetOverride,
  saveAsNewStyle, setOverride, stateTiles, usedBy, usedByText,
} from '../src/shared/composition/state-style-library';
import {
  arcAllowed, builtInStyles, colourAllowed, stateColours, defaultStateLook, indicatorOptions, NO_ARC_WITH_ACTION, resolveTileStyle, ruleFor, stateStyleSchema, suggestBuiltInStyle,
  type StateStyleLibrary,
} from '../src/shared/composition/state-styles';

const corpus = path.resolve(__dirname, '../contract/corpus');
const accepted = (name: string) => JSON.parse(readFileSync(path.join(corpus, `accept/state-style-${name}.json`), 'utf8'));
const document = () => accepted('authored-vacuum').document;

describe('built-in styles as data', () => {
  it('equals the fixture the app tests against', () => {
    const fixture = JSON.parse(readFileSync(path.join(corpus, 'state-styles/built-in.json'), 'utf8'));
    expect(fixture).toEqual({ format: 1, styles: JSON.parse(JSON.stringify(builtInStyles)) });
  });
  it('lists the eight styles in the library order and validates each against the schema', () => {
    expect(builtInStyles.map(style => style.id)).toEqual(['garage-door', 'lock', 'blind', 'alarm', 'robot', 'detector', 'notice', 'switch']);
    for (const style of builtInStyles) expect(stateStyleSchema.safeParse(style).success, style.id).toBe(true);
  });
  it('ends every style with a fallback that copies its unknown rule', () => {
    for (const style of builtInStyles) {
      const unknown = style.rules.find(rule => rule.class === 'unknown')!;
      const { states: _states, ...expected } = unknown;
      expect(style.fallback, style.id).toEqual(expected);
    }
  });
  it('classes unavailable and unknown as the unknown class in every style', () => {
    for (const style of builtInStyles) {
      for (const state of ['unavailable', 'unknown']) expect(ruleFor(style, state).class, `${style.id} ${state}`).toBe('unknown');
    }
  });
  it('carries the three warning defaults', () => {
    const warning = (id: string, state: string) => ruleFor(builtInStyles.find(style => style.id === id)!, state).class;
    expect([warning('alarm', 'pending'), warning('lock', 'open'), warning('robot', 'paused')]).toEqual(['warning', 'warning', 'warning']);
  });
  it('compiles as a library with no rejection', () => {
    const value = document();
    value.stateStyles = { type: 'state-styles@1', styles: builtInStyles.map(style => ({ ...structuredClone(style), id: `copy-${style.id}` })) };
    expect(compileCompositionDocument(value).capabilities).toContain('sh.state-style@1');
  });
});

describe('default classes', () => {
  it('uses Home Assistant state names per domain', () => {
    expect(defaultStateLook('alarm_control_panel', 'pending')).toMatchObject({ class: 'warning', classified: true });
    expect(defaultStateLook('lock', 'open')).toMatchObject({ class: 'warning' });
    expect(defaultStateLook('vacuum', 'paused')).toMatchObject({ class: 'warning' });
    expect(defaultStateLook('cover', 'opening')).toMatchObject({ class: 'in-progress', active: true });
    expect(defaultStateLook('cover', 'open')).toMatchObject({ class: 'resting', active: true });
    expect(defaultStateLook('vacuum', 'cleaning')).toMatchObject({ class: 'resting', active: true });
    expect(defaultStateLook('lock', 'jammed')).toMatchObject({ class: 'error' });
  });
  it('classes lock opening as lit in-progress, with unlocking, in the defaults and the built-in lock', () => {
    expect(defaultStateLook('lock', 'opening')).toEqual({ class: 'in-progress', active: true, classified: true });
    const lock = builtInStyles.find(style => style.id === 'lock')!;
    expect(ruleFor(lock, 'opening')).toMatchObject({ class: 'in-progress', active: true });
    expect(ruleFor(lock, 'opening')).toBe(ruleFor(lock, 'unlocking'));
  });
  it('defaults every state of every built-in style to the class and lit face the style gives it', () => {
    const deviceClass: Record<string, string> = { detector: 'smoke', notice: 'battery' };
    for (const style of builtInStyles) {
      for (const rule of style.rules) for (const state of rule.states) {
        const look = defaultStateLook(style.domain, state, deviceClass[style.id]);
        expect({ class: look.class, active: look.active, classified: look.classified }, `${style.id} ${state}`).toEqual({ class: rule.class, active: rule.active, classified: true });
      }
    }
  });
  it('reverses connectivity: the lost connection warns', () => {
    expect(defaultStateLook('binary_sensor', 'off', 'connectivity')).toMatchObject({ class: 'warning' });
    expect(defaultStateLook('binary_sensor', 'on', 'connectivity')).toMatchObject({ class: 'resting' });
  });
  it('makes unavailable and unknown the unknown class in every domain', () => {
    for (const domain of ['cover', 'lock', 'vacuum', 'sensor', 'anything']) {
      expect(defaultStateLook(domain, 'unavailable').class).toBe('unknown');
      expect(defaultStateLook(domain, 'unknown').class).toBe('unknown');
    }
  });
  it('leaves a state no table knows resting and unclassified', () => {
    expect(defaultStateLook('vacuum', 'defrosting')).toEqual({ class: 'resting', active: false, classified: false });
  });
  it('follows the device class for a binary sensor', () => {
    expect(defaultStateLook('binary_sensor', 'on', 'smoke')).toMatchObject({ class: 'error' });
    expect(defaultStateLook('binary_sensor', 'on', 'battery')).toMatchObject({ class: 'warning' });
    expect(defaultStateLook('binary_sensor', 'on', 'motion')).toMatchObject({ class: 'resting', active: true });
  });
  it('suggests a built-in style by domain and device class', () => {
    expect(suggestBuiltInStyle('binary_sensor.demo_x', 'smoke')).toBe('detector');
    expect(suggestBuiltInStyle('binary_sensor.demo_x', 'connectivity')).toBe('notice');
    expect(suggestBuiltInStyle('cover.demo_x', 'garage')).toBe('garage-door');
    expect(suggestBuiltInStyle('cover.demo_x', 'blind')).toBe('blind');
    expect(suggestBuiltInStyle('vacuum.demo_x')).toBe('robot');
    expect(suggestBuiltInStyle('sensor.demo_x')).toBeUndefined();
  });
});

describe('indicator availability by action', () => {
  it('offers the arc only to a state with no action', () => {
    const arc = (rule: Parameters<typeof indicatorOptions>[0]) => indicatorOptions(rule).find(option => option.value === 'arc-spinner')!;
    expect(arc({ class: 'in-progress' })).toMatchObject({ available: true });
    expect(arc({ class: 'in-progress', action: {} })).toMatchObject({ available: false, note: NO_ARC_WITH_ACTION });
    expect(arc({ class: 'unknown' }).available).toBe(false);
    expect(arcAllowed({ class: 'resting' })).toBe(true);
  });
  it('names the iOS 17 fallback beside Breathe and Wiggle, and lists the closed set', () => {
    const options = indicatorOptions({ class: 'resting' });
    expect(options.map(option => option.value)).toEqual(['none', 'arc-spinner', 'pulse', 'breathe', 'bounce', 'wiggle']);
    expect(options.find(option => option.value === 'breathe')?.note).toBe('iOS 17 plays Pulse');
    expect(options.find(option => option.value === 'wiggle')?.note).toBe('iOS 17 plays Bounce');
    expect(options.find(option => option.value === 'pulse')?.note).toBeUndefined();
  });
});

describe('the colour layer is cosmetic', () => {
  const rejected = (document: any) => {
    try { compileCompositionDocument(document); } catch (error: any) { return error.issues[0]; }
    throw new Error('accepted');
  };
  const withRule = (index: number, patch: object) => {
    const document = structuredClone(accepted('authored-vacuum').document);
    const rules = document.stateStyles.styles[0].rules;
    rules[index] = { ...rules[index], ...patch };
    return document;
  };
  const withOverride = (override: object) => {
    const document = structuredClone(accepted('authored-vacuum').document);
    document.pages[2].components[0].binding.overrides = [override];
    return document;
  };
  const rulePointer = (index: number) => `/document/stateStyles/styles/0/rules/${index}/colour`;
  it('lists two tokens and allows them on resting and in-progress only', () => {
    expect(stateColours).toEqual(['unlit', 'lit']);
    expect(['resting', 'in-progress', 'warning', 'error', 'unknown'].filter(item => colourAllowed(item as never))).toEqual(['resting', 'in-progress']);
  });
  it('rejects a rule colour on a warning, error or unknown rule at /colour', () => {
    expect(rejected(withRule(3, { colour: 'lit' }))).toMatchObject({ code: 'invalid_combination', pointer: rulePointer(3) });
    expect(rejected(withRule(0, { class: 'error', colour: 'unlit' }))).toMatchObject({ code: 'invalid_combination', pointer: rulePointer(0) });
    expect(rejected(withRule(4, { colour: 'lit' }))).toMatchObject({ code: 'invalid_combination', pointer: rulePointer(4) });
  });
  it('rejects an override colour on a warning, error or unknown state at /colour', () => {
    const pointer = (index: number) => `/document/pages/2/components/0/binding/overrides/${index}/colour`;
    expect(rejected(withOverride({ state: 'paused', colour: 'lit' }))).toMatchObject({ code: 'invalid_combination', pointer: pointer(0) });
    expect(rejected(withOverride({ state: 'unavailable', colour: 'unlit' }))).toMatchObject({ code: 'invalid_combination', pointer: pointer(0) });
    const error = withRule(3, { class: 'error' });
    delete error.stateStyles.styles[0].rules[3].colour;
    error.pages[2].components[0].binding.overrides = [{ state: 'paused', colour: 'lit' }];
    expect(rejected(error)).toMatchObject({ code: 'invalid_combination', pointer: pointer(0) });
  });
  it('rejects a class name as a token', () => {
    expect(rejected(withRule(1, { colour: 'warning' })).pointer).toBe(rulePointer(1));
  });
});

describe('the style library', () => {
  it('lists the built-ins read-only and counts the tiles a saved style is used by', () => {
    const entries = libraryEntries(document());
    expect(entries.slice(0, 8).every(entry => entry.builtIn)).toBe(true);
    expect(entries.at(-1)).toMatchObject({ builtIn: false, usedBy: 1 });
    expect(usedByText(1)).toBe('Used by 1 tile');
    expect(usedByText(3)).toBe('Used by 3 tiles');
    expect(editWarning(2)).toBe('This changes 2 tiles.');
    expect(editWarning(0)).toBeUndefined();
  });
  it('blocks delete while a tile uses the style, and for a built-in', () => {
    const value = document();
    expect(usedBy(value, 'tidy-vacuum')).toBe(1);
    expect(deleteBlock(value, 'tidy-vacuum')).toMatch(/Used by 1 tile/);
    expect(() => deleteStyle(value, 'tidy-vacuum')).toThrow(/Used by 1 tile/);
    expect(deleteBlock(value, 'robot')).toMatch(/read-only/);
    value.pages[2].components = [];
    expect(deleteBlock(value, 'tidy-vacuum')).toBeUndefined();
    expect(deleteStyle(value, 'tidy-vacuum').styles).toEqual([]);
  });
  it('duplicates a built-in into a saved style that remembers its base, then renames it', () => {
    const { library, id } = duplicateStyle(undefined, builtInStyles[4]);
    expect(library.styles[0]).toMatchObject({ id, name: 'Robot copy', base: 'robot', domain: 'vacuum' });
    expect(renameStyle(library, id, 'Mine').styles[0].name).toBe('Mine');
    const again = duplicateStyle(library, library.styles[0]);
    expect(again.library.styles).toHaveLength(2);
    expect(again.library.styles[1].base).toBe('robot');
  });
  it('sets and resets overrides one layer at a time, keeping the link to the style', () => {
    let binding = stateTiles(document())[0].binding;
    binding = setOverride(binding, 'docked', 'text', 'Parked');
    binding = setOverride(binding, 'docked', 'colour', 'lit');
    expect(overriddenLayers(binding, 'docked')).toEqual(['text', 'colour']);
    binding = resetOverride(binding, 'docked', 'text');
    expect(overriddenLayers(binding, 'docked')).toEqual(['colour']);
    binding = resetOverride(binding, 'docked');
    expect(overriddenLayers(binding, 'docked')).toEqual([]);
    expect(binding.styleId).toBe('tidy-vacuum');
  });
  it('saves a tile\'s style plus its overrides as a new style and points the tile at it', () => {
    const value = document();
    const result = saveAsNewStyle(value, stateTiles(value)[0].binding, 'Evening vacuum')!;
    expect(result.library.styles).toHaveLength(2);
    expect(result.binding.overrides).toBeUndefined();
    expect(result.binding.styleId).toBe(result.library.styles[1].id);
    const saved = result.library.styles[1];
    expect(ruleFor(saved, 'cleaning')).toMatchObject({ text: 'Vacuuming', indicator: 'pulse' });
    // `docked` shared a rule with `idle`; an override of one of them splits it off.
    const split = saveAsNewStyle({ stateStyles: undefined }, { entityId: 'vacuum.demo_robot', builtIn: 'robot', overrides: [{ state: 'idle', text: 'Resting' }] }, 'Split')!;
    const style = split.library.styles[0];
    expect(ruleFor(style, 'idle')).toMatchObject({ text: 'Resting', states: ['idle'] });
    expect((ruleFor(style, 'docked') as { states: string[] }).states).toEqual(['docked']);
  });
  it('resolves a tile\'s style, falling back to its built-in style', () => {
    const library = document().stateStyles as StateStyleLibrary;
    expect(resolveTileStyle({ entityId: 'vacuum.demo_a', styleId: 'tidy-vacuum', builtIn: 'robot' }, library)?.id).toBe('tidy-vacuum');
    expect(resolveTileStyle({ entityId: 'vacuum.demo_a', styleId: 'gone', builtIn: 'robot' }, library)?.id).toBe('robot');
    expect(resolveTileStyle({ entityId: 'vacuum.demo_a', styleId: 'gone' }, library)).toBeUndefined();
  });
});

describe('filling a state map from an entity', () => {
  it('classes each Home Assistant state, lists history-only states as unclassified and ends with a fallback', () => {
    const draft = buildStateMap('alarm_control_panel.demo', [
      { state: 'disarmed', name: 'Disarmed' }, { state: 'pending', name: 'Pending' }, { state: 'triggered', name: 'Alarm' },
    ], ['armed_unusual']);
    expect(draft.rules.find(rule => rule.states[0] === 'pending')).toMatchObject({ class: 'warning', active: true });
    expect(draft.rules.find(rule => rule.states[0] === 'triggered')).toMatchObject({ class: 'error', text: 'Alarm' });
    expect(draft.unclassified).toEqual(['armed_unusual']);
    expect(draft.rules.at(-1)).toMatchObject({ states: ['unavailable', 'unknown'], class: 'unknown' });
    expect(draft.fallback).toEqual({ class: 'unknown', active: false });
  });
  it('ends an open-ended state with a resting fallback', () => {
    expect(buildStateMap('sensor.demo', [], [], undefined, true).fallback).toEqual({ class: 'resting', active: false });
  });
});

describe('adding a state tile', () => {
  it('suggests the built-in style by domain and device class and compiles', () => {
    const tile = newStateTile('cover.demo_garage', 'Garage', 'garage', undefined)!;
    expect(tile).toMatchObject({ type: 'state-tile', title: 'Garage', binding: { entityId: 'cover.demo_garage', builtIn: 'garage-door' } });
    expect(newStateTile('cover.demo_blind', 'Blind', undefined, undefined)!.binding.builtIn).toBe('blind');
    expect(newStateTile('binary_sensor.demo_battery', 'Battery', 'battery', undefined)!.binding.builtIn).toBe('notice');
    const next = addStateTile(document(), document().pages[0].id, tile);
    expect(next.pages[0].components.at(-1)).toBe(tile);
    expect(stateTiles(next)).toContain(tile);
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });
  it('falls back to a saved style of the domain, else makes no tile', () => {
    expect(newStateTile('sensor.demo_level', 'Level', undefined, undefined)).toBeUndefined();
    const library: StateStyleLibrary = { type: 'state-styles@1', styles: [{ ...builtInStyles[0], id: 'player', name: 'Player', domain: 'media_player' }] };
    expect(newStateTile('media_player.demo', 'Demo', undefined, library)!.binding).toEqual({ entityId: 'media_player.demo', styleId: 'player' });
  });
  it('leaves the document alone for an unknown page', () => {
    const tile = newStateTile('lock.demo_front', 'Front', undefined, undefined)!;
    expect(addStateTile(document(), 'no-such-page', tile)).toEqual(document());
  });
});

describe('ruleFor for an unavailable or unknown entity', () => {
  it('makes an unlit, untappable unknown rule when the map names none, and never uses the fallback', () => {
    const rules = [{ states: ['on'], class: 'resting' as const, active: true, action: { verb: 'Turn off', icon: 'power', service: 'turn_off' } }];
    const fallback = { class: 'resting' as const, active: true, text: 'Authored' };
    for (const state of ['unavailable', 'unknown']) {
      expect(ruleFor({ rules, fallback }, state)).toMatchObject({ class: 'unknown', active: false, action: { verb: 'Turn off', tappable: false } });
    }
    expect(ruleFor({ rules, fallback }, 'jammed')).toBe(fallback);
  });
  it('gives a map with no action an unknown rule with none', () => {
    const rule = ruleFor({ rules: [{ states: ['on'], class: 'resting', active: true }], fallback: { class: 'resting', active: true } }, 'unavailable');
    expect(rule.action).toBeUndefined();
    expect(rule.class).toBe('unknown');
  });
});
