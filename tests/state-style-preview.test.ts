import { describe, expect, it } from 'vitest';
import { arcCrossFadeSeconds, defaultIndicator, previewTile, previewWidths, spokenValue } from '../src/shared/composition/state-style-preview';
import { builtInStyle, builtInStyles, type StateStyleDefinition } from '../src/shared/composition/state-styles';

const style = (id: string) => builtInStyle(id)!;

describe('state-style preview, resolved the way the app resolves', () => {
  it('draws every built-in state with a class, a face and words', () => {
    for (const built of builtInStyles) {
      for (const rule of built.rules) {
        for (const state of rule.states) {
          const tile = previewTile(built, state);
          expect(tile.stateClass, `${built.id}/${state}`).toBe(rule.class);
          expect(tile.text.length).toBeGreaterThan(0);
          expect(tile.discOpacity).toBe(tile.showsArc ? 0 : tile.stateClass === 'unknown' ? 0.5 : 1);
        }
      }
    }
  });
  it('draws the native Robot glyph per state, including unreadable and unlisted states', () => {
    const robot = style('robot');
    expect(previewTile(robot, 'docked', [], {}, 'fan').icon).toBe('house');
    for (const state of ['idle', 'cleaning', 'mowing', 'paused', 'returning', 'error', 'unavailable', 'unknown', 'demo_new_state', undefined]) {
      expect(previewTile(robot, state, [], {}, 'fan').icon, String(state)).toBe('robotic.vacuum');
    }
    expect(previewTile(robot, 'docked', [{ state: 'docked', icon: 'bolt' }]).icon).toBe('bolt');
  });
  it('shows the arc in the disc place for a state with no tappable action, and dims it for VoiceOver', () => {
    const returning = previewTile(style('robot'), 'returning');
    expect(returning).toMatchObject({ stateClass: 'in-progress', indicator: 'arc-spinner', showsArc: true, discOpacity: 0, acceptsTaps: false });
    expect(returning.voiceOver).toBe('Returning, in progress, dimmed');
    const locking = previewTile(style('lock'), 'locking');
    expect(locking).toMatchObject({ showsArc: true, verb: 'Unlock' });
  });
  it('keeps the disc, with no arc, for an in-progress state whose tap still works', () => {
    const arming = previewTile(style('alarm'), 'arming');
    expect(arming).toMatchObject({ stateClass: 'in-progress', indicator: 'none', showsArc: false, acceptsTaps: true });
    expect(arming.voiceOver).toBe('Arming, in progress');
  });
  it('plays the three warning defaults as a pulse', () => {
    for (const [id, state] of [['alarm', 'pending'], ['lock', 'open'], ['robot', 'paused']] as const) {
      const tile = previewTile(style(id), state);
      expect(tile.stateClass, `${id}/${state}`).toBe('warning');
      expect(tile.indicator).toBe('pulse');
      expect(tile.voiceOver).toContain('warning');
    }
  });
  it('defaults Error to a wiggle and an authored indicator wins', () => {
    expect(defaultIndicator('error', false)).toBe('wiggle');
    expect(previewTile(style('robot'), 'cleaning').indicator).toBe('breathe');
    expect(previewTile(style('detector'), 'on')).toMatchObject({ stateClass: 'error', indicator: 'wiggle' });
  });
  it('treats unavailable and unknown as the unknown class: dimmed disc, no taps, never an arc', () => {
    for (const state of ['unavailable', 'unknown', undefined]) {
      const tile = previewTile(style('switch'), state);
      expect(tile).toMatchObject({ stateClass: 'unknown', showsArc: false, discOpacity: 0.5, acceptsTaps: false });
    }
  });
  it('lets a request in flight and a failed request change the class from the same frame', () => {
    const flight = previewTile(style('switch'), 'on', [], { inFlight: true });
    expect(flight).toMatchObject({ stateClass: 'in-progress', indicator: 'arc-spinner', showsArc: true });
    expect(previewTile(style('switch'), 'on', [], { failed: true })).toMatchObject({ stateClass: 'error', indicator: 'wiggle' });
    expect(previewTile(style('lock'), 'locked', [], { inFlight: true })).toMatchObject({ showsArc: true, acceptsTaps: false });
  });
  it('applies a tile override layer by layer, and the colour token sets only the face', () => {
    const tile = previewTile(style('switch'), 'on', [{ state: 'on', text: 'Running', colour: 'lit', indicator: 'bounce', icon: 'bolt' }]);
    expect(tile).toMatchObject({ text: 'Running', indicator: 'bounce', stateClass: 'resting', colour: { class: 'resting', active: true } });
    expect(previewTile(style('switch'), 'on', [{ state: 'on', colour: 'unlit' }]).colour).toEqual({ class: 'resting', active: false });
  });
  it('draws the node icon when no layer gives a glyph, and a plain circle only without one', () => {
    const bare: StateStyleDefinition = { ...style('switch'), rules: [{ states: ['on'], class: 'resting', active: true }] };
    expect(previewTile(bare, 'on', [], {}, 'fan.fill').icon).toBe('fan.fill');
    expect(previewTile(bare, 'on').icon).toBe('circle');
    expect(previewTile(bare, 'on', [{ state: 'on', icon: 'bolt' }], {}, 'fan.fill').icon).toBe('bolt');
  });
  it('reads a state the map lacks through the fallback', () => {
    expect(previewTile(style('switch'), 'mystery')).toMatchObject({ stateClass: 'unknown', text: 'Mystery' });
  });
  it('does not repeat the class when the words already say it', () => {
    expect(spokenValue('Low battery warning', 'warning')).toBe('Low battery warning');
    expect(spokenValue('', 'error')).toBe('error');
  });
  it('shows the three widths and the 0.2 second cross-fade', () => {
    expect(previewWidths.map(item => item.id)).toEqual(['iphone', 'duo', 'ipad']);
    expect(arcCrossFadeSeconds).toBe(0.2);
  });
});

