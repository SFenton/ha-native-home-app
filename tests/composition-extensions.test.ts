import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { compositionDocumentSchema, type CompositionPublication } from '../src/shared/composition/schema';

function document() {
  const { document } = JSON.parse(readFileSync(new URL('./fixtures/composition-first-slice.json', import.meta.url), 'utf8')) as CompositionPublication;
  document.extensions = {
    type: 'native-extensions@1', watch: 'stub@1',
    routes: [{
      id: 'authored-home', path: 'home', pageId: document.pages[0].id,
      title: 'Home', summary: 'Your house', icon: 'house.fill', tabId: document.navigation.tabs[0].id,
      anchors: [{ fragment: 'details', modalId: document.modals[0].id }],
    }],
    cameras: [{ entityId: 'camera.demo', title: 'Entry', liveLabel: 'Live', unavailableLabel: 'Stream unavailable' }],
  };
  document.liveActivities = [{
    id: 'appearance', jobId: 'fan.demo', type: 'activity-presentation@1', title: 'Authored Fan', glyph: 'fan', tint: 'air',
    source: 'activity-engine@1', privacy: 'system-sensitive@1', updates: 'engine@1', intents: 'engine-safe@1',
  }];
  return document;
}

describe('delivered extension contract', () => {
  it('derives only implemented capabilities and retains explicit tab/modal attachments', () => {
    const value = document();
    value.liveActivities[0].tint = 'cooling';
    expect(compositionDocumentSchema.parse(value)).toEqual(value);
    expect(compileCompositionDocument(value).capabilities).toEqual(expect.arrayContaining([
      'sh.activity-presentation@1', 'sh.native-extensions@1',
    ]));
  });
  it('can preserve canonical permission copy without adding duplicate explanations', () => {
    const value = document();
    value.bootstrap = {
      type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
      recovery: { loadingTitle: 'Getting Your Layout', unavailableTitle: 'Layout Unavailable',
        unavailableMessage: 'Try again when connected.', retryLabel: 'Try Again' },
      setup: [{ permission: 'notifications' }, { permission: 'time-sensitive' }, { permission: 'location' }],
    };
    expect(compileCompositionDocument(value).capabilities).toContain('sh.bootstrap-policy@1');
  });
  it('rejects unknown pages, tabs, modal anchors and duplicate destinations or jobs', () => {
    const mutations = [
      (value: ReturnType<typeof document>) => { value.extensions!.routes[0].pageId = 'missing'; },
      (value: ReturnType<typeof document>) => { value.extensions!.routes[0].tabId = 'missing'; },
      (value: ReturnType<typeof document>) => { value.extensions!.routes[0].anchors![0].modalId = 'missing'; },
      (value: ReturnType<typeof document>) => { value.extensions!.routes.push({ ...value.extensions!.routes[0], id: 'other' }); },
      (value: ReturnType<typeof document>) => { value.extensions!.routes[0].anchors!.push(value.extensions!.routes[0].anchors![0]); },
      (value: ReturnType<typeof document>) => { value.extensions!.cameras.push(value.extensions!.cameras[0]); },
      (value: ReturnType<typeof document>) => { value.liveActivities.push({ ...value.liveActivities[0], id: 'other' }); },
    ];
    for (const mutate of mutations) {
      const value = document();
      mutate(value);
      expect(() => compileCompositionDocument(value)).toThrow();
    }
  });
  it('does not author commands, camera retargeting URLs, Watch features or unsafe text', () => {
    for (const update of [
      { watch: 'dashboard@1' },
      { credential: 'not-allowed' },
      { cameras: [{ ...document().extensions!.cameras[0], action: 'unlock' }] },
      { cameras: [{ ...document().extensions!.cameras[0], entityId: 'https://example.test/image' }] },
      { cameras: [{ ...document().extensions!.cameras[0], title: 'Entry\nHidden' }] },
    ]) {
      const value = document();
      expect(() => compositionDocumentSchema.parse({ ...value, extensions: { ...value.extensions, ...update } })).toThrow();
    }
  });
  it('enforces the native extension byte budget before publication', () => {
    const value = document();
    value.extensions!.routes = Array.from({ length: 64 }, (_, index) => ({
      ...value.extensions!.routes[0], id: `route-${index}`, path: `route-${index}`,
      title: 'a'.repeat(80), summary: 'b'.repeat(240), icon: 'c'.repeat(80),
    }));
    expect(new TextEncoder().encode(JSON.stringify(value.extensions)).length).toBeGreaterThan(32_768);
    expect(() => compileCompositionDocument(value)).toThrow();
  });
});
