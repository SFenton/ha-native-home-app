import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { importLegacyAliases, legacyAliases, legacyLinkPrefixes, updateRoute, words } from '../src/routes-editor';
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
    cameras: [{ entityId: 'camera.demo_unit', title: 'Entry', liveLabel: 'Live', unavailableLabel: 'Stream unavailable' }],
  };
  document.liveActivities = [{
    id: 'appearance', jobId: 'fan.demo_unit', type: 'activity-presentation@1', title: 'Authored Fan', glyph: 'fan', tint: 'air',
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

describe('routes as plain authored paths', () => {
  const withRoutes = () => {
    const value = document();
    const base = value.extensions!.routes[0];
    value.extensions!.routes = [
      { ...base, path: 'home', aliases: ['overview'], keywords: ['house'], siri: true },
      { ...base, id: 'climate', path: 'climate', aliases: ['thermostat'] },
    ];
    value.extensions!.linkPrefixes = ['my-dash'];
    return value;
  };
  const issue = (value: ReturnType<typeof document>) => {
    try { compileCompositionDocument(value); } catch (error) { return (error as { issues?: { code: string; pointer: string }[] }).issues?.[0]; }
    return undefined;
  };
  it('derives route-links only when a route link field is used', () => {
    expect(compileCompositionDocument(document()).capabilities).not.toContain('sh.route-links@1');
    expect(compileCompositionDocument(withRoutes()).capabilities).toContain('sh.route-links@1');
  });
  it('refuses an alias that is another route path or repeats across routes', () => {
    const asPath = withRoutes(); asPath.extensions!.routes[0].aliases = ['climate'];
    expect(issue(asPath)?.code).toBe('duplicate_id');
    const repeated = withRoutes(); repeated.extensions!.routes[1].aliases = ['overview'];
    expect(issue(repeated)?.code).toBe('duplicate_id');
  });
  it('bounds and shapes aliases, keywords, siri and link prefixes', () => {
    for (const mutate of [
      (v: ReturnType<typeof document>) => { v.extensions!.routes[0].aliases = Array.from({ length: 9 }, (_, i) => `a${i}`); },
      (v: ReturnType<typeof document>) => { v.extensions!.routes[0].aliases = ['Not A Path']; },
      (v: ReturnType<typeof document>) => { v.extensions!.routes[0].keywords = Array.from({ length: 13 }, (_, i) => `k${i}`); },
      (v: ReturnType<typeof document>) => { (v.extensions!.routes[0] as { siri: unknown }).siri = 'yes'; },
      (v: ReturnType<typeof document>) => { v.extensions!.linkPrefixes = []; },
    ]) {
      const value = withRoutes(); mutate(value);
      expect(() => compositionDocumentSchema.parse(value)).toThrow();
    }
  });
  it('allows only viewer rules on a route', () => {
    const value = withRoutes();
    value.extensions!.routes[0].visibleWhen = { type: 'viewer', isAdmin: true };
    expect(compileCompositionDocument(value).capabilities).toContain('sh.visible-when@1');
    value.extensions!.routes[0].visibleWhen = { type: 'viewer-person', in: ['home'] } as never;
    expect(issue(value)).toMatchObject({ code: 'invalid_combination' });
  });
  it('imports the legacy aliases once, skipping any another route already uses', () => {
    const value = document();
    const base = value.extensions!.routes[0];
    value.extensions!.routes = [{ ...base, path: 'home' }, { ...base, id: 'settings', path: 'settings' }];
    const first = importLegacyAliases(value.extensions!);
    expect(first.extensions.routes[0].aliases).toEqual([...legacyAliases.home]);
    expect(first.extensions.routes[1].aliases).toEqual([...legacyAliases.settings]);
    expect(first.extensions.linkPrefixes).toEqual([...legacyLinkPrefixes]);
    expect(first.skipped).toEqual([]);
    expect(importLegacyAliases(first.extensions).added).toEqual([]);
    expect(compileCompositionDocument({ ...value, extensions: first.extensions }).capabilities).toContain('sh.route-links@1');
    const taken = { ...value.extensions!, routes: [{ ...base, path: 'home' }, { ...base, id: 'x', path: 'overview' }] };
    expect(importLegacyAliases(taken).skipped).toEqual(['overview']);
  });
  it('edits words and drops emptied optional fields', () => {
    expect(words(' a, b\n,a ,, c ')).toEqual(['a', 'b', 'c']);
    const value = withRoutes();
    const next = updateRoute(value.extensions!, 0, { aliases: [], siri: false });
    expect(next.routes[0]).not.toHaveProperty('aliases');
    expect(next.routes[0]).not.toHaveProperty('siri');
    expect(next.routes[1]).toEqual(value.extensions!.routes[1]);
  });
});
