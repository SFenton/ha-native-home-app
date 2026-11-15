import { describe, expect, it } from 'vitest';
import { remoteSlotCalls, serviceCallAllowed } from '../src/shared/composition/service-vocabulary';
import { deviceProviderIssues, deviceProviderSourceSchema } from '../src/shared/composition/device-providers';
import { validateCompositionPublication } from '../server/composition';
import accepted from '../contract/corpus/accept/device-media-remote-config.json';

describe('remote service call shape', () => {
  it.each([
    ['media_player', 'media_play', 'media_player.demo_tv', true],
    ['media_player', 'play_media', 'media_player.demo_tv', true],
    ['media_player', 'media_play', 'lock.demo_front_door', false],
    ['select', 'select_option', undefined, true],
    ['switch', 'toggle', 'switch.demo_tv', true],
    ['unknown_domain', 'anything', undefined, true],
    ['light', 'turn_on', 'switch.demo_lamp', false],
  ] as const)('%s.%s target %s is %s', (domain, service, target, allowed) => {
    expect(serviceCallAllowed({ domain, service, ...(target ? { target } : {}) })).toBe(allowed);
  });

  it('accepts any script by name but never a script with a target', () => {
    expect(serviceCallAllowed({ domain: 'script', service: 'demo' })).toBe(true);
    expect(serviceCallAllowed({ domain: 'script', service: 'anything_else' })).toBe(true);
    expect(serviceCallAllowed({ domain: 'script', service: 'demo', target: 'script.demo_unit' })).toBe(false);
  });

  it('walks every field of a remote, with the app field names and the card slot', () => {
    const source = deviceProviderSourceSchema.parse((accepted as { document: { dataSources: unknown[] } }).document.dataSources[0]);
    if (source.model !== 'media-remote-config@1') throw new Error('fixture');
    const groups = remoteSlotCalls(source.inputs);
    expect(groups.map(group => group.field)).toEqual([
      'power', 'up', 'left', 'select', 'right', 'down', 'back', 'home', 'keyboard', 'pause', 'play', 'volumeDown', 'volumeMute', 'volumeUp',
      'apps/0', 'apps/1', 'devices/0', 'devices/1', 'devices/2', 'cards/0/configuration']);
    expect(groups.find(group => group.field === 'volumeMute')?.calls).toHaveLength(2);
    expect(deviceProviderIssues(source)).toEqual([]);
  });

  it('reports each offending field once', () => {
    const source = structuredClone(deviceProviderSourceSchema.parse((accepted as { document: { dataSources: unknown[] } }).document.dataSources[0]));
    if (source.model !== 'media-remote-config@1') throw new Error('fixture');
    const bad = { type: 'service' as const, call: { domain: 'script' as const, service: 'demo', target: 'script.demo_unit', data: {} }, optimistic: [] };
    source.inputs.power.action = { type: 'command', command: bad };
    source.inputs.play.action = { type: 'state', cases: [{ states: [], command: bad }, { states: [], command: bad }], otherwise: bad };
    expect(deviceProviderIssues(source)).toEqual(['/power', '/play']);
  });

  it('publishes a remote that names a script no house declares', () => {
    const publication = structuredClone(accepted) as unknown as Parameters<typeof validateCompositionPublication>[0];
    expect(validateCompositionPublication(publication)).toBeTruthy();
  });
});
