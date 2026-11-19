import { expect, it } from 'vitest';
import { replaceAt } from '../src/composition-editor';
import { entityReaders, fieldsWithLogic, outputKind } from '../src/workspace2/flows/model';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import gallery from '../src/preview2/fixtures/logic-gallery.json';

const document = gallery.document as unknown as CompositionDocument;
const path = ['pages', 0, 'components', 0, 'children', 0];
const read: Operand = { type: 'read', from: { type: 'source', sourceId: 'demo-light-1', path: ['state'] }, as: 'number', missing: 'unavailable' };
const state: Predicate = { type: 'state', sourceId: 'demo-light-1', path: ['state'], in: ['on'] };

it('lists one field rather than its nested operands, and discovers conditions, looks and rules without duplicating children', () => {
  const fields = fieldsWithLogic(document);
  expect(fields.filter(field => field.title === 'Lights' && field.path.endsWith('/props/subtitle'))).toHaveLength(1);
  let edited = replaceAt(document, [...path, 'visibleWhen'], { type: 'all', of: [state, { type: 'not', of: state }] });
  edited = replaceAt(edited, [...path, 'props', 'activeWhen'], { type: 'not', of: state });
  edited = replaceAt(edited, [...path, 'props', 'filledWhen'], { type: 'numeric', sourceId: 'demo-light-1', path: ['state'], above: read });
  edited = replaceAt(edited, [...path, 'props', 'errorWhen'], { type: 'numeric', sourceId: 'demo-light-1', path: ['state'], above: { type: 'literal', value: 10 } });
  edited = replaceAt(edited, [...path, 'action'], { type: 'conditional', cases: [{ when: state, then: { type: 'none' } }], otherwise: { type: 'none' } });
  const paths = fieldsWithLogic(edited).map(field => field.path);
  for (const suffix of ['visibleWhen', 'props/activeWhen', 'props/filledWhen', 'action']) expect(paths).toContain(`${path.join('/')}/${suffix}`);
  expect(paths).not.toContain(`${path.join('/')}/props/errorWhen`);
  expect(paths).not.toContain(`${path.join('/')}/action/cases/0/when`);
  expect(fieldsWithLogic(replaceAt(document, [...path, 'visibleWhen'], state)).some(field => field.path === `${path.join('/')}/visibleWhen`)).toBe(false);
});

it('keeps output glyphs typed when a template body contains settings rather than concrete operands', () => {
  const params: NonNullable<CompositionDocument['logicLibrary']>[number]['params'] = [{ name: 'count', kind: 'number', sample: 3 }, { name: 'start', kind: 'text', display: 'time', sample: '07:00' }];
  expect(outputKind({ type: 'math', op: 'add', args: [{ type: 'hole', name: 'count' }, { type: 'literal', value: 1 }] }, document, params)).toBe('number');
  expect(outputKind({ type: 'hole', name: 'count' }, document, params)).toBe('number');
  expect(outputKind({ type: 'literal', value: { type: 'hole', name: 'start' } }, document, params)).toBe('time');
  expect(outputKind({ type: 'list', items: [{ type: 'hole', name: 'count' }] }, document, params)).toBe('list');
});

it('finds named transitive readers, not service intent names or literal words that look like entity ids', () => {
  let edited = replaceAt(document, [...path, 'props', 'primary'], { type: 'literal', value: 'sensor.demo_not_a_read' });
  edited = replaceAt(edited, [...path, 'props', 'subtitle'], { type: 'expr', value: read });
  const readers = entityReaders(edited);
  expect(readers.get('switch.demo_light_1')).toContain('Lights');
  expect(readers.has('power.toggle')).toBe(false);
  expect(readers.has('sensor.demo_not_a_read')).toBe(false);
  expect(readers.has('person.demo_sam')).toBe(false);
  const unusedModel: CompositionDocument['dataSources'][number] = { id: 'unused-model', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'switch.demo_not_read' } } };
  expect(entityReaders({ ...edited, dataSources: [...edited.dataSources, unusedModel] }).has('switch.demo_not_read')).toBe(false);
  expect(readers.get('switch.demo_light_1')).not.toContain('Power switch');
});
