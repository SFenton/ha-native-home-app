import { describe, expect, it } from 'vitest';
import { applyDebt, decodeEscapes, entityIsAllowed, loadAllowlist, scanText, scanTree } from '../scripts/house-scan';

// Shapes are assembled from parts so this file never holds a literal the scan would flag.
const domain = 'light';
const rules = (path: string, text: string) => scanText(path, text).map(hit => hit.rule);

describe('house-data scan', () => {
  it('flags an entity id in a string and in prose, never one with the demo prefix', () => {
    expect(rules('a.ts', `const id = '${domain}.kitchen';`)).toEqual(['entity']);
    expect(rules('a.md', `Turn on ${domain}.kitchen now.`)).toEqual(['entity']);
    expect(rules('a.json', `{"entityId":"${domain}.demo_kitchen"}`)).toEqual([]);
    expect(rules('a.ts', `const id = '${domain}.fixture_kitchen';`)).toEqual([]);
  });
  it('reads code only inside strings and comments, so property access is not an id', () => {
    expect(rules('a.ts', `const a = ${domain}.kitchen + counter.values();`)).toEqual([]);
    expect(rules('a.ts', `const a = 1; // see ${domain}.kitchen`)).toEqual(['entity']);
    expect(rules('a.ts', `const a = \`${domain}.\${key}\`;`)).toEqual([]);
  });
  it('allows service names and symbol names', () => {
    expect(entityIsAllowed('turn_on')).toBe(true);
    expect(entityIsAllowed('fill')).toBe(true);
    expect(entityIsAllowed('shield', 'lock')).toBe(true); // the SF Symbol lock.shield
    expect(entityIsAllowed('set_cover_position', 'cover')).toBe(true); // a named service
    expect(entityIsAllowed('shield', 'media_player')).toBe(false); // the same word under another domain is a real id
    expect(entityIsAllowed('set_cover_position', 'light')).toBe(false);
    expect(entityIsAllowed('kitchen')).toBe(false);
  });
  it('flags private addresses, tailnet and local hosts, VINs and long hex strings', () => {
    expect(rules('a.md', `host ${['192', '168', '0', '9'].join('.')}`)).toEqual(['ipv4']);
    expect(rules('a.md', `host ${['100', '70', '1', '2'].join('.')}`)).toEqual(['ipv4']);
    expect(rules('a.md', `host box.tail1234.${'ts'}.net`)).toEqual(['tailnet']);
    expect(rules('a.md', `host kitchen-hub.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.md', 'host example.local')).toEqual([]);
    expect(rules('a.md', `vin ${'1HGCM8263'}${'3A004352'}`)).toEqual(['vin']);
    expect(rules('a.md', `token ${'0123456789abcdef'.repeat(2)}`)).toEqual(['hex']);
    expect(rules('a.md', `token ${'a'.repeat(40)}`)).toEqual([]);
  });
  it('passes the scanner false positives: property access, field keys, symbol names and CSS selectors', () => {
    expect(rules('a.ts', 'return overlay.local[stateId] ?? undefined;')).toEqual([]);
    expect(rules('a.md', 'the overlay.local[x] map')).toEqual([]);
    expect(rules('a.ts', "const k = { 'chrome-group.placement': 1 };")).toEqual([]);
    expect(rules('a.md', 'the chrome-group.horizontal field')).toEqual([]);
    expect(rules('a.ts', `const o = { ...overlay.${'local'}, a: 1 };`)).toEqual([]);
    expect(rules('a.ts', "const q = 'button.w2-card';")).toEqual([]);
    expect(rules('a.md', 'selector button.w2-card:hover')).toEqual([]);
  });
  it('still fails real house-looking values next to those shapes', () => {
    expect(rules('a.ts', `const h = 'kitchen-hub.${'local'}';`)).toEqual(['localhost']);
    expect(rules('a.ts', `const h = 'kitchen-hub.${'local'}[0]';`)).toEqual([]);
    expect(rules('a.sh', `curl http://hub-x.${'local'}:8123/api`)).toEqual(['localhost']);
    expect(rules('a.sh', `HOST=hub-x.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.sh', `HOST=kitchen.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.tsx', `<p>Open hub-x.${'local'} now</p>`)).toEqual(['localhost']);
    expect(rules('a.tsx', `<p>Open kitchen.${'local'} now</p>`)).toEqual(['localhost']);
    expect(rules('a.ts', `const t = \`\n  http://hub-x.${'local'}/api\n\`;`)).toEqual(['localhost']);
    expect(rules('a.ts', `  http://hub-x.${'local'}/api`)).toEqual(['localhost']);
    expect(rules('a.css', `.a { background: url(http://hub-x.${'local'}/i.png); }`)).toEqual(['localhost']);
    expect(rules('a.ts', `const x = kitchen-hub.${'local'};`)).toEqual(['localhost']);
    expect(rules('a.tsx', `<p>kitchen.${'local'}:8123</p>`)).toEqual(['localhost']);
    expect(rules('a.tsx', `<p>Open kitchen.${'local'}.</p>`)).toEqual(['localhost']);
    expect(rules('a.ts', `const t = \`\n  kitchen.${'local'}\n\`;`)).toEqual(['localhost']);
    expect(rules('a.ts', `  kitchen.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.ts', `/* see kitchen.${'local'} */`)).toEqual(['localhost']);
    expect(rules('a.ts', `/** @see kitchen.${'local'} */`)).toEqual(['localhost']);
    expect(rules('a.ts', ` * the hub is kitchen.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.ts', `expect(emptyOverlay.${'local'}).toEqual({});`)).toEqual(['localhost']);
    expect(rules('a.md', `the ${'media_player'}.${'shield'} box`)).toEqual(['entity']);
    expect(rules('a.ts', `// ping kitchen-hub.${'local'}`)).toEqual(['localhost']);
    expect(rules('a.md', `ping kitchen-hub.${'local'})`)).toEqual(['localhost']);
    expect(rules('a.ts', `const a = '${'lock'}.front_door';`)).toEqual(['entity']);
    expect(rules('a.ts', `const a = '${'button'}.doorbell';`)).toEqual(['entity']);
    expect(rules('a.md', `use chrome-group.x and ${'lock'}.front_door`)).toEqual(['entity']);
    expect(rules('a.md', `the (${domain}.kitchen) light`)).toEqual(['entity']);
  });
  it('reads an escaped dot as a dot', () => {
    expect(decodeEscapes('a\\u002eb &#46; c')).toBe('a.b . c');
    expect(rules('a.json', `"${domain}\\u002ekitchen"`)).toEqual(['entity']);
  });
  it('lets an allowlist tolerate an address, a hex path and a debt ceiling', () => {
    const address = ['172', '30', '32', '2'].join('.');
    const allow = { addresses: [address], hexPaths: ['docs/'], debt: { 'a.ts': 1 } };
    expect(scanText('a.md', `peer ${address}`, allow)).toEqual([]);
    expect(scanText('docs/a.md', `sha ${'0123456789abcdef'.repeat(2)}`, allow)).toEqual([]);
    const hit = (path: string) => ({ path, line: 1, rule: 'entity' });
    expect(applyDebt([hit('a.ts')], allow)).toEqual({ failures: [], tolerated: 1 });
    expect(applyDebt([hit('a.ts'), hit('a.ts')], allow).failures).toHaveLength(2);
    expect(applyDebt([hit('b.ts')], allow).failures).toEqual([hit('b.ts')]);
  });
  it('finds nothing outside the recorded debt in the tracked tree', () => {
    const allow = loadAllowlist();
    const { failures } = applyDebt(scanTree(allow), allow);
    expect(failures.map(item => `${item.path}:${item.line} ${item.rule}`)).toEqual([]);
  });
});
