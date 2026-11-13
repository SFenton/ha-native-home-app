import { describe, expect, it } from 'vitest';
import { importNativeHome, type NativeSnapshot } from '../src/shared/native-preview';
import { nativePresentationVisible } from '../src/shared/native-presentation';
import { createSampleDocument } from '../src/shared/sample';
import { DocumentValidationError, validateDocument } from '../src/shared/schema';
import type { Component, Json, StudioDocument } from '../src/shared/types';
import { choresDocument, legacyChoresDocument } from './fixtures/chores';

const descendants = (items: Component[]): Component[] => items.flatMap(item => [item, ...descendants(item.children ?? [])]);
const nodes = (document: StudioDocument) => descendants([...document.pages.flatMap(page => page.components), ...document.modals.flatMap(modal => modal.components)]);
const find = (document: StudioDocument, key: string, value: Json) => nodes(document).find(node => node.props[key] === value)!;
const command = (value: string): Json => ({ type: 'service', call: {
  domain: 'remote', service: 'send_command', target: 'remote.tv', data: { command: value },
} });
const button = (value: string): Json => ({ action: { type: 'command', command: command(value) } });

function snapshot(): NativeSnapshot {
  return {
    mode: 'live', states: [],
    houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {
      home: { weatherEntityId: 'weather.home', statusChips: [], cameras: [], guestToggles: [{ title: 'Guests', entityId: 'input_boolean.guests' }] },
      security: { alarmEntityId: 'alarm_control_panel.home', controlTiles: [] },
      climate: {
        ecoCriticalEntityId: 'select.critical', ecoAwayEntityId: 'select.away',
        rooms: [{ title: 'Study', occupiedOnlyEntityId: 'input_boolean.occupied', ventEntityIds: [] }],
      },
      chores: { pages: [], quickLinks: [] },
      rooms: {
        lightGroups: [], climateGroups: [], occupancyGroups: [], contactGroups: [],
        pages: [], grid: { items: [] },
        quickLinks: ['media', 'vacuums'].map(id => ({ id, title: id, action: { type: 'navigate', path: id } })),
      },
      media: {
        pageSections: [{ title: 'Media', cards: [{ device: { title: 'TV', entityId: 'media_player.tv' }, remoteId: 'tv' }] }],
        remotes: [{
          id: 'tv', title: 'TV', mediaEntityId: 'media_player.tv', controlEntityId: 'remote.tv', volumeEntityId: 'media_player.volume',
          up: button('up'), pause: button('pause'), play: button('play'),
          keyboard: { action: { type: 'command', command: { type: 'textPrompt' } } },
          volumeDown: button('down'), volumeMute: button('mute'), volumeUp: button('up'),
          power: { label: 'Power', action: { type: 'state', entityId: 'media_player.tv', cases: [
            { states: ['off', 'paused'], command: command('first') },
            { states: ['paused', 'playing'], command: command('second') },
          ], otherwise: command('otherwise') } },
          apps: [{ title: 'App', action: { type: 'state', entityId: 'media_player.tv', cases: [
            { states: ['off'], command: command('wake-app') },
          ], otherwise: command('app') } }],
        }],
      },
      vacuums: { autoCleanControls: [], vacuums: [{
        title: 'Robot', entityId: 'vacuum.robot', batteryEntityId: 'sensor.battery', cleanScript: 'script.clean',
        zones: [{ title: 'Study', entityId: 'input_boolean.study', mapName: 'Study' }],
        dockControls: { dockStatusEntityId: 'sensor.dock', cleanScript: 'script.dock_clean', dryScript: 'script.dock_dry' },
      }] },
    } },
  };
}
const imported = () => importNativeHome(snapshot()).document;

function reject(document: StudioDocument, path: string) {
  try { validateDocument(document); throw new Error('Expected validation to fail'); }
  catch (error) {
    expect(error).toBeInstanceOf(DocumentValidationError);
    expect((error as DocumentValidationError).errors.join('\n')).toContain(path);
  }
}

