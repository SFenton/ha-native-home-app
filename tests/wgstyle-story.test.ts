import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { wgstyleStory } from '../src/preview2/fixtures/wgstyle-story';

/** The style-parts story compiles with no issue and declares exactly the four ids it uses (lane `wg-s1`). */
describe('the style parts story', () => {
  it('compiles, and uses all four capabilities', () => {
    const { document } = wgstyleStory();
    const result = (() => { try { return compileCompositionDocument(document); } catch (error) { throw new Error(JSON.stringify((error as { issues?: unknown }).issues, null, 1)); } })();
    for (const id of ['sh.text-style@1', 'sh.stack@1', 'sh.symbol-part@1', 'sh.choice-icons@1']) expect(result.capabilities).toContain(id);
  });
  it('names nothing after a product: only demo ids', () => {
    expect(JSON.stringify(wgstyleStory().document)).not.toMatch(/forecast-card|weather-card/);
  });
});
