import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors, replaceAt, valueAt } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { endOf, insertType, type Destination } from '../src/workspace2/add/insert';
import { runChecks } from '../src/workspace2/checks';
import { boundControlShows, withBoundControlKind } from '../src/workspace2/editors/boundControl';
import { boundControlAllows } from '../src/shared/composition/bound-control';

const base = (JSON.parse(readFileSync(new URL('./fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
const { document: withToggle, key } = insertType(base, endOf(base, 'page:page-home') as Destination, 'bound-control', { entityId: 'light.lamp', name: 'Lamp' });
const path = buildDocumentIndex(withToggle).get(key)!.path as (string | number)[];

describe('a bound control only offers the fields its kind uses', () => {
  it('starts as a Toggle that compiles, with turn on and turn off', () => {
    expect(compositionErrors(withToggle)).toEqual([]);
    const node = valueAt(withToggle, path) as Record<string, unknown>;
    expect(Object.keys(node)).toEqual(expect.arrayContaining(['onAction', 'offAction']));
  });

  it('hides "When tapped" for a Toggle and shows the two it uses; a Button is the other way round', () => {
    expect(boundControlShows(withToggle, path, [...path, 'action'])).toBe(false);
    expect(boundControlShows(withToggle, path, [...path, 'onAction'])).toBe(true);
    expect(boundControlShows(withToggle, path, [...path, 'offAction'])).toBe(true);
    expect(boundControlShows(withToggle, path, [...path, 'props', 'isOn'])).toBe(true);
    expect(boundControlShows(withToggle, path, [...path, 'props', 'range'])).toBe(false);
    expect(boundControlShows(withToggle, path, [...path, 'title'])).toBe(true);
    const asButton = withBoundControlKind(withToggle, path, 'button');
    expect(boundControlShows(asButton, path, [...path, 'action'])).toBe(true);
    expect(boundControlShows(asButton, path, [...path, 'onAction'])).toBe(false);
    expect(boundControlShows(asButton, path, [...path, 'props', 'isOn'])).toBe(false);
  });

  it('shows everything for a node that is not a bound control', () => {
    const rowPath = buildDocumentIndex(base).get([...buildDocumentIndex(base).entries.values()].find(entry => entry.node?.type === 'row')!.key)!.path as (string | number)[];
    expect(boundControlShows(base, rowPath, [...rowPath, 'action'])).toBe(true);
  });

  it('changing the kind drops what the new kind does not use, so nothing the compiler rejects is left', () => {
    for (const kind of ['stepper', 'slider', 'choice', 'button'] as const) {
      const changed = withBoundControlKind(withToggle, path, kind);
      const node = valueAt(changed, path) as { props: Record<string, unknown> } & Record<string, unknown>;
      expect(node.props.kind).toBe(kind);
      expect('onAction' in node || 'offAction' in node || 'isOn' in node.props || 'surface' in node.props, kind).toBe(false);
      // Only what the new kind still needs is missing; nothing is an invalid combination.
      const problems = runChecks(changed).problems.map(problem => problem.sentence);
      expect(problems.some(sentence => /does not work with this kind/.test(sentence)), `${kind}: ${problems.join('; ')}`).toBe(false);
    }
  });

  it('keeps the Toggle surface when the kind stays a Toggle', () => {
    const again = withBoundControlKind(withToggle, path, 'toggle');
    expect((valueAt(again, [...path, 'props']) as Record<string, unknown>).surface).toBe('tile');
  });
});

describe('Checks name the clashing row and go to the control', () => {
  it('says "When tapped does not work with this kind" for a Toggle with a tap action, and selects the control', () => {
    const tapped = replaceAt(withToggle, [...path, 'action'], (valueAt(withToggle, [...path, 'offAction']) as never));
    const problem = runChecks(tapped).problems.find(row => /does not work with this kind/.test(row.sentence))!;
    expect(problem.sentence).toBe('Lamp: When tapped does not work with this kind. Remove it, or change the kind.');
    expect(problem.select).toBe(key);
  });
  it('names a missing field too', () => {
    const asButton = withBoundControlKind(withToggle, path, 'button');
    expect(runChecks(asButton).problems.map(row => row.sentence)).toContain('Lamp: When tapped is needed.');
  });
  it('the shared table is the compiler rule', () => {
    expect(boundControlAllows('toggle', 'node', 'action')).toBe(false);
    expect(boundControlAllows('button', 'node', 'onAction')).toBe(false);
    expect(boundControlAllows('toggle', 'node', 'title')).toBe(true);
  });
});
