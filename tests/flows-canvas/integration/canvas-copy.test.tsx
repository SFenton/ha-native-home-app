// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lift } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import Palette from '../../../src/workspace2/canvas/Palette';
import { indexGraph } from '../../../src/workspace2/canvas/graph-index';
import { inspectorDescription } from '../../../src/workspace2/canvas/inspector-copy';
import { anchor, number } from '../canvas/fixtures';

afterEach(cleanup);
it.each([1, 2])('describes %i If / Otherwise rules with the matching noun and verb', count => {
  const graph = lift({ type: 'choose', cases: Array.from({ length: count }, () => ({
    when: { type: 'viewer', isAdmin: true }, then: number(),
  })), otherwise: number() }, { kind: 'operand', anchor }).graph;
  expect(inspectorDescription(graph.nodes[0], graph, indexGraph(graph), [])).toContain(
    `${count} ${count === 1 ? 'rule is' : 'rules are'} checked in order`,
  );
});
it('hides unavailable blocks until a matching search, explains them, and hides them again after clearing', () => {
  const graph = lift(number(), { kind: 'operand', anchor }).graph, onAdd = vi.fn();
  render(<Palette graph={graph} scope="document" sourceId="source" capabilities={supportedCompositionCapabilities}
    locate={() => {}} onAdd={onAdd} close={() => {}}/>);
  const unavailable = () => screen.queryByText(/Not available here/)?.closest('details');
  expect(unavailable()?.hidden).toBe(true);
  const search = screen.getByRole('searchbox', { name: 'Find a block' });
  fireEvent.change(search, { target: { value: 'This Item' } });
  expect(unavailable()?.hidden).toBe(false);
  expect(unavailable()?.open).toBe(true);
  expect(screen.getByText('This block needs a different kind of field or flow.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Add This Item/ })).toBeNull();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'No matching fixture block' } });
  expect(unavailable()).toBeUndefined();
  expect(screen.getByText('Nothing matches.')).toBeTruthy();
  fireEvent.change(search, { target: { value: ' ' } });
  expect(unavailable()?.hidden).toBe(true);
});
it.each([
  ['Raw State', "The app you're targeting does not support this block."],
  ['Use Output', 'Add this through its field or template editor so its required settings are available.'],
  ['recipe.A-number-state', 'This calculation needs numbers, but these entity states are text.'],
])('explains unavailable %s search results without protocol or scope jargon', (query, explanation) => {
  const graph = lift(number(), { kind: 'operand', anchor }).graph;
  render(<Palette graph={graph} scope="document" capabilities={[]} locate={() => {}} onAdd={() => {}} close={() => {}}/>);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  expect(screen.getAllByText(explanation).length).toBeGreaterThan(0);
});
