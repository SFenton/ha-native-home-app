import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { compositionWarnings } from '../src/shared/composition/lints';
import {
  addStopper, betweenOf, callFormOf, contrastRatio, dialControlWarnings, fromThermostat, newClimateSource, newDialControl, newThermostat, removeStopper, restart,
  rebindThermostat, recallThermostat, rememberThermostat, sourceUsedElsewhere, thermostatFor, stopperInks, stoppersOf, thermostatView, withBetween, withCallForm, withThermostatView, type DialNodeShape,
} from '../src/shared/composition/dial-control-edit';

type J = Record<string, any>;
const first = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8')) as { document: J };
const base = { id: 'c', title: 'Study humidity', layout: { span: 1 } };
const make = (start: 'blank' | 'one' | 'range') => newDialControl(start, base, { min: 20, max: 80, step: 1 }) as unknown as DialNodeShape;
const compile = (node: J, sources: J[] = []) => {
  const document = structuredClone(first.document);
  document.pages[2].components = [node];
  document.dataSources.push(...sources);
  return compileCompositionDocument(document).capabilities;
};
const issues = (node: J) => { try { compile(node); } catch (error) { if (error instanceof CompositionValidationError) return error.issues.map(issue => `${issue.code} ${issue.pointer}`); throw error; } return []; };

describe('the starting points', () => {
  for (const start of ['blank', 'one', 'range'] as const) {
    it(`${start} compiles and declares the dial control`, () => {
      expect(issues(make(start))).toEqual([]);
      expect(compile(make(start))).toContain('sh.dial-control@1');
    });
  }
  it('a range has two stoppers that stop at each other, and reads both in one call', () => {
    const node = make('range');
    expect(stoppersOf(node).map(stopper => stopper.id)).toEqual(['low', 'high']);
    expect(betweenOf(node)).toBe('stop');
    expect(callFormOf(node)).toBe('dial');
    expect(JSON.stringify(node.action)).toContain('"stopper":"high"');
  });
  it('the default rims hold 3 to 1 against the track in each appearance, so a new dial has no colour note', () => {
    for (const start of ['one', 'range'] as const) expect(dialControlWarnings(make(start), '/n')).toEqual([]);
    const pairs = stopperInks as unknown as { light: J; dark: J }[];
    const ratio = (c: J, track: number) => contrastRatio([c.red, c.green, c.blue], [track, track, track]);
    for (const ink of pairs) { expect(ratio(ink.light, 145)).toBeGreaterThanOrEqual(3); expect(ratio(ink.dark, 110)).toBeGreaterThanOrEqual(3); }
  });
  it('restart keeps the node, its range and its size', () => {
    const node = { ...make('range'), props: { ...make('range').props, size: 'compact' } } as DialNodeShape;
    const one = restart(node, 'one') as J;
    expect([one.id, one.title, one.props.range, one.props.size]).toEqual(['c', 'Study humidity', node.props.range, 'compact']);
    expect(one.props.stoppers).toHaveLength(1);
  });
});

