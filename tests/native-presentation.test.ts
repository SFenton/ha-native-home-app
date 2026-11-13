import { describe, expect, it } from 'vitest';
import { nativeLocalTabStyle, nativeModalSubtitle, nativePresentationVisible, nativeRemoteEnabled, nativeVacuumPolicy, nativeVacuumTabs } from '../src/shared/native-presentation';
import type { Component, Json } from '../src/shared/types';

const node = (props: Record<string, Json>, children?: Component[]): Component =>
  ({ id: 'component', type: children ? 'section' : 'action-tile', title: 'Robot', props, children });
const states = (state: string, dock = 'idle'): Json => [
  { entityId: 'vacuum.robot', state, batteryLevel: 42 }, { entityId: 'sensor.dock', state: dock },
  { entityId: 'media_player.tv', state }, { entityId: 'sensor.battery', state: '73' },
];

describe('finite native presentation policy', () => {
  it('shows all configured guests as one group when any member is on', () => {
    const group = node({ presentation: 'guest-group' }, [node({ entityId: 'input_boolean.one' }), node({ entityId: 'input_boolean.two' })]);
    expect(nativePresentationVisible(group, [{ entityId: 'input_boolean.one', state: 'off' }, { entityId: 'input_boolean.two', state: 'on' }])).toBe(true);
    expect(group.children).toHaveLength(2);
    expect(nativePresentationVisible(group, [{ entityId: 'input_boolean.one', state: 'off' }])).toBe(false);
    expect(nativePresentationVisible(group, [])).toBe(false);
  });
  it('selects only the first matching remote case or its otherwise branch', () => {
    const branches = [
      node({ stateEntityId: 'media_player.tv', matchStates: ['off', 'paused'], excludedStates: [] }),
      node({ stateEntityId: 'media_player.tv', matchStates: ['paused', 'playing'], excludedStates: ['off', 'paused'] }),
      node({ stateEntityId: 'media_player.tv', alternateForStates: ['off', 'paused', 'playing'] }),
    ];
    for (const [state, expected] of [['off', 0], ['paused', 0], ['playing', 1], ['idle', 2]] as const) {
      expect(branches.map(branch => nativePresentationVisible(branch, states(state)))).toEqual(branches.map((_, index) => index === expected));
    }
    for (const state of ['unavailable', 'unknown']) expect(branches.some(branch => nativePresentationVisible(branch, states(state)))).toBe(false);
  });
  it('allows power while off but blocks navigation and all unavailable keys', () => {
    const power = node({ remoteMediaEntityId: 'media_player.tv', remoteKey: 'power' });
    const up = node({ remoteMediaEntityId: 'media_player.tv', remoteKey: 'up' });
    expect(nativeRemoteEnabled(power, states('off'))).toBe(true);
    expect(nativeRemoteEnabled(up, states('off'))).toBe(false);
    expect(nativeRemoteEnabled(up, states('playing'))).toBe(true);
    expect(nativeRemoteEnabled(power, states('unavailable'))).toBe(false);
  });
  it('computes vacuum tabs from known state and configured content, without pretending unknown error policy exists', () => {
    const vacuum = node({ entityId: 'vacuum.robot', dockStatusEntityId: 'sensor.dock', presentation: 'vacuum-sheet', batteryEntityId: 'sensor.battery' },
      ['controls', 'zones', 'autoClean', 'more', 'info'].map(vacuumTab => node({ vacuumTab }, [node({})])));
    const ids = (state: string, dock?: string) => nativeVacuumTabs(vacuum, states(state, dock)).map(tab => tab.props.vacuumTab);
    expect(ids('docked')).toEqual(['controls', 'zones', 'autoClean', 'more', 'info']);
    expect(ids('cleaning')).toEqual(['controls', 'autoClean', 'info']);
    expect(ids('cleaning', 'drying')).toEqual(['controls', 'autoClean', 'more', 'info']);
    expect(nativeVacuumPolicy(vacuum, states('error')).full).toBe(false);
    expect(nativeVacuumPolicy(vacuum, states('unavailable')).available).toBe(false);
    expect(nativeModalSubtitle(vacuum, states('docked'))).toBe('Docked \u00b7 73%');
  });
  it('uses the accessibility menu before compact symbol policy', () => {
    expect(nativeLocalTabStyle(390, true, true)).toBe('menu');
    expect(nativeLocalTabStyle(390, false, true)).toBe('icons');
    expect(nativeLocalTabStyle(700, false, true)).toBe('labels');
    expect(nativeLocalTabStyle(390, false, false)).toBe('labels');
  });
  it('does not present a media input source as an application name', () => {
    const remote = node({ nativeKind: 'remote-sheet', entityId: 'media_player.tv' });
    expect(nativeModalSubtitle(remote, [{ entityId: 'media_player.tv', state: 'playing', source: 'HDMI 1' }])).toBe('Playing');
    expect(nativeModalSubtitle(remote, [{ entityId: 'media_player.tv', state: 'playing', appName: 'Example App' }])).toBe('Example App \u00b7 Playing');
    expect(nativeModalSubtitle(remote, [{ entityId: 'media_player.tv', state: 'off', appName: 'Example App' }])).toBe('Off');
  });
});
