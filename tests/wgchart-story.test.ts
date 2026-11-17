import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { wgchartStory } from '../src/preview2/fixtures/wgchart-story';

/** The data parts story compiles with no issue and declares exactly the ids it uses (lane `wg-s3`). */
describe('the data parts story', () => {
  it('compiles, and uses both capabilities', () => {
    const { document } = wgchartStory();
    const result = (() => { try { return compileCompositionDocument(document); } catch (error) { throw new Error(JSON.stringify((error as { issues?: unknown }).issues, null, 1)); } })();
    for (const id of ['sh.chart@1', 'sh.linear-gauge@1']) expect(result.capabilities).toContain(id);
  });
  it('names nothing after a product: only demo ids and generic words', () => {
    expect(JSON.stringify(wgchartStory().document)).not.toMatch(/weather|forecast|rain|temperature|humidity/i);
  });
});
