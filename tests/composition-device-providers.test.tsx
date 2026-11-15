// @vitest-environment jsdom
import fixtureJSON from './fixtures/device-providers.json';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { compositionPublicationSchema } from '../src/shared/composition/schema';
import { deviceProviderSourceSchema, deviceProviderIssues } from '../src/shared/composition/device-providers';
import { remoteControlIssues, remoteControlSchema } from '../src/shared/composition/remote';
import { compositionEditorSchema, fieldVariants } from '../src/composition-editor';
import CompositionFields from '../src/CompositionFields';

afterEach(cleanup);
const fixture = () => compositionPublicationSchema.parse(structuredClone(fixtureJSON));

describe('authored device provider assemblies', () => {
  it('exposes canonical wake summary copy only through a negotiated wake source', () => {
    const document = fixture().document;
    document.dataSources.push({ id: 'wake-source', kind: 'model', model: 'bedroom-provider@1',
      inputs: { providerId: 'wake', kind: 'wake-light' } });
    document.pages[0].components.push({ id: 'wake-summary', type: 'bedroom-control', title: 'Wake Status',
      layout: { span: 1 }, props: { control: 'wake-summary', sourceId: 'wake-source',
        label: 'Wake Status', unavailableText: 'Setup unavailable' } });
    expect(compileCompositionDocument(document).capabilities).toContain('sh.wake-summary@1');
    const source = document.dataSources.at(-1);
    if (source?.kind !== 'model' || source.model !== 'bedroom-provider@1') throw new Error('fixture');
    source.inputs.kind = 'bed-side';
    expect(() => compileCompositionDocument(document)).toThrow();
  });

  it('only accepts resident-aware title and family on a device tile that renders them', () => {
    const tile = remoteControlSchema.parse({ kind: 'device', key: 'Demo PC', presentation: 'tile', family: 'power',
      icon: { type: 'sf-symbol', name: 'desktopcomputer', rendering: 'canonical', unavailable: 'reject' },
      states: [], fallbackText: 'Off', unavailableText: 'Unavailable',
      personalization: { residentId: 'demo-resident', ownTitle: 'Your PC', otherTitle: 'Demo PC' } });
    expect(remoteControlIssues(tile)).toEqual([]);
    if (tile.kind !== 'device') throw new Error('fixture');
    expect(remoteControlIssues({ ...tile, presentation: 'row' })).toEqual(['/personalization', '/family']);
  });
  it('agrees with the native fixture capability closure and includes complete editor fields', () => {
    const value = fixture();
    expect(compileCompositionDocument(value.document).capabilities).toEqual(value.capabilities);
    expect(value.document.pages[0].components.map(c => c.id)).toContain('times');
  });

  it('negotiates bounded configured speaker arguments, including conditional commands', () => {
    const command = (data: object) => ({ type: 'service', call: { domain: 'script', service: 'demo_mute', data }, optimistic: [] });
    const button = { label: 'Demo', icon: 'mdi:speaker', iconRotationDegrees: 0,
      action: { type: 'command', command: command({}) } };
    const source = deviceProviderSourceSchema.parse({ id: 'configured-remote', kind: 'model', model: 'media-remote-config@1', inputs: {
      id: 'demo', title: 'Demo', roomTitle: 'Room', remoteTitle: 'Remote', mediaEntityId: 'media_player.demo_unit',
      controlEntityId: 'remote.demo_unit', volumeTitle: 'Volume', volumeEntityId: 'media_player.demo_unit',
      showVolumeWhenOff: false, hideKeyboardWhenOff: false, appSectionTitle: 'Apps',
      optimisticEntityIds: [], liveChangeEntityIds: [], apps: [], devices: [], cards: [],
      ...Object.fromEntries(['power', 'up', 'left', 'select', 'right', 'down', 'back', 'home', 'pause', 'play', 'volumeDown', 'volumeUp']
        .map(key => [key, button])),
      volumeMute: { ...button, action: { type: 'state', entityId: 'media_player.demo_unit',
        cases: [{ states: ['playing'], command: command({ speakerdevice: ['media_player.demo_unit'] }) }], otherwise: command({}) } },
    } });
    const document = fixture().document;
    document.dataSources.push(source);
    expect(compileCompositionDocument(document).capabilities).toContain('sh.remote-speaker-targets@1');
    if (source.model !== 'media-remote-config@1' || source.inputs.volumeMute.action.type !== 'state') throw new Error('fixture');
    const call = source.inputs.volumeMute.action.cases[0].command;
    if (call.type !== 'service') throw new Error('fixture');
    for (const data of [{ speakerdevice: 'media_player.demo_unit' },
      { speakerdevice: Array(17).fill('media_player.demo_unit') }, { password: 'not-accepted' }]) {
      expect(() => compileCompositionDocument({ ...document, dataSources: [...document.dataSources.slice(0, -1),
        { ...source, inputs: { ...source.inputs, volumeMute: { ...button, action: { type: 'command', command: command(data) } } } }] }))
        .toThrow();
    }
    call.call.data = { sonosdevice: ['media_player.demo_unit'] };
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.remote-speaker-targets@1');
  });

  it('rejects unknown fields, wrong member targets and out-of-range program indices', () => {
    const value = fixture();
    const light = value.document.dataSources[0];
    expect(deviceProviderSourceSchema.safeParse({ ...light, credentials: 'not-accepted' }).success).toBe(false);
    const brightness = value.document.pages[0].components[2];
    if (brightness.type !== 'custom-light-control' || brightness.props.kind !== 'brightness') throw new Error('fixture');
    brightness.props.entityId = 'light.demo_unlisted';
    expect(() => compileCompositionDocument(value.document)).toThrow();
    const next = fixture();
    const days = next.document.pages[0].components[10];
    if (days.type !== 'sprinkler-control' || days.props.kind !== 'days') throw new Error('fixture');
    days.props.zone = 1;
    expect(() => compileCompositionDocument(next.document)).toThrow();
  });

  it('requires exact clocks and disallows duplicate palette and member identities', () => {
    const value = fixture();
    const source = deviceProviderSourceSchema.parse(value.document.dataSources[1]);
    if (source.model !== 'sprinkler-controller@1') throw new Error('fixture');
    expect(deviceProviderSourceSchema.safeParse({ ...source, inputs: { ...source.inputs, defaultStartTime: '07:00:30' } }).success).toBe(false);
    const lights = deviceProviderSourceSchema.parse(value.document.dataSources[0]);
    if (lights.model !== 'custom-lights@1') throw new Error('fixture');
    lights.inputs.lights.push(lights.inputs.lights[0]);
    const errors = deviceProviderIssues(lights);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('authors provider parameters through structured fields', () => {
    const document = fixture().document;
    const sources = compositionEditorSchema.properties?.dataSources;
    const schema = sources?.items;
    if (!schema || Array.isArray(schema)) throw new Error('source schema');
    const variant = fieldVariants(schema).find(v => v.properties?.model?.const === 'sprinkler-controller@1');
    expect(variant).toBeDefined();
    let updated = document;
    render(<CompositionFields schema={variant!} value={document.dataSources[1]} document={document}
      path={['dataSources', 1]} label="Sprinkler" onChange={next => { updated = next; }}
      onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Default Start Time'), { target: { value: '08:30' } });
    expect(updated.dataSources[1]).toMatchObject({ inputs: { defaultStartTime: '08:30' } });
    expect(() => compileCompositionDocument(updated)).not.toThrow();
  });
});
