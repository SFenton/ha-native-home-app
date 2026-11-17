// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { contentSpans, floorMinimum, gridTracks, planGrid, shareOfTracks } from '../src/preview2/grid';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { MAX_CHOICE_OPTIONS, optionsFromList } from '../src/shared/composition/bound-control';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { boundControlShows, withBoundControlFace, withBoundControlKind } from '../src/workspace2/editors/boundControl';
import { optionsFromEntity } from '../src/workspace2/layout/OptionsFromEntity';
import { discWords } from '../src/workspace2/layout/TileParts';

afterEach(cleanup);
type J = Record<string, any>;

/** Options read from an entity's list (`sh.bound-options-read@1`). */
describe('optionsFromList', () => {
  it('keeps the text items in order, once each, and leaves out what is not text or is blank', () => {
    expect(optionsFromList(['quiet', 'standard', 'quiet', '', '  ', 3, null, 'max_plus'], 'as-is')?.map(option => option.value)).toEqual(['quiet', 'standard', 'max_plus']);
  });
  it('draws the words as written or in title case, and keeps the item as the value either way', () => {
    expect(optionsFromList(['quiet', 'max_plus'], 'title-case')).toEqual([{ value: 'quiet', label: 'Quiet' }, { value: 'max_plus', label: 'Max Plus' }]);
    expect(optionsFromList(['quiet', 'max_plus'], 'as-is')).toEqual([{ value: 'quiet', label: 'quiet' }, { value: 'max_plus', label: 'max_plus' }]);
  });
  it('stops at twelve, as an authored choice does', () => {
    expect(optionsFromList(Array.from({ length: 20 }, (_, at) => `mode_${at}`), 'as-is')).toHaveLength(MAX_CHOICE_OPTIONS);
  });
  it('gives nothing, so the authored options stand, for fewer than two usable items or a value that is not a list', () => {
    expect(optionsFromList(['only'], 'as-is')).toBeUndefined();
    expect(optionsFromList(['a', 'a', 7], 'as-is')).toBeUndefined();
    expect(optionsFromList([], 'as-is')).toBeUndefined();
    expect(optionsFromList('quiet', 'as-is')).toBeUndefined();
    expect(optionsFromList(undefined, 'as-is')).toBeUndefined();
  });
});

/** A grid that keeps at least two columns (`sh.grid-min-columns@1`). */
describe('the column floor', () => {
  // A phone page: 390 wide less 16 either side, 12 between cells, a 150 point cell, and a robot tile with two buttons that wants about 300 points.
  const width = 358, gap = 12, robot = 300;
  const across = (minimumColumns?: number) => {
    const tracks = gridTracks(width, floorMinimum(width, 150, minimumColumns, gap), 4, gap);
    const narrowest = Math.min(...tracks.tracks.map(track => track.width));
    const spans = contentSpans([undefined, undefined], [robot, robot], narrowest, tracks.columns, gap).map(span => Math.min(span, shareOfTracks(tracks.columns, minimumColumns)));
    return planGrid(spans, tracks.columns).spans;
  };
  it('puts two robot tiles in a row of two columns, where without the floor each takes the row', () => {
    expect(across()).toEqual([2, 2]);
    expect(across(2)).toEqual([1, 1]);
  });
  it('lowers the cell minimum to what the columns leave each, and never raises it', () => {
    expect(floorMinimum(358, 150, 2, 12)).toBe(150);
    expect(floorMinimum(300, 150, 2, 12)).toBe(144);
    expect(floorMinimum(300, 150, undefined, 12)).toBe(150);
    expect(floorMinimum(0, 150, 2, 12)).toBe(150);
  });
  it('keeps two columns on a window too narrow for two cells of the minimum', () => {
    expect(gridTracks(280, floorMinimum(280, 150, 2, 12), 4, 12).columns).toBe(2);
    expect(gridTracks(280, 150, 4, 12).columns).toBe(1);
  });
  it('lets a tile take its share of the tracks: half of four with a floor of two, the row with none', () => {
    expect(shareOfTracks(4, 2)).toBe(2);
    expect(shareOfTracks(2, 2)).toBe(1);
    expect(shareOfTracks(4, 4)).toBe(1);
    expect(shareOfTracks(4, undefined)).toBe(4);
  });
});

