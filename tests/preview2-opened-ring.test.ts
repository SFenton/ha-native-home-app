import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The ring on the row that opened the trailing pane must be painted over the tile, not under its fill. jsdom paints nothing, so the rule itself is held: an `outline` inside the tile is covered by the fill. */
const css = readFileSync(new URL('../src/preview2/preview2.css', import.meta.url), 'utf8');
const rules = [...css.matchAll(/\[data-opened\]([^{]*)\{([^}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }));

describe('the selected row\'s ring', () => {
  it('is a border on a pseudo-element drawn above the tile, on or outside its edge', () => {
    const ring = rules.find(rule => rule.selector === ':not([data-selected])::after');
    expect(ring, 'a [data-opened]::after rule').toBeDefined();
    expect(ring!.body).toMatch(/position:\s*absolute/);
    expect(ring!.body).toMatch(/inset:\s*-\d+px/);
    expect(ring!.body).toMatch(/border:\s*[3-9]px solid/);
    expect(Number(/z-index:\s*(\d+)/.exec(ring!.body)?.[1])).toBeGreaterThanOrEqual(6);
    expect(ring!.body).toMatch(/border-radius:\s*var\(--ring-r/);
    expect(ring!.body).toMatch(/pointer-events:\s*none/);
  });

  it('is not an outline on the tile, which its own fill paints over', () => {
    expect(rules.filter(rule => rule.selector === '').map(rule => rule.body).join(' ')).not.toMatch(/outline/);
  });
});
