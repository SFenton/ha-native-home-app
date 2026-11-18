import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandDocument } from '../src/shared/composition/components';
import { evaluateOperand, type Environment } from '../src/shared/composition/evaluator';
import type { CompositionDocument } from '../src/shared/composition/schema';

type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const gallery: J = JSON.parse(readFileSync(path.resolve(__dirname, '../src/preview2/fixtures/logic-gallery.json'), 'utf8'));
const lit = (value: unknown): J => ({ type: 'literal', value });

/**
 * A saved component, "Chore Row", whose text holds a use of the Yours or Theirs logic template, and whose person, name and thing are each set per place
 * (`sh.component-values@1`): a place's value lands in the use's argument. The logic is worked out first, and each binding is re-pointed through it.
 */
function document(places: J[], settable = ['name', 'thing']): J {
  const doc = structuredClone(base.document);
  doc.logicLibrary = structuredClone(gallery.document.logicLibrary.filter((entry: J) => entry.id === 'yours-or-theirs'));
  const body = { id: 'cmp-chore', title: 'Chore', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: { type: 'logic-ref', logicId: 'yours-or-theirs', args: { person: 'person.demo_sam', name: 'Sam', thing: 'Chores' } } }, style: 'body', unavailableText: 'None' } };
  doc.componentLibrary = [{ id: 'chore-row', name: 'Chore Row', params: settable.map(name => ({ name, kind: 'value', label: name })),
    bindings: settable.map(name => ({ param: name, nodeId: 'cmp-chore', field: `props/value/value/args/${name}` })), node: body }];
  doc.pages[2].components = places.map((values, at) => ({ id: `place-${at}`, type: 'component-ref', componentId: 'chore-row', layout: { span: 1 }, values }));
  return doc;
}
const compile = (d: J) => { try { return compileCompositionDocument(d as CompositionDocument); } catch (error: any) { throw new Error(JSON.stringify(error.issues ?? String(error))); } };
const viewing = (person: string): Environment => ({ read: () => ({ status: 'unavailable' }), viewer: { personEntityId: person } }) as unknown as Environment;
const shown = (node: J, e: Environment) => { const out = evaluateOperand(node.props.value.value, e); return out.status === 'value' ? out.value : out.status; };

describe('a logic use in a saved component, fed by values each place sets', () => {
  const places = [{}, { thing: 'Side' }, { person: 'person.demo_alex', name: 'Alex', thing: 'Sides' }];
  it('compiles with no logic-ref left, and each place writes its own values into the worked-out logic', () => {
    const compiled = compile(document(places, ['person', 'name', 'thing']));
    expect(JSON.stringify(compiled.expanded)).not.toMatch(/logic-ref|"hole"|logicLibrary/);
    expect(compiled.capabilities).toContain('sh.component-values@1');
    const drawn = expandDocument(compiled.expanded as CompositionDocument).pages[2].components as J[];
    expect(drawn.map(node => shown(node, viewing('person.demo_sam')))).toEqual(['Your Chores', 'Your Side', 'Alex’s Sides']);
    expect(drawn.map(node => shown(node, viewing('person.demo_alex')))).toEqual(['Sam’s Chores', 'Sam’s Side', 'Your Sides']);
  });
  it('re-points each binding through the logic to every field its argument lands in', () => {
    const compiled = compile(document(places, ['person', 'name', 'thing']));
    const fields = (compiled.expanded as J).componentLibrary[0].bindings.map((binding: J) => binding.field);
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(fields.every((field: string) => field.startsWith('props/value/value/'))).toBe(true);
  });
});
