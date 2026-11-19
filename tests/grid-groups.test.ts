import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { arrange, defaultGroups, groupIndexOf, groupProblems, type GridGroups } from '../src/shared/composition/grid-groups';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

const corpus = path.resolve(import.meta.dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: { code: string; pointer: string }; issue?: { code: string; pointer: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const ours = index.cases.filter(item => /^(accept|reject)\/(pending-)?grid-groups-/.test(item.file));
/** A refusal is a case with a Studio issue (a pending one) or a plain reject, whose own issue is the Studio's; with the ink id held back by its gate the manifest case is the second kind. */
const refused = ours.filter(item => item.studioIssue || (item.outcome === 'reject' && !item.pending)).map(item => ({ ...item, studioIssue: item.studioIssue ?? item.issue }));
const bytes = (file: string) => readFileSync(path.join(corpus, file));
const envelope = (file: string) => JSON.parse(bytes(file).toString('utf8'));

describe('sh.grid-state-groups@1 corpus', () => {
  it('is shipped and sorted, with the accept and refuse cases of the design, each refusal with an expect', () => {
    expect(pendingCompositionCapabilities).not.toContain('sh.grid-state-groups@1');
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
    expect(ours.length - refused.length).toBe(6);
    expect(refused.length).toBe(15);
    for (const item of refused) expect(item.studioIssue).toMatchObject({ code: expect.any(String), pointer: expect.any(String) });
  });
  it.each(ours.filter(item => item.outcome === 'accept'))('compiles $file', item => {
    const document = envelope(item.file);
    expect(() => decodeCompositionPublication(bytes(item.file))).not.toThrow();
    expect(compileCompositionDocument(document.document).capabilities).toEqual(document.capabilities);
  });
  it.each(refused)('refuses $file with its own code at its own pointer', item => {
    let first: { code: string; pointer: string } | undefined;
    try { decodeCompositionPublication(bytes(item.file)); } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      first = error.issues[0];
    }
    expect({ code: first?.code, pointer: first?.pointer }).toEqual({ code: item.studioIssue!.code, pointer: item.studioIssue!.pointer });
  });
  it('declares the id exactly when a grid has groups', () => {
    const grouped = envelope('accept/grid-groups-two-groups.json');
    expect(grouped.capabilities).toContain('sh.grid-state-groups@1');
    expect(envelope('accept/grid-groups-without-groups-needs-no-id.json').capabilities).not.toContain('sh.grid-state-groups@1');
    const plain = envelope('accept/grid-groups-without-groups-needs-no-id.json');
    delete grouped.document.pages[2].components[0].props.groups;
    expect(JSON.stringify(grouped.document)).toBe(JSON.stringify(plain.document));
    expect(legacyManifest(compileCompositionDocument(plain.document).capabilities)).not.toContain('sh.grid-state-groups@1');
  });
});

describe('group arithmetic', () => {
  const two = defaultGroups();
  it('has the production preset: On holding On, then Off holding Off and Unavailable', () => {
    expect(two.items.map(item => [item.title, item.states])).toEqual([['On', ['active']], ['Off', ['idle', 'unavailable']]]);
    expect(groupProblems(two)).toEqual([]);
  });
  it('finds a state held twice, a state missing and a reused id', () => {
    const bad = { by: 'state', items: [{ id: 'a', title: 'A', states: ['active', 'idle'] }, { id: 'a', title: 'B', states: ['idle'] }] } as GridGroups;
    expect(groupProblems(bad)).toEqual([{ code: 'duplicate_id', at: '/items/1/id' }, { code: 'invalid_combination', at: '/items/1/states/0' }, { code: 'invalid_combination', at: '/items' }]);
  });
  it('puts each tile under the group of its state, keeps the grid order inside, and drops an empty group', () => {
    const tiles = [{ key: 'a', state: 'idle' as const, tile: 1 }, { key: 'b', state: 'active' as const, tile: 2 }, { key: 'c', state: 'unavailable' as const, tile: 3 }, { key: 'd', state: 'idle' as const, tile: 4 }];
    expect(arrange(two, tiles).map(bucket => [bucket.group.title, bucket.tiles.map(item => item.key)])).toEqual([['On', ['b']], ['Off', ['a', 'c', 'd']]]);
    expect(arrange(two, tiles.filter(item => item.state !== 'active')).map(bucket => bucket.group.title)).toEqual(['Off']);
    expect(arrange(two, [])).toEqual([]);
    expect(groupIndexOf(two, 'unavailable')).toBe(1);
  });
});
