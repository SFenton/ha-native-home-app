// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { lift } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import { blockCatalog } from '../../../src/shared/composition/graph/catalog';
import Palette from '../../../src/workspace2/canvas/Palette';
import { fixedAverage, nodeDetail, portLabel } from '../../../src/workspace2/canvas/blocks';
import { anchor, number } from './fixtures';

afterEach(cleanup);
it('keeps categories closed, gives chips distinct icons and moves unavailable blocks out of the grid', () => {
  const graph = lift(number(), { kind: 'operand', anchor }).graph;
  render(<Palette graph={graph} scope="document" sourceId="light" capabilities={supportedCompositionCapabilities} locate={() => {}} onAdd={() => {}} close={() => {}}/>);
  expect(screen.queryByRole('list', { name: 'From Home blocks' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^From Home, \d+ blocks$/ }));
  const chips = within(screen.getByRole('list', { name: 'From Home blocks' })).getAllByRole('button');
  const icons = chips.map(chip => chip.querySelector('svg')?.innerHTML);
  expect(new Set(icons).size).toBe(chips.length);
  expect(chips.every(chip => !chip.hasAttribute('aria-disabled'))).toBe(true);
  expect(screen.getByText(/Not available here/).closest('details')?.open).toBe(false);
  expect(blockCatalog.length).toBeGreaterThan(chips.length);
});
it('uses human-readable port labels without raw operation subtitles', () => {
  const graph = lift({ type: 'math', op: 'add', args: [number(23.6), number(25)] }, { kind: 'operand', anchor }).graph;
  const root = graph.nodes[0];
  expect(nodeDetail(root)).toBe('');
  expect(root.inputs.map(port => portLabel(port.id, root))).toEqual(['Value', 'Plus']);
});
it('labels only the exact existing fixed-average recipe and leaves its arithmetic editable', () => {
  const graph = lift({ type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [number(23.6), number(25)] }, number(2)] }, { kind: 'operand', anchor }).graph;
  expect(fixedAverage(graph, graph.nodes[0])).toBe(true);
  expect(fixedAverage({ ...graph, edges: graph.edges.filter(edge => edge.to.portId !== '/args/1') }, graph.nodes[0])).toBe(false);
});