describe('stoppers', () => {
  it('adding the second stopper makes it a range that compiles and reads it in the call', () => {
    const two = addStopper(make('one'))!;
    expect(stoppersOf(two as never)).toHaveLength(2);
    expect(betweenOf(two as never)).toBe('stop');
    expect(issues(two as never)).toEqual([]);
    expect(JSON.stringify(two.action)).toContain('"stopper":"high"');
    expect(addStopper(two)).toBeNull();
  });
  it('removing one leaves one, drops the rule between and the reads of it, and the middle follows', () => {
    const one = removeStopper(make('range'), 'low')!;
    expect(stoppersOf(one as never).map(stopper => stopper.id)).toEqual(['high']);
    expect(one.props.between).toBeUndefined();
    expect(one.props.center).toMatchObject({ value: { shows: 'high' } });
    expect(JSON.stringify(one.action)).not.toContain('"stopper":"low"');
    expect(issues(one as never)).toEqual([]);
    expect(removeStopper(one, 'high')).toBeNull();
  });
  it('the rule between two is one of three words', () => {
    const node = make('range');
    expect(betweenOf(withBetween(node, 'free'))).toBe('free');
    const apart = withBetween(node, 'apart');
    expect(betweenOf(apart)).toBe('apart');
    expect(apart.props.between).toEqual({ rule: 'stop', gap: { type: 'literal', value: 1 } });
    expect(betweenOf(withBetween(apart, 'stop'))).toBe('stop');
    expect(withBetween(make('one'), 'apart').props.between).toBeUndefined();
    expect(issues(apart as never)).toEqual([]);
  });
  it('the call form moves between one call and one per stopper, and both compile', () => {
    const per = withCallForm(make('range'), 'stopper');
    expect(callFormOf(per)).toBe('stopper');
    expect(per.action).toBeUndefined();
    expect(stoppersOf(per).every(stopper => stopper.action !== undefined)).toBe(true);
    expect(JSON.stringify(per)).not.toContain('"stopper":"low"');
    expect(issues(per as never)).toEqual([]);
    const back = withCallForm(per, 'dial');
    expect(callFormOf(back)).toBe('dial');
    expect(issues(back as never)).toEqual([]);
  });
});

describe('the notes the Checks list shows', () => {
  const warn = (node: J) => dialControlWarnings(node as never, '/n').map(item => item.message);
  it('a first stopper above the second, with Stop at Each Other', () => {
    const node = make('range') as J;
    node.props.stoppers[0].value.value = 70; node.props.stoppers[1].value.value = 30;
    expect(warn(node).join(' ')).toContain('The first stopper is above the second');
    node.props.between = { rule: 'free' };
    expect(warn(node)).toEqual([]);
  });
  it('a stopper with no value, a gap with no room, too many dots and a rim under 3 to 1', () => {
    const node = make('range') as J;
    node.props.stoppers[0].value = { type: 'literal', value: null };
    node.props.between = { rule: 'stop', gap: { type: 'literal', value: 59.5 } };
    node.props.ticks = { every: 0.5 };
    node.props.stoppers[1].ink = { type: 'solid-rgb', red: 145, green: 145, blue: 145 };
    const text = warn(node).join('\n');
    for (const part of ['has no value', 'leaves no room', 'draws at most 60 dots', 'rim is under 3 to 1']) expect(text).toContain(part);
  });
  it('a speaker’s volume gets the HIG note, and the lints list reaches a dial in a document', () => {
    const node = make('one') as J;
    node.action.target = { entity_id: { type: 'literal', value: 'media_player.demo_speaker' } };
    expect(warn(node).join(' ')).toContain('not the way to set volume');
    const document = structuredClone(first.document);
    document.pages[2].components = [node];
    expect(compositionWarnings(document).some(item => item.message.includes('not the way to set volume'))).toBe(true);
  });
});

describe('the Thermostat view', () => {
  const source = newClimateSource('climate-demo', 'climate.demo_hall');
  const thermostat = newThermostat(base, 'climate-demo') as J;
  it('publishes as climate-control, with no dial control declared', () => {
    expect(issues({ ...thermostat })).not.toContain(undefined);
    const caps = compile(thermostat, [source]);
    expect(caps).not.toContain('sh.dial-control@1');
    expect(caps).toContain('sh.climate-dial@1');
  });
  it('reading the view and writing it back changes nothing, and a change touches only props.dial', () => {
    expect(withThermostatView(thermostat as never, thermostatView(thermostat as never))).toEqual(thermostat);
    const changed = withThermostatView(thermostat as never, { maximum: 90, size: 'page' }) as J;
    expect({ ...changed, props: { ...changed.props, dial: undefined } }).toEqual({ ...thermostat, props: { ...thermostat.props, dial: undefined } });
    expect(changed.props.dial).toMatchObject({ minimum: 45, maximum: 90, size: 'page' });
    expect(compile(changed, [source])).toEqual(compile(thermostat, [source]));
  });
  it('becoming a Range carries the range and size over, and compiles as a dial control', () => {
    const range = fromThermostat(thermostat as never) as J;
    expect(range.props.range).toEqual({ min: 45, max: 95, step: 0.5 });
    expect(range.props.size).toBe('modal');
    expect(compile(range, [source])).toContain('sh.dial-control@1');
  });
});