/** The capabilities each group names. */
describe('the capability each part needs', () => {
  const corpus = path.resolve(__dirname, '../contract/corpus');
  const index = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8')) as { cases: { file: string; outcome: string }[] };
  const accepted = (family: string) => index.cases.filter(item => item.outcome === 'accept' && item.file.startsWith(`accept/parts-${family}-`))
    .map(item => ({ file: item.file, capabilities: JSON.parse(readFileSync(path.join(corpus, item.file), 'utf8')).capabilities as string[] }));
  const ids = ['sh.bound-options-read@1', 'sh.bound-row-parts@1', 'sh.check-face@1', 'sh.grid-min-columns@1', 'sh.tile-disc-rules@1'];
  it.each([['options', 'sh.bound-options-read@1'], ['disc', 'sh.tile-disc-rules@1'], ['columns', 'sh.grid-min-columns@1'], ['row', 'sh.bound-row-parts@1']])
  ('%s: every accepted case needs its own id, and no other of the five', (family, id) => {
    const cases = accepted(family);
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) expect(item.capabilities.filter(name => ids.includes(name)), item.file).toEqual([id]);
  });
  it('check: every accepted case needs the check face; the hint and the failure caption of its row are the row parts', () => {
    const cases = accepted('check');
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      const found = item.capabilities.filter(name => ids.includes(name));
      expect(found, item.file).toContain('sh.check-face@1');
      expect(found.filter(name => name !== 'sh.check-face@1' && name !== 'sh.bound-row-parts@1'), item.file).toEqual([]);
    }
    expect(cases.find(item => item.file.endsWith('check-success-tint.json'))?.capabilities.includes('sh.bound-row-parts@1')).toBe(false);
  });
  it('options also need the list read they stand on', () => {
    for (const item of accepted('options')) expect(item.capabilities).toContain('sh.list-read@1');
  });
});

// MARK: Drawing
const home = homeDomains.document as unknown as CompositionDocument;
const lit = (value: unknown): J => ({ type: 'literal', value });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const is = (sourceId: string, ...states: string[]): J => ({ type: 'state', sourceId, path: ['state'], in: states });
const call = (domain: string, service: string, data?: J): J => ({ type: 'call-service', domain, service, feedback: 'policy', target: { entity_id: lit('select.demo_speed') }, ...(data ? { data } : {}) });
const sources = [
  { id: 'robot', kind: 'ha-entity', entityId: lit('vacuum.demo_robot') }, { id: 'speed', kind: 'ha-entity', entityId: lit('select.demo_speed') },
  { id: 'clean', kind: 'ha-entity', entityId: lit('input_boolean.demo_clean') },
];
function draw(components: J[], states: J[], mode: 'edit' | 'use' = 'use', selection?: string) {
  const base = home.pages[0];
  const document = { ...home, dataSources: [...home.dataSources, ...sources], navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  const onSelect = vi.fn();
  const view = render(<Preview2 document={document} mode={mode} surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={onSelect} selection={selection as never}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: states as never })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
  return view.container;
}
const speedOptions = (rest: J = {}): J => ({ from: { type: 'source', sourceId: 'speed', path: ['attributes', 'options'] }, current: { type: 'read', from: { type: 'source', sourceId: 'speed', path: ['state'] }, as: 'string', missing: 'unavailable' },
  labels: 'title-case', action: call('select', 'select_option', { type: 'object', fields: { option: { type: 'control' } } }), ...rest });
const fallback = ['quiet', 'standard'].map(id => ({ id, label: id === 'quiet' ? 'Quiet' : 'Standard', selectedWhen: is('speed', id), action: call('select', 'select_option') }));
const choice = (props: J = {}): J => ({ id: 'speed-choice', title: 'Speed', type: 'bound-control', layout: { span: 1 }, props: { kind: 'choice', options: fallback, unavailableText: 'Unavailable', ...props } });
const radios = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-sel="node:speed-choice"] [role=radio]')].map(item => ({ text: item.textContent, on: item.getAttribute('aria-checked') }));

