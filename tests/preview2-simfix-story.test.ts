import { describe, expect, it } from 'vitest';
import { simfixStory } from '../src/preview2/fixtures/simfix-story';
import { compositionDocumentSchema } from '../src/shared/composition/schema';

describe('the simfix story', () => {
  it('is a document the schema accepts, over invented entities only', () => {
    const { document } = simfixStory();
    const result = compositionDocumentSchema.safeParse(document);
    expect(result.success ? [] : result.error.issues.slice(0, 5).map(issue => `${issue.path.join('/')}: ${issue.message}`)).toEqual([]);
    expect(JSON.stringify(document)).not.toMatch(/"(?:light|switch|sensor|climate|vacuum|valve|select|cover|binary_sensor)\.(?!demo_)/);
  });
});
