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

  it('rejects unknown fields, wrong member targets and out-of-range program indices', () => {
    const value = fixture();
    const light = value.document.dataSources[0];
    expect(deviceProviderSourceSchema.safeParse({ ...light, credentials: 'not-accepted' }).success).toBe(false);
    const brightness = value.document.pages[0].components[2];
    if (brightness.type !== 'custom-light-control' || brightness.props.kind !== 'brightness') throw new Error('fixture');
    brightness.props.entityId = 'light.unlisted';
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
