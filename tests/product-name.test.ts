import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const banned = [/native home/i, /reimagined/i, /native composition/i, /make home feel like you/i];
/** Source files whose string literals reach people, with the file kinds that carry no UI copy skipped. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'composition' ? [] : sources(path);
    return /\.(tsx?|html)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}
/** Quoted strings, template text and JSX text, minus comments and import/export module paths. */
function visibleStrings(text: string) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*(import|export)\b[^\n]*from\s+'[^']*';?$/gm, '');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}\n]+)</g)].map(match => match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
}
/** Identifier-like strings (kinds, ids, endpoints, file names) are data keys, not copy. */
const identifier = /^[\w./@:-]+$/;

describe('product name in visible copy', () => {
  it('never says Native Home, Native composition or the old taglines in user-facing strings', () => {
    const hits = ['src', 'index.html'].flatMap(entry => (statSync(entry).isDirectory() ? sources(entry) : [entry]))
      .flatMap(file => visibleStrings(readFileSync(file, 'utf8')).filter(text => !identifier.test(text) && banned.some(pattern => pattern.test(text))).map(text => `${file}: ${text.slice(0, 80)}`));
    expect(hits).toEqual([]);
  });
  it('names the HTML title and the manifest S+H Studio', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<title>S+H Studio</title>');
    expect(readFileSync('config.yaml', 'utf8')).toMatch(/^name: S\+H Studio$/m);
    expect(readFileSync('config.yaml', 'utf8')).toMatch(/^panel_title: S\+H Studio$/m);
  });
});
