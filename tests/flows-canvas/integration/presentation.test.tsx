// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { lift, type LogicGraph } from '../../../src/shared/composition/graph';
import type { Operand, Predicate } from '../../../src/shared/composition/expression';
import { graphSentence, miniMapModel } from '../../../src/workspace2/logic-fields/presentation';
import { MiniMap } from '../../../src/workspace2/logic-fields/MiniMap';
import type { NameContext } from '../../../src/workspace2/expr/condition';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { houseFrom } from '../../../src/preview2/projections';
import { operandBodyDraft, useFieldDraft } from '../../../src/workspace2/logic-fields/LogicFields';
import SimpleCondition from '../../../src/workspace2/expr/SimpleCondition';
import { SimulationHost } from '../../../src/workspace2/logic-simulation/SimulationHost';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';
import { integrationDocument, integrationSnapshot } from './fixture';
import { LiveHouse } from '../../../src/preview2/live-house';
import { hasMultipleChecks, logicCheckCount } from '../../../src/workspace2/logic-fields/checks';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { replaceAt, valueAt } from '../../../src/composition-editor';
import { operandSlot } from '../../../src/workspace2/expr/tokens';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { liftField } from '../../../src/workspace2/logic-fields/registry';

afterEach(cleanup);
const document = integrationDocument();
const ctx: NameContext = {
  document: { dataSources: [...document.dataSources,
    { id: 'bedroom', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_bedroom_temperature' } },
    { id: 'target', kind: 'ha-entity', entityId: { type: 'literal', value: 'climate.demo_thermostat' } },
  ] },
  entityName: id => integrationSnapshot.states.find(state => state.entityId === id)?.name ?? (id === 'climate.demo_thermostat' ? 'Thermostat' : undefined),
};
const read = (sourceId: string, path = ['state']): Operand => ({ type: 'read', from: { type: 'source', sourceId, path }, as: 'number', missing: 'unavailable' });
const average: Operand = { type: 'math', op: 'divide', args: [
  { type: 'math', op: 'add', args: [read('source-b'), read('bedroom')] }, { type: 'literal', value: 2 },
] };
const condition: Predicate = { type: 'all', of: [
  { type: 'compare', op: 'above', left: average, right: { type: 'math', op: 'add', args: [read('target', ['attributes', 'target']), { type: 'literal', value: 2 }] } },
  { type: 'state', sourceId: 'source-a', path: ['state'], in: ['closed'] },
] };

it('keeps values and one-check rules in their editors, counting checks rather than AST operations', () => {
  expect(logicCheckCount(average)).toBe(0);
  expect(logicCheckCount({ type: 'format', pattern: '{a}{b}', args: {
    a: { type: 'logic-ref', logicId: 'first', args: {} }, b: { type: 'logic-ref', logicId: 'second', args: {} },
  } })).toBe(0);
  const one = { type: 'not', of: { type: 'all', of: [{ type: 'state', sourceId: 'source-a', path: ['state'], in: ['open', 'closed'] }] } };
  expect(logicCheckCount(one)).toBe(1);
  expect(hasMultipleChecks({ type: 'expr', value: { type: 'choose', cases: [{ when: one, then: average }], otherwise: average } })).toBe(false);
  expect(hasMultipleChecks(condition)).toBe(true);
  expect(logicCheckCount({ type: 'all', of: [{ type: 'logic-ref', logicId: 'first', args: {} }, { type: 'logic-ref', logicId: 'second', args: {} }] })).toBe(2);
  expect(logicCheckCount({ type: 'literal', value: condition })).toBe(0);
  expect(logicCheckCount({ type: 'compare', op: 'eq', left: { type: 'choose', cases: [{ when: condition, then: average }], otherwise: average }, right: average })).toBe(1);
});

it('hands a pushed value editor to the canvas at its canonical template body without persisting its slot view', () => {
  const path = ['logicLibrary', 0, 'body'], body = valueAt(document, path) as Operand;
  const local = createDraft(replaceAt(document, path, operandSlot(body)));
  const canonical = operandBodyDraft(local, path);
  expect(canonical.get()).toEqual(document);
  expect(canonical.get()).toBe(canonical.get());
  expect(liftField(canonical.get(), path, 'operand').graph.roots[0].anchor).toEqual({ kind: 'logic', id: 'tile-label', field: '/body' });
  canonical.set(replaceAt(canonical.get(), path, { type: 'literal', value: 'Edited locally' }));
  expect(valueAt(local.get(), path)).toEqual({ type: 'literal', value: 'Edited locally' });
  expect(compileCompositionDocument(canonical.get()).document.logicUseBindings).toEqual(document.logicUseBindings);
  expect(document.logicLibrary![0].body).toEqual(body);
});

it('generates the sentence from the average, target formula and nested conditions, using configured names', () => {
  const graph = lift(condition, { kind: 'condition' }).graph;
  expect(graphSentence(graph, ctx)).toBe("The Average of Living Room and Bedroom is above Thermostat's target + 2 and Window is Closed");
  const mixed = lift({ type: 'any', of: [condition, { type: 'viewer', isAdmin: true }] }, { kind: 'condition' }).graph;
  expect(graphSentence(mixed, ctx)).toContain('(the Average of Living Room and Bedroom');
  expect(graphSentence(mixed, ctx)).toContain(') or the person using the app is an admin');
});

it('describes current block values rather than a stale original expression', () => {
  const graph = lift({ type: 'compare', op: 'eq', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 2 } }, { kind: 'condition' }).graph;
  const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => {
    return node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 2
      ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 9 } } } : node;
  }) };
  expect(graphSentence(edited, ctx)).toBe('1 is 9');
  expect(graphSentence(graph, ctx)).toBe('1 is 2');
});