describe('a choice that reads its options from an entity', () => {
  it('draws the entity\'s own options in title case with the one it holds chosen', () => {
    const container = draw([choice({ optionsFrom: speedOptions() })], [{ entityId: 'select.demo_speed', name: 'Speed', state: 'max_plus', options: ['quiet', 'standard', 'max_plus'] }]);
    expect(radios(container)).toEqual([{ text: 'Quiet', on: 'false' }, { text: 'Standard', on: 'false' }, { text: 'Max Plus', on: 'true' }]);
  });
  it('draws the authored options while the entity lists fewer than two, or none', () => {
    expect(radios(draw([choice({ optionsFrom: speedOptions() })], [{ entityId: 'select.demo_speed', name: 'Speed', state: 'standard', options: ['only'] }])).map(item => item.text)).toEqual(['Quiet', 'Standard']);
    cleanup();
    expect(radios(draw([choice({ optionsFrom: speedOptions() })], [{ entityId: 'select.demo_speed', name: 'Speed', state: 'standard' }]))).toEqual([{ text: 'Quiet', on: 'false' }, { text: 'Standard', on: 'true' }]);
  });
  it('draws the authored options as before when it reads nothing', () => {
    expect(radios(draw([choice()], [{ entityId: 'select.demo_speed', name: 'Speed', state: 'quiet', options: ['x', 'y', 'z'] }]))).toEqual([{ text: 'Quiet', on: 'true' }, { text: 'Standard', on: 'false' }]);
  });
});

describe('a state tile button that follows a rule', () => {
  const tile = (disc: J): J => ({ id: 'main', title: 'Main Floor', type: 'state-tile', layout: { span: 1 }, icon: symbol('fan'), binding: { entityId: 'vacuum.demo_robot', builtIn: 'robot' }, props: { discs: [disc] } });
  const start = (rest: J = {}): J => ({ id: 'start', icon: symbol('play.fill'), label: 'Start', action: call('vacuum', 'start'), ...rest });
  const button = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-sel="node:main"] .sh-tile-disc, .sh-tile-disc')!;
  const robot = (state: string): J[] => [{ entityId: 'vacuum.demo_robot', name: 'Robot', state }];
  const verb: J = { type: 'expr', value: { type: 'choose', otherwise: lit('Start'), cases: [{ when: is('robot', 'cleaning'), then: lit('Pause') }, { when: is('robot', 'paused'), then: lit('Resume') }] } };
  const rule: J = { type: 'conditional', cases: [{ when: is('robot', 'cleaning'), then: symbol('pause.fill') }], otherwise: symbol('play.fill') };

  it('draws pause while the robot cleans and play otherwise', () => {
    const cleaning = button(draw([tile(start({ icon: rule }))], robot('cleaning'))).innerHTML;
    cleanup();
    const docked = button(draw([tile(start({ icon: rule }))], robot('docked'))).innerHTML;
    expect(cleaning).not.toEqual(docked);
    cleanup();
    expect(button(draw([tile(start({ icon: symbol('pause.fill') }))], robot('docked'))).innerHTML).toEqual(cleaning);
  });
  it('reads the label from its expression, and adds the tile\'s title when asked', () => {
    expect(button(draw([tile(start({ label: verb }))], robot('paused'))).getAttribute('aria-label')).toBe('Resume');
    cleanup();
    expect(button(draw([tile(start({ label: verb, namesTile: true }))], robot('cleaning'))).getAttribute('aria-label')).toBe('Pause Main Floor');
    cleanup();
    expect(button(draw([tile(start({ namesTile: true }))], robot('docked'))).getAttribute('aria-label')).toBe('Start Main Floor');
  });
  it('keeps a plain label exactly as it was', () => {
    expect(button(draw([tile(start())], robot('docked'))).getAttribute('aria-label')).toBe('Start');
    expect(discWords({ label: 'Start' })).toBe('Start');
    expect(discWords({ label: lit('Start') as never })).toBe('Start');
    expect(discWords({ label: verb as never })).toBe('Button');
  });
});

