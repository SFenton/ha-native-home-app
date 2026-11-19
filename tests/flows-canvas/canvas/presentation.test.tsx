// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { lift } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import { blockCatalog } from '../../../src/shared/composition/graph/catalog';
import Palette from '../../../src/workspace2/canvas/Palette';
import { blockName, blockResult, blockSeed, fixedAverage, nodeDetail, nodeName, portLabel } from '../../../src/workspace2/canvas/blocks';
import Inspector from '../../../src/workspace2/canvas/Inspector';
import type { CanvasHost, LogicGraph, PortType } from '../../../src/shared/composition/graph';
import { edit, initialEditState } from '../../../src/workspace2/canvas/edit';
import { indexGraph } from '../../../src/workspace2/canvas/graph-index';
import { blockLayoutKey, presentBlocks } from '../../../src/workspace2/canvas/presentation';
import { branchLabel } from '../../../src/workspace2/canvas/inspector-copy';
import PortGlyph, { listItemKind } from '../../../src/workspace2/canvas/PortGlyph';
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
  const not = lift({ type: 'not', of: { type: 'viewer', isAdmin: false } }, { kind: 'condition', anchor }).graph.nodes[0];
  expect(portLabel('/of', not)).toBe('Check');
});
it('labels only the exact existing fixed-average recipe and leaves its arithmetic editable', () => {
  const graph = lift({ type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [number(23.6), number(25)] }, number(2)] }, { kind: 'operand', anchor }).graph;
  expect(fixedAverage(graph, graph.nodes[0])).toBe(true);
  expect(fixedAverage({ ...graph, edges: graph.edges.filter(edge => edge.to.portId !== '/args/1') }, graph.nodes[0])).toBe(false);
});
it.each(blockCatalog)('derives $key palette output hints from graph-core descriptors, not grammar names', entry => {
  const seed = blockSeed(entry, 'light');
  const output = seed ? lift(seed.value, { kind: seed.kind }).graph.nodes[0].outputs[0].type : undefined;
  expect(blockResult(entry, 'light')).toEqual(output);
});
it('announces numeric date arithmetic accurately and distinguishes Raw State from Entity State', () => {
  const graph = lift(number(), { kind: 'operand', anchor }).graph;
  render(<Palette graph={graph} scope="document" sourceId="light" capabilities={blockCatalog.flatMap(entry => entry.capabilities)} locate={() => {}} onAdd={() => {}} close={() => {}}/>);
  for (const label of ['Days Between', 'Seconds Between', 'Progress Between']) {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: label } });
    expect(screen.getByRole('button', { name: `Add ${label}, number` })).toBeTruthy();
  }
  expect(blockName('operand.raw-state.value')).toBe('Raw State');
  expect(blockName('predicate.state.value')).toBe('Entity State');
});
it.each([1, 3])('draws the selected compound graph with its actual %i branches, labels and output destination', count => {
  const graph = lift({ type: 'all', of: Array.from({ length: count }, (_, n) => ({ type: 'state', sourceId: `source-${n}`, path: ['state'], in: ['on'] })) }, { kind: 'condition', anchor }).graph;
  const host: CanvasHost = { data: { sources: Array.from({ length: count }, (_, n) => ({ id: `source-${n}`, name: `Lamp ${n + 1}` })) }, targetCapabilities: [],
    snapshot: () => ({ document: {}, revision: '1' }), open() {}, openOutput() {}, uses: () => [], preview() {}, apply: async () => ({ status: 'invalid', diagnostics: [] }), save: async () => ({ status: 'invalid', diagnostics: [] }), compareConflict() {} };
  render(<Inspector graph={graph} node={graph.nodes[0]} host={host} send={() => {}} close={() => {}} locate={() => {}} move={() => {}} remove={() => {}} budgets={[]} onLocate={() => {}} outputNames={['Visible When']}/>);
  const map = screen.getByRole('figure', { name: `All Of, ${count} checks` });
  expect(map.querySelectorAll('.w2-canvas-summary-branch')).toHaveLength(count);
  for (let n = 0; n < count; n++) expect(within(map).getByText(`Lamp ${n + 1} is on`)).toBeTruthy();
  expect(within(map).getByText('Visible When')).toBeTruthy();
  expect(screen.getByText(`All of ${count} checks must match. ${count} of ${count} connected.`)).toBeTruthy();
});
function presentation(graph: LogicGraph, previous?: ReturnType<typeof presentBlocks>) {
  const index = indexGraph(graph), names = new Map(graph.nodes.map(node => [node.id, nodeName(node, graph, index)]));
  return presentBlocks(graph, index, names, [], previous);
}
it('retains every unaffected block presentation and the layout key on a literal value edit', () => {
  const graph = lift({ type: 'math', op: 'add', args: [number(21), number(3)] }, { kind: 'operand', anchor }).graph;
  const literal = graph.nodes[1], before = presentation(graph);
  const revised = edit(initialEditState(graph), { type: 'update', nodeId: literal.id, value: number(25) }).graph;
  const after = presentation(revised, before);
  for (const node of graph.nodes) {
    if (node.id === literal.id) expect(after.get(node.id)).not.toBe(before.get(node.id));
    else expect(after.get(node.id)).toBe(before.get(node.id));
  }
  expect(blockLayoutKey(revised, after)).toBe(blockLayoutKey(graph, before));
});
it('refreshes dependent labels when an edited count stops being a fixed Average', () => {
  const graph = lift({ type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [number(), number()] }, number(2)] }, { kind: 'operand', anchor }).graph;
  const before = presentation(graph), index = indexGraph(graph), divisor = index.source(graph.nodes[0].id, '/args/1')!;
  const revised = edit(initialEditState(graph), { type: 'update', nodeId: divisor.id, value: number(3) }).graph, after = presentation(revised, before);
  expect(before.get(graph.nodes[0].id)?.name).toBe('Average');
  expect(after.get(graph.nodes[0].id)?.name).toBe('Divide');
  expect(after.get(graph.nodes[0].id)).not.toBe(before.get(graph.nodes[0].id));
});
it('labels Not without reversing or hiding the configured negative predicate', () => {
  const graph = lift({ type: 'not', of: { type: 'viewer', isAdmin: false } }, { kind: 'condition', anchor }).graph;
  expect(branchLabel(graph.nodes[0], graph, indexGraph(graph), [])).toBe('Not → Viewer is not an administrator');
});
it.each([
  [{ kind: 'number' }, 'number', 'hash'],
  [{ kind: 'string' }, 'text', 'type'],
  [{ kind: 'object', fields: {} }, 'record', 'braces'],
  [{ kind: 'union', of: [{ kind: 'number' }, { kind: 'null' }] }, 'number', 'hash'],
  [{ kind: 'union', of: [{ kind: 'number' }, { kind: 'string' }] }, 'unknown', 'circle-help'],
  [{ kind: 'any' }, 'unknown', 'circle-help'],
] satisfies [PortType['shape'], string, string][])('uses the declared list item glyph for %j', (item, kind, icon) => {
  const { container } = render(<PortGlyph kind="list" itemKind={listItemKind({ kind: 'array', of: item })}/>);
  expect(container.querySelector('[data-item-kind]')?.getAttribute('data-item-kind')).toBe(kind);
  expect(container.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
});