describe('state-style preview, a colour token is cosmetic', () => {
  it('keeps in-progress, the arc and the spoken class when lit is set on returning', () => {
    const tile = previewTile(builtInStyle('robot')!, 'returning', [{ state: 'returning', colour: 'lit' }]);
    expect(tile).toMatchObject({ stateClass: 'in-progress', showsArc: true, colour: { class: 'in-progress', active: true } });
    expect(tile.voiceOver).toBe('Returning, in progress, dimmed');
  });
  it('lets a request in flight or failed decide the class whatever the token says', () => {
    const lit = [{ state: 'locked', colour: 'lit' as const }];
    expect(previewTile(style('lock'), 'locked', lit, { inFlight: true })).toMatchObject({ stateClass: 'in-progress', colour: { class: 'in-progress', active: true } });
    const failed = previewTile(style('lock'), 'locked', lit, { failed: true });
    expect(failed).toMatchObject({ stateClass: 'error', colour: { class: 'error', active: false } });
    expect(failed.voiceOver).toBe('Locked, error');
  });
  it('never changes the spoken value', () => {
    for (const colour of ['lit', 'unlit'] as const) {
      expect(previewTile(style('switch'), 'on', [{ state: 'on', colour }]).voiceOver).toBe(previewTile(style('switch'), 'on').voiceOver);
    }
  });
});

describe('a style with no unknown rule, as the app synthesizes one', () => {
  const noUnknown = (): StateStyleDefinition => ({
    id: 'demo-fan', name: 'Demo fan', domain: 'fan',
    rules: [
      { states: ['on'], class: 'resting', active: true, icon: 'fan.fill', text: 'Running', action: { verb: 'Turn off', icon: 'power', service: 'turn_off' } },
      { states: ['off'], class: 'resting', active: false, action: { verb: 'Turn on', icon: 'power', service: 'turn_on' } },
    ],
    fallback: { class: 'resting', active: true, icon: 'fan.fill', text: 'Authored fallback', action: { verb: 'Turn off', icon: 'power', service: 'turn_off' } },
  });
  it('draws the node icon, "Unavailable", unlit and untappable, not the authored fallback', () => {
    for (const state of ['unavailable', 'unknown', undefined]) {
      const tile = previewTile(noUnknown(), state, [], {}, 'fan');
      expect(tile, String(state)).toMatchObject({ stateClass: 'unknown', icon: 'fan', active: false, acceptsTaps: false, discOpacity: 0.5 });
      expect(tile.colour).toEqual({ class: 'unknown', active: false });
      expect(tile.text).toBe(state === 'unknown' ? 'Unknown' : 'Unavailable');
    }
  });
  it('keeps an untappable copy of the first action for the disc, and the authored fallback for other states', () => {
    expect(previewTile(noUnknown(), 'unavailable', [], {}, 'fan')).toMatchObject({ verb: 'Turn off' });
    expect(previewTile(noUnknown(), 'jammed', [], {}, 'fan')).toMatchObject({ stateClass: 'resting', text: 'Authored fallback', acceptsTaps: true });
  });
  it('leaves a style that authors its unknown rule as it is', () => {
    const tile = previewTile(style('garage-door'), 'unavailable', [], {}, 'ignored');
    expect(tile.icon).toBe('door.garage.closed');
  });
});