describe('a toggle row with its parts', () => {
  const on = (id: string) => ({ type: 'call-service', domain: 'homeassistant', service: 'toggle', feedback: 'policy', target: { entity_id: lit(id) } });
  const row = (props: J = {}, rest: J = {}): J => ({ id: 'auto', title: 'Auto-Clean', type: 'bound-control', layout: { span: 1 }, icon: symbol('clock.arrow.circlepath'),
    props: { kind: 'toggle', isOn: is('clean', 'on'), unavailableText: 'Unavailable', ...props }, onAction: on('input_boolean.demo_clean'), offAction: on('input_boolean.demo_clean'), ...rest });
  const states = (state: string): J[] => [{ entityId: 'input_boolean.demo_clean', name: 'Clean', state }];
  const node = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-sel="node:auto"] .sh-control, .sh-control')!;
  it('draws a subtitle that follows its expression under the title, the glyph in its tint and the row size', () => {
    const subtitle = { type: 'expr', value: { type: 'choose', otherwise: lit('Off'), cases: [{ when: is('clean', 'on'), then: lit('Paused') }] } };
    const container = draw([row({ subtitle, glyph: { type: 'solid-rgb', red: 175, green: 82, blue: 222 }, metrics: 'module' })], states('on'));
    expect(node(container).querySelector('.sh-row-secondary')?.textContent).toBe('Paused');
    expect(node(container).getAttribute('data-metrics')).toBe('module');
    expect(node(container).getAttribute('style')).toContain('rgb(175 82 222)');
  });
  it('describes the switch with the hint, and with the unavailable text while it cannot be used', () => {
    const hint = (container: HTMLElement) => document.getElementById(node(container).querySelector('[role=switch]')!.getAttribute('aria-describedby')!)?.textContent;
    expect(hint(draw([row({ hint: 'Turns automatic cleaning on or off.' })], states('on')))).toBe('Turns automatic cleaning on or off.');
    cleanup();
    const gated = { condition: is('clean', 'off'), whenUnknown: 'disabled' };
    expect(hint(draw([row({ hint: 'Turns automatic cleaning on or off.' }, { enabledWhen: gated })], states('on')))).toBe('Unavailable');
  });
  it('shows the failure caption in Edit while the row is selected, and never in Use', () => {
    const caption = (container: HTMLElement) => container.querySelector('[data-testid="failure-caption"]')?.textContent;
    expect(caption(draw([row({ failureText: 'Automatic cleaning did not respond.' })], states('on'), 'edit', 'node:auto'))).toBe('Automatic cleaning did not respond.');
    cleanup();
    expect(caption(draw([row({ failureText: 'Automatic cleaning did not respond.' })], states('on'), 'use', 'node:auto'))).toBeUndefined();
    cleanup();
    expect(caption(draw([row({ failureText: 'Automatic cleaning did not respond.' })], states('on'), 'edit'))).toBeUndefined();
  });
  it('draws a check face as a checkbox that follows the entity, in its tint, described by the hint', () => {
    const check = (container: HTMLElement) => container.querySelector<HTMLElement>('[role=checkbox]')!;
    const face = { face: 'check', hint: 'Includes the room.', checkTint: 'action' };
    const checked = draw([row(face, { icon: undefined })], states('on'));
    expect(check(checked).getAttribute('aria-checked')).toBe('true');
    expect(node(checked).getAttribute('data-face')).toBe('check');
    expect(node(checked).getAttribute('style')).toContain('--action');
    expect(document.getElementById(check(checked).getAttribute('aria-describedby')!)?.textContent).toBe('Includes the room.');
    cleanup();
    expect(check(draw([row(face, { icon: undefined })], states('off'))).getAttribute('aria-checked')).toBe('false');
    cleanup();
    expect(node(draw([row({ ...face, checkTint: 'success' }, { icon: undefined })], states('on'))).getAttribute('style')).toContain('--ok');
  });
});