describe('finite native presentation schema', () => {
  it('accepts actual fully configured imports without repairing data or rejecting service command payloads', () => {
    const document = imported(), before = JSON.stringify(document);
    expect(validateDocument(document)).toEqual(document);
    expect(JSON.stringify(document)).toBe(before);
    const keys = nodes(document).filter(node => node.props.remoteKey === 'power');
    for (const state of ['off', 'paused', 'playing', 'idle']) {
      expect(keys.filter(key => nativePresentationVisible(key, [{ entityId: 'media_player.tv', state }]))).toHaveLength(1);
    }
    expect(find(document, 'remoteKey', 'keyboard').props.disabled).toBe(true);
  });

  it('retains the existing array-backed native-states simulation contract', () => {
    const document = imported(), source = document.dataSources.find(source => source.id === 'native-states')!;
    source.kind = 'static'; delete source.endpoint;
    expect(validateDocument(document)).toEqual(document);
    source.sample = { entities: [] };
    reject(document, 'binding');
  });

  it.each([
    ['current', choresDocument],
    ['legacy', legacyChoresDocument],
  ])('accepts the existing %s offline Chores fixture unchanged', (_name, fixture) => {
    const document = fixture(), before = JSON.stringify(document);
    expect(validateDocument(document)).toEqual(document);
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each([
    ['overlapping cases', (d: StudioDocument) => { nodes(d).filter(node => node.props.remoteKey === 'power')[1].props.excludedStates = []; }, 'excludedStates'],
    ['incomplete otherwise', (d: StudioDocument) => { nodes(d).filter(node => node.props.remoteKey === 'power')[2].props.alternateForStates = ['off']; }, 'alternateForStates'],
    ['different state entities', (d: StudioDocument) => { nodes(d).filter(node => node.props.remoteKey === 'power')[1].props.stateEntityId = 'sensor.other'; }, 'mutually exclusive'],
    ['unconditional duplicate slot', (d: StudioDocument) => { const pad = find(d, 'presentation', 'remote-pad'), key = structuredClone(find(d, 'remoteKey', 'up')); key.id = 'duplicate-up'; pad.children!.push(key); }, 'mutually exclusive'],
    ['case after otherwise', (d: StudioDocument) => { const pad = find(d, 'presentation', 'remote-pad'), key = structuredClone(find(d, 'remoteKey', 'power')); key.id = 'late-case'; pad.children!.push(key); }, 'mutually exclusive'],
    ['mixed case and otherwise', (d: StudioDocument) => { find(d, 'remoteKey', 'power').props.alternateForStates = []; }, 'matchStates'],
    ['blank state', (d: StudioDocument) => { find(d, 'remoteKey', 'power').props.matchStates = [' ']; }, 'matchStates'],
    ['empty case', (d: StudioDocument) => { find(d, 'remoteKey', 'power').props.matchStates = []; }, 'matchStates'],
    ['oversized exclusions', (d: StudioDocument) => { find(d, 'remoteKey', 'power').props.excludedStates = ['x'.repeat(161)]; }, 'excludedStates'],
    ['Apps branch overlap', (d: StudioDocument) => { nodes(d).find(node => node.title === 'App' && node.props.alternateForStates)!.props.alternateForStates = []; }, 'alternateForStates'],
  ])('rejects %s', (_name, update, path) => { const document = imported(); update(document); reject(document, path); });

  it.each([
    ['collection guest group', (d: StudioDocument) => { find(d, 'presentation', 'guest-group').props.collectionKind = 'entities'; }, 'children'],
    ['guest action override', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').action = { type: 'service', domain: 'input_boolean', service: 'toggle', entityId: 'input_boolean.guests' }; }, 'action'],
    ['guest confirmation', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').props.confirmation = 'Confirm'; }, 'confirmation'],
    ['individual guest visibility', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').visibility = { source: 'entity', key: 'input_boolean.guests', operator: 'equals', value: 'on' }; }, 'presentation'],
    ['unsafe guest ID', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').props.entityId = '../guest'; }, 'entityId'],
    ['nontext guest label', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').props.activeText = { command: 'on' }; }, 'activeText'],
    ['wrong bound source endpoint', (d: StudioDocument) => { d.dataSources.find(source => source.id === 'native-states')!.endpoint = 'house-profile'; }, 'binding'],
    ['bound array element', (d: StudioDocument) => { find(d, 'presentation', 'guest-toggle').binding!.path = '0'; }, 'binding'],
    ['foreign state source', (d: StudioDocument) => { find(d, 'remoteKey', 'power').binding = { sourceId: 'native-profile' }; }, 'binding'],
    ['adaptive remote pad', (d: StudioDocument) => { find(d, 'presentation', 'remote-pad').props.adaptive = true; }, 'columns'],
    ['unknown remote container', (d: StudioDocument) => { find(d, 'presentation', 'remote-pad').props.presentation = 'constructor'; }, 'remoteKey'],
    ['object remote container', (d: StudioDocument) => { find(d, 'presentation', 'remote-pad').props.presentation = { toString: 'remote-pad' }; }, 'presentation'],
    ['wrong playback slot', (d: StudioDocument) => { find(d, 'remoteKey', 'pause').props.remoteKey = 'up'; }, 'remoteKey'],
    ['coerced remote key', (d: StudioDocument) => { find(d, 'remoteKey', 'up').props.remoteKey = ['up']; }, 'remoteKey'],
    ['missing remote Action', (d: StudioDocument) => { delete find(d, 'remoteKey', 'up').action; }, 'action'],
    ['invalid ordinary Action', (d: StudioDocument) => { find(d, 'remoteKey', 'up').action = { type: 'service', domain: 'remote', service: 'send_command', entityId: 'script.other' }; }, 'action.entityId'],
    ['cross-remote gating', (d: StudioDocument) => { find(d, 'remoteKey', 'up').props.remoteMediaEntityId = 'media_player.other'; }, 'remoteMediaEntityId'],
    ['non-media volume target', (d: StudioDocument) => { find(d, 'presentation', 'remote-volume').props.entityId = 'sensor.volume'; }, 'entityId'],
    ['captured volume value', (d: StudioDocument) => { find(d, 'presentation', 'remote-volume').props.volumeLevel = .5; }, 'volumeLevel'],
    ['raw compiled command', (d: StudioDocument) => { find(d, 'remoteKey', 'up').props.configuredCommand = { type: 'service' }; }, 'configuredCommand'],
    ['raw nested state adapter', (d: StudioDocument) => { find(d, 'presentation', 'remote-pad').children![0].props.adapter = { configuredStateAction: {} }; }, 'configuredStateAction'],
    ['blank remote sheet title', (d: StudioDocument) => { find(d, 'nativeKind', 'remote-sheet').title = ' '; }, 'nativeKind'],
  ])('rejects %s', (_name, update, path) => { const document = imported(); update(document); reject(document, path); });

  it.each([
    ['duplicate vacuum tab', (d: StudioDocument) => { const root = find(d, 'presentation', 'vacuum-sheet'); root.children![1].props.vacuumTab = 'controls'; }, 'unique'],
    ['missing Controls', (d: StudioDocument) => { const root = find(d, 'presentation', 'vacuum-sheet'); root.children = root.children!.filter(child => child.props.vacuumTab !== 'controls'); }, 'Controls'],
    ['unknown vacuum page', (d: StudioDocument) => { find(d, 'vacuumPage', 'report').props.vacuumPage = 'history'; }, 'vacuumPage'],
    ['coerced vacuum tab', (d: StudioDocument) => { find(d, 'vacuumTab', 'more').props.vacuumTab = ['more']; }, 'vacuumTab'],
    ['dual vacuum section role', (d: StudioDocument) => { find(d, 'vacuumTab', 'info').props.vacuumPage = 'report'; }, 'exactly one'],
    ['room outside zones', (d: StudioDocument) => { const room = find(d, 'vacuumTab', 'zones').children!.pop()!; find(d, 'vacuumTab', 'info').children!.push(room); }, 'nativeKind'],
    ['real room Action', (d: StudioDocument) => { find(d, 'nativeKind', 'vacuum-room').action = { type: 'service', domain: 'input_boolean', service: 'turn_on', entityId: 'input_boolean.study' }; }, 'action'],
    ['room map object', (d: StudioDocument) => { find(d, 'nativeKind', 'vacuum-room').props.mapName = {}; }, 'mapName'],
    ['clean in Dock', (d: StudioDocument) => { const controls = find(d, 'vacuumTab', 'controls'), index = controls.children!.findIndex(child => child.props.vacuumAction === 'clean'); find(d, 'vacuumTab', 'more').children!.push(controls.children!.splice(index, 1)[0]); }, 'vacuumAction'],
    ['ambiguous script service', (d: StudioDocument) => { find(d, 'vacuumAction', 'dockClean').action = { type: 'service', domain: 'script', service: 'toggle', entityId: 'script.dock_clean' }; }, 'script.turn_on'],
    ['coerced vacuum action', (d: StudioDocument) => { find(d, 'vacuumAction', 'dockClean').props.vacuumAction = ['dockClean']; }, 'vacuumAction'],
    ['script Action overridden by destination', (d: StudioDocument) => { find(d, 'vacuumAction', 'clean').props.destinationId = 'somewhere'; }, 'destinationId'],
    ['unsafe battery source', (d: StudioDocument) => { find(d, 'presentation', 'vacuum-sheet').props.batteryEntityId = 'sensor.bad/id'; }, 'batteryEntityId'],
    ['check row on select', (d: StudioDocument) => { find(d, 'choiceList', true).props.checkRow = true; }, 'checkRow'],
    ['nonboolean choice list', (d: StudioDocument) => { find(d, 'choiceList', true).props.choiceList = 'true'; }, 'choiceList'],
    ['choice metadata on an unconfigured placeholder', (d: StudioDocument) => { const choice = find(d, 'choiceList', true); choice.type = 'settings-row'; choice.props = { choiceList: true, entityId: '' }; }, 'choiceList'],
    ['invented choice options', (d: StudioDocument) => { find(d, 'choiceList', true).props.options = ['Invented']; }, 'options'],
    ['checked text without a check row', (d: StudioDocument) => { find(d, 'choiceList', true).props.checkedText = 'Selected'; }, 'checkRow'],
    ['foreign climate destination', (d: StudioDocument) => { find(d, 'nativeKind', 'climate-room').props.destinationId = d.pages[0].id; }, 'destinationId'],
    ['unsafe climate occupancy source', (d: StudioDocument) => { find(d, 'nativeKind', 'climate-room').props.occupancyEntityId = 'binary_sensor.bad/id'; }, 'occupancyEntityId'],
    ['misplaced child chrome', (d: StudioDocument) => { find(d, 'presentation', 'climate-rooms').props.childClose = true; }, 'childClose'],
  ])('rejects %s', (_name, update, path) => { const document = imported(); update(document); reject(document, path); });

  it('leaves legacy native props and ordinary control bindings unchanged unless new metadata is used', () => {
    const document = createSampleDocument();
    document.pages[0].components.push({
      id: 'legacy-control', type: 'action-tile', title: 'Legacy', binding: { sourceId: document.dataSources[0].id },
      props: { presentation: 'control', controlKind: 'light', entityId: 'light.legacy', configuredCommand: { legacy: true } },
    });
    expect(validateDocument(document)).toEqual(document);
    document.pages[0].components.at(-1)!.props.checkRow = true;
    reject(document, 'checkRow');
  });
});
