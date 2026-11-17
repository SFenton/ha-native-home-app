import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors } from '../src/composition-editor';
import { makeMap, paletteGroups, paletteTypes, robotsOf, tileType, tileTypes } from '../src/workspace2/add/catalog';
import { endOf, insertMade, insertType, type Destination } from '../src/workspace2/add/insert';
import { newRobotSource, robotComplete, robotDescriptor, type RobotParts } from '../src/workspace2/data/robot';
import { typeName } from '../src/workspace2/util';

const home = (JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
const where = endOf(home, 'page:page-home') as Destination;
const parts: RobotParts = {
  title: 'Example Robot', vacuumMapId: 'example_robot', entityId: 'vacuum.example_robot', batteryEntityId: 'sensor.example_battery', errorEntityId: 'sensor.example_error',
  statusEntityId: 'sensor.example_status', statusFlagEntityId: 'input_text.example_flag', passesEntityId: 'input_select.example_passes', cleanScript: 'script.example_clean',
};

describe('the catalog is keyed by what an entry is', () => {
  it('has one entry per key, and Command, Choice, Readout and Map are not new node types', () => {
    const keys = tileTypes.map(entry => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(['command', 'choice', 'toggle'].map(key => tileType(key)?.type)).toEqual(['bound-control', 'bound-control', undefined]);
    expect(tileType('readout')?.type).toBe('status-pill');
    expect(tileType('map')?.type).toBe('vacuum-control');
  });
  it('lists every palette key in a group and every key in the catalog', () => {
    for (const key of paletteTypes.components.concat(paletteTypes.controls)) expect(tileType(key), key).toBeTruthy();
    expect(paletteGroups.components.map(group => group.title)).toEqual(['Layout', 'Tiles', 'Content']);
    expect(paletteGroups.controls.map(group => group.title)).toEqual(['Controls']);
  });
  it('adds a Choice with two choices and a Readout of an entity, both compiling', () => {
    const choice = insertType(home, where, 'choice').document;
    expect(compositionErrors(choice)).toEqual([]);
    const readout = insertType(home, where, 'readout', { entityId: 'sensor.example_battery', name: 'Battery' }).document;
    expect(compositionErrors(readout)).toEqual([]);
    expect(readout.dataSources.length).toBe(home.dataSources.length + 1);
  });
  it('starts a Command as a button that calls a service, with no entity chosen yet', () => {
    const made = insertType(home, where, 'command').document;
    const node = made.pages[0].components.find(item => item.id.startsWith('command-')) as unknown as { props: { kind: string }; action: { service: string } };
    expect(node.props.kind).toBe('button');
    expect(node.action.service).toBe('turn_on');
    expect(compositionErrors(made)).toEqual([]);
  });
  it('names the nodes by what they are', () => {
    const map = makeMap('s', 'Rosie').node;
    expect(typeName(map)).toBe('Map');
  });
});

describe('Map of a robot', () => {
  it('needs every part and a map id of lowercase words before a robot exists', () => {
    expect(robotComplete(parts)).toBe(true);
    expect(robotComplete({ ...parts, cleanScript: '' })).toBe(false);
    expect(robotComplete({ ...parts, vacuumMapId: 'Example Robot' })).toBe(false);
    expect(robotComplete({ ...parts, title: ' ' })).toBe(false);
  });
  it('adds the robot and its map in one document that compiles, and lists the robot afterwards', () => {
    const source = newRobotSource(home, parts);
    const made = makeMap(source.id, parts.title);
    const { document } = insertMade(home, where, { ...made, sources: [source] });
    expect(compositionErrors(document)).toEqual([]);
    expect(robotsOf(document)).toEqual([{ sourceId: source.id, title: 'Example Robot', entityId: 'vacuum.example_robot' }]);
    expect(robotDescriptor(parts).mapScale).toBe(1);
  });
  it('gives a second robot with the same map id its own source id', () => {
    const first = newRobotSource(home, parts);
    const second = newRobotSource({ ...home, dataSources: [...home.dataSources, first] }, parts);
    expect(second.id).not.toBe(first.id);
  });
});