it('renders every actual mini-map block with its name and typed wires, without changing canvas positions', () => {
  const graph = lift(condition, { kind: 'condition' }).graph, before = JSON.stringify(graph);
  const model = miniMapModel(graph, ctx);
  expect(model.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
  const view = render(<MiniMap graph={graph} ctx={ctx} description={graphSentence(graph, ctx)}/>);
  const labels = [...view.container.querySelectorAll('.w2-logic-map-label')].map(node => node.textContent);
  expect(labels.join(' ')).not.toContain('graph-setting');
  for (const name of ['Window', 'Living Room', 'Bedroom', 'Thermostat', 'Average', 'All Of']) expect(labels.some(label => label?.includes(name)), `${name}: ${labels.join(', ')}`).toBe(true);
  expect(view.container.querySelectorAll('path[data-wire-kind=number]').length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('path[data-wire-kind=condition]').length).toBeGreaterThan(0);
  expect(JSON.stringify(graph)).toBe(before);
});

it('keeps unchanged inline condition bytes while the compact value picker opens and contains Other', async () => {
  const onChange = vi.fn(), rule: Predicate = { type: 'state', sourceId: 'source-a', path: ['state'], in: ['open'] };
  function Field() {
    const draft = useFieldDraft(document, onChange);
    return <SimpleCondition compact draft={draft} rule={rule} ctx={ctx} write={onChange}/>;
  }
  render(<WorkspaceDataProvider document={document} house={houseFrom(integrationSnapshot)}><Field/></WorkspaceDataProvider>);
  expect(screen.getByRole('button', { name: 'Entity' }).textContent).toBe('Window');
  expect(screen.queryByLabelText('Other value')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Value' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Other…' }));
  expect(screen.getByRole('textbox', { name: 'Other value' })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  expect(JSON.stringify(rule)).toBe('{"type":"state","sourceId":"source-a","path":["state"],"in":["open"]}');
});

it('labels retained simulation answers plainly without changing their stale provenance', async () => {
  const graph = lift(read('source-b'), { kind: 'operand' }).graph, live = new LiveHouse();
  live.applySnapshot(integrationSnapshot.states);
  const program = createSimulationProgram([graph], { sourceEntities: { 'source-b': 'sensor.demo_living_room_temperature' } });
  render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
    <SimulationHost program={program} document={document} canvasId="presentation-copy-test" freshness={{ stale: true }}/>
  </WorkspaceDataProvider>);
  expect(await screen.findByText('Waiting for Home Assistant.')).toBeTruthy();
  expect((await screen.findAllByText('Last value kept')).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Held\/stale/)).toBeNull();
});
