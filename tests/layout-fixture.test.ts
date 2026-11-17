import { describe, expect, it } from 'vitest';
import { compositionErrors } from '../src/composition-editor';
import { documentWithTabs } from './support/layout-fixture';

describe('the layout fixture', () => {
  it('compiles', () => { expect(compositionErrors(documentWithTabs())).toEqual([]); });
});