// MARK: Authoring
describe('the editor helpers', () => {
  const doc = (node: J) => ({ pages: [{ components: [node] }] }) as unknown as CompositionDocument;
  const at = ['pages', 0, 'components', 0];
  const toggle = { type: 'bound-control', id: 'a', icon: symbol('bolt'), props: { kind: 'toggle', hint: 'h', subtitle: lit('s'), glyph: { type: 'solid-rgb', red: 1, green: 2, blue: 3 }, metrics: 'form', face: 'switch', checkTint: 'action', failureText: 'f' } };
  it('drops a toggle row\'s parts when the kind changes, and the entity options when it is no longer a choice', () => {
    const stepper = (withBoundControlKind(doc(toggle), at, 'stepper') as never as { pages: { components: { props: J }[] }[] }).pages[0].components[0].props;
    expect(Object.keys(stepper)).toEqual(['kind']);
    const choiceNode = { type: 'bound-control', id: 'c', props: { kind: 'choice', optionsFrom: speedOptions(), options: fallback, hint: 'h' } };
    // A hint is a toggle row's part, so it stays; the entity's options are a choice's and go.
    expect(Object.keys((withBoundControlKind(doc(choiceNode), at, 'toggle') as never as { pages: { components: { props: J }[] }[] }).pages[0].components[0].props).sort()).toEqual(['hint', 'kind']);
  });
  it('drops the icon, subtitle, glyph tint and size for a check face, and the check color when going back to a switch', () => {
    const checked = (withBoundControlFace(doc(toggle), at, 'check') as never as { pages: { components: J[] }[] }).pages[0].components[0];
    expect(checked.icon).toBeUndefined();
    expect(checked.props).toEqual({ kind: 'toggle', hint: 'h', face: 'check', checkTint: 'action', failureText: 'f' });
    const back = (withBoundControlFace(doc(checked), at, 'switch') as never as { pages: { components: J[] }[] }).pages[0].components[0];
    expect(back.props).toEqual({ kind: 'toggle', hint: 'h', face: 'switch', failureText: 'f' });
  });
  it('shows a row part only on a toggle drawn as a row, the check color only on a check face, and the entity options only on a choice', () => {
    const shown = (node: J, field: string) => boundControlShows(doc(node), at, [...at, 'props', field]);
    expect(shown(toggle, 'subtitle')).toBe(true);
    expect(shown({ ...toggle, props: { ...toggle.props, surface: 'tile' } }, 'subtitle')).toBe(false);
    expect(shown({ ...toggle, props: { kind: 'stepper' } }, 'subtitle')).toBe(false);
    expect(shown(toggle, 'checkTint')).toBe(false);
    expect(shown({ ...toggle, props: { ...toggle.props, face: 'check' } }, 'checkTint')).toBe(true);
    expect(shown({ ...toggle, props: { ...toggle.props, face: 'check' } }, 'subtitle')).toBe(false);
    expect(shown({ ...toggle, props: { ...toggle.props, face: 'check' } }, 'hint')).toBe(true);
    expect(boundControlShows(doc({ ...toggle, props: { ...toggle.props, face: 'check' } }), at, [...at, 'icon'])).toBe(false);
    expect(shown({ type: 'bound-control', props: { kind: 'choice' } }, 'optionsFrom')).toBe(true);
    expect(shown(toggle, 'optionsFrom')).toBe(false);
  });
  it('writes a reading the compiler accepts for a picked select', () => {
    const reading = optionsFromEntity('select.demo_speed', 'speed');
    const document = { ...home, dataSources: [...home.dataSources, ...sources], navigation: { ...home.navigation, tabs: [], initialPageId: home.pages[0].id, initialTabId: null },
      pages: [{ ...home.pages[0], toolbar: { type: 'inherit' }, components: [choice({ optionsFrom: reading })] }], modals: [] } as unknown as CompositionDocument;
    const compiled = compileCompositionDocument(document);
    expect(compiled.capabilities).toContain('sh.bound-options-read@1');
    expect(reading.action).toMatchObject({ domain: 'select', service: 'select_option', data: { fields: { option: { type: 'control' } } } });
    const broken = { ...document, pages: [{ ...document.pages[0], components: [choice({ optionsFrom: { ...reading, from: { ...reading.from, path: ['state'] } } })] }] } as unknown as CompositionDocument;
    expect(() => compileCompositionDocument(broken)).toThrow(CompositionValidationError);
  });
});
