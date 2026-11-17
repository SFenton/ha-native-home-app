import { describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { mapctlScenarios, mapctlStory } from '../src/preview2/fixtures/mapctl-story';
import { compileCompositionDocument } from '../src/shared/composition/compiler';

/** The screenshot story compiles in every scenario, and declares only what each needs. */
describe('the map controls story', () => {
  for (const scenario of mapctlScenarios) it(`compiles the ${scenario} scenario`, () => {
    const { capabilities } = compileCompositionDocument(mapctlStory(homeDomains.document as unknown as CompositionDocument, scenario).document);
    expect(capabilities.includes('sh.surface-controls@1')).toBe(scenario !== 'default');
    expect(capabilities.includes('sh.surface-orientation@1')).toBe(scenario.startsWith('flip'));
  });
});
