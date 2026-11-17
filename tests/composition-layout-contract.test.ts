import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { corpusCaseFile } from './corpusCase';
import { layoutCases, layoutFamilies } from '../scripts/layout-corpus';

const directory = path.resolve(__dirname, '../contract/corpus');
const readCase = (name: string) => readFileSync(corpusCaseFile(directory, name));
const read = (file: string) => readFileSync(path.join(directory, file));
const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: { code: string; pointer: string }; issue: { code: string; capability?: string } }[] } = JSON.parse(read('index.json').toString('utf8'));
const layout = index.cases.filter(item => new RegExp(`^(accept|reject)/(pending-)?(${layoutFamilies.join('|')})-`).test(item.file));
const shipped: string[] = JSON.parse(read('capabilities.json').toString('utf8'));
const NEW = ['sh.overlay@1', 'sh.tab-bar@1', 'sh.tab-blocks@1', 'sh.tile-parts@1'];

const envelopeOf = (name: string) => JSON.parse(readCase(name).toString('utf8'));
const compileCaps = (name: string) => compileCompositionDocument(envelopeOf(name).document).capabilities;

describe('layout contract: tab areas, tab bar, overlay and tile parts', () => {
  it('lists the four new ids as shipped, none of them as pending, and the pending set sorted', () => {
    for (const id of NEW) { expect(pendingCompositionCapabilities).not.toContain(id); expect(shipped).toContain(id); }
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
  it('has every case of the generator in the index, none held back by a pending capability, and a reject gives the Studio\'s own issue', () => {
    expect(layout.length).toBe(layoutCases.length);
    for (const item of layout) {
      expect(item.pending).toBeUndefined();
      expect(item.file.startsWith('accept/') ? 'accept' : 'reject').toBe(item.outcome);
      if (item.outcome === 'reject') expect(item.issue.code).not.toBe('unsupported_capability');
    }
  });
  it.each(layoutCases.map(item => [item.name, item] as const))('%s gives its hand-written answer', (name, item) => {
    const bytes = readCase(name);
    if (!item.reject) { expect(() => decodeCompositionPublication(bytes)).not.toThrow(); return; }
    let issue: { code: string; pointer: string } | undefined;
    try { decodeCompositionPublication(bytes); } catch (error) { issue = (error as { issues: { code: string; pointer: string }[] }).issues[0]; }
    expect(issue).toMatchObject(item.expect!);
  });
  it('needs each capability only when its part is present', () => {
    const plain = compileCaps('pending-tab-blocks-all-tabs');
    expect(plain).toContain('sh.tab-blocks@1');
    expect(plain).not.toContain('sh.tab-bar@1');
    expect(plain).not.toContain('sh.overlay@1');
    expect(compileCaps('pending-tab-bar-top-titles')).toContain('sh.tab-bar@1');
    expect(compileCaps('pending-tab-bar-top-titles')).not.toContain('sh.tab-blocks@1');
    // The shipped bottom bar (`pinned` alone) is not a tab bar setting.
    expect(compileCaps('pending-tab-bar-bottom-by-size')).toContain('sh.tab-bar@1');
    expect(compileCaps('pending-tile-parts-destination')).toContain('sh.tile-parts@1');
    expect(compileCaps('pending-tile-parts-destination')).not.toContain('sh.overlay@1');
    expect(compileCaps('pending-overlay-center')).toContain('sh.overlay@1');
    expect(compileCaps('pending-tab-blocks-tab-visible-when')).toContain('sh.tab-blocks@1');
  });
  it('needs sh.rules@1 for a conditional readout tone and nothing else of the six', () => {
    expect(compileCaps('pending-readout-tone-conditional')).toContain('sh.rules@1');
  });
  it('a tab container written the shipped way needs none of the new ids', () => {
    const shippedWay = JSON.parse(read('accept/family-pinned-tabs.json').toString('utf8'));
    for (const id of NEW) expect(shippedWay.capabilities).not.toContain(id);
  });
  it('refuses a layout case whose capability the manifest leaves out', () => {
    const envelope = envelopeOf('pending-overlay-center');
    envelope.capabilities = envelope.capabilities.filter((id: string) => id !== 'sh.overlay@1');
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(envelope))); expect.unreachable(); }
    catch (error) { expect((error as { issues: { code: string }[] }).issues[0].code).toBe('capability_manifest_mismatch'); }
  });
  it('keeps an old document valid: layout.span is optional and an explicit span still parses', () => {
    const envelope = envelopeOf('pending-overlay-center');
    const node = envelope.document.pages[2].components[0].children[0];
    delete node.layout.span;
    expect(() => compileCompositionDocument(envelope.document)).not.toThrow();
    node.layout.span = 1;
    expect(() => compileCompositionDocument(envelope.document)).not.toThrow();
    node.layout.span = 2;
    expect(() => compileCompositionDocument(envelope.document)).toThrow();
  });
});