describe('the thermostat\u2019s own binding', () => {
  const room = (id: string, entity: string, list: string[]) => ({ id, kind: 'model', model: 'climate@1', inputs: { entityId: entity, rangeCommitEntityIds: list, actionEntityId: entity } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (sources: J[], nodes: J[]): any => ({ dataSources: sources, pages: [{ components: nodes }] });
  const at = (index: number) => ['pages', 0, 'components', index];
  it('changes only the entity, keeping the rest of the fan-out list, when nothing else reads the source', () => {
    const node = newThermostat(base, 'one') as J;
    const document = doc([room('one', 'climate.demo_a', ['climate.demo_a', 'climate.demo_b'])], [node]);
    const out = rebindThermostat(document, at(0), node as never, 'climate.demo_c') as { sourceId: string; dataSources: J[] };
    expect(out.sourceId).toBe('one');
    expect(out.dataSources[0].inputs).toEqual({ entityId: 'climate.demo_c', rangeCommitEntityIds: ['climate.demo_c', 'climate.demo_b'], actionEntityId: 'climate.demo_c' });
  });
  it('forks a source another node reads, so the other thermostat does not move', () => {
    const mine = newThermostat(base, 'one') as J, theirs = newThermostat({ ...base, id: 'other' }, 'one') as J;
    const document = doc([room('one', 'climate.demo_a', ['climate.demo_a'])], [mine, theirs]);
    expect(sourceUsedElsewhere(document, at(0), 'one')).toBe(true);
    const out = rebindThermostat(document, at(0), mine as never, 'climate.demo_c') as { sourceId: string; dataSources: J[] };
    expect(out.sourceId).not.toBe('one');
    expect(out.dataSources).toHaveLength(2);
    expect(out.dataSources[0].inputs.entityId).toBe('climate.demo_a');
    expect(out.dataSources.find(item => item.id === out.sourceId)!.inputs.entityId).toBe('climate.demo_c');
  });
  it('a thermostat chosen for an entity reuses the source for that entity, else adds one', () => {
    const document = doc([room('one', 'climate.demo_a', ['climate.demo_a'])], []);
    expect(thermostatFor(document, base, 'climate.demo_a').dataSources).toHaveLength(1);
    const added = thermostatFor(document, base, 'climate.demo_z');
    expect(added.dataSources).toHaveLength(2);
    expect((added.node.props as J).sourceId).toBe(added.dataSources[1].id);
  });
});

describe('remembering a thermostat', () => {
  const source = (entity: string) => ({ id: 'one', kind: 'model', model: 'climate@1', inputs: { entityId: entity, rangeCommitEntityIds: [entity] } });
  it('restores while the source still reads the entity it read, and not after another node rewrote it', () => {
    const node = newThermostat({ ...base, id: 'memory-node' }, 'one') as J;
    rememberThermostat(node as never, [source('climate.demo_a')]);
    expect(recallThermostat('memory-node', [source('climate.demo_a')])).toEqual(node);
    // A shared source rewritten in between: the same id now reads another room.
    expect(recallThermostat('memory-node', [source('climate.demo_b')])).toBeUndefined();
    expect(recallThermostat('memory-node', [])).toBeUndefined();
    expect(recallThermostat('never-remembered', [source('climate.demo_a')])).toBeUndefined();
  });
});
