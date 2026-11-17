import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

/**
 * The format fields the condition and value editors need (`enabledWhen`, tile looks, bound colors and symbols, text fallbacks, badges, an action chosen
 * by rule, `confirmation.when`, `fallbackTabId`, the list parts): schema, compiler rules, capability ids and the issue code and pointer of each refusal.
 * The expectations are written here by hand; the corpus (`contract/corpus`) pins the same cases for the app.
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const rgb = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const STANDARD: J = { type: 'standard' };
const hot = cmp('above', read('temp', ['state'], 'number'), lit(75));
const push = (pageId = 'page-lattice'): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const call = (extra: J = {}): J => ({ type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, ...extra });
const node = (type: string, rest: J, id = 'n'): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const row = (rest: J = {}): J => node('row', { props: { primary: lit('Lamp'), secondary: lit(''), value: lit(''), accessory: 'none', loadingText: 'Loading', unavailableText: 'Unavailable' }, ...rest });
const button = (rest: J = {}): J => node('primary-button', { props: {}, action: push(), ...rest });
const stateTile = (rest: J = {}): J => node('state-tile', { icon: symbol('lock'), binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props: {}, ...rest });
const navTile = (presentation?: J, rest: J = {}): J => node('navigation-tile', { icon: symbol('house'), props: { family: 'neutral', selected: 'none', subtitle: lit('x'), ...(presentation ? { presentation } : {}) }, action: push(), ...rest });
const chip = (appearance: J, rest: J = {}): J => node('status-chip', { props: { sourceId: 'lights', states: [{ state: 'active', appearance }], fallback: { icon: symbol('lightbulb'), fill: STANDARD }, announcement: 'none' }, ...rest });
const text = (value: J): J => node('text', { props: { value, style: 'body', unavailableText: 'None' } });
const rule = (cases: [J, J][], otherwise: J): J => ({ type: 'conditional', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  { id: 'lights', kind: 'model', model: 'home-status@1', inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
    labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' } },
];
function compile(components: J[], tweak?: (document: J) => void) {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...sources);
  tweak?.(document);
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] as CompositionIssue[] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [] as string[], issues: error.issues }; }
}
/** The first issue as `code pointer`, the pointer relative to the first component. */
const first = (result: { issues: CompositionIssue[] }) => result.issues.length ? `${result.issues[0].code} ${result.issues[0].pointer.replace('/document/pages/2/components/0', '~')}` : 'none';
const needs = (components: J[], tweak?: (document: J) => void) => { const result = compile(components, tweak); expect(result.issues).toEqual([]); return result.capabilities; };

describe('enabledWhen (sh.enabled-when@1)', () => {
  it('is accepted on a row with an action, a button, a bound control and a state tile, and names its capability', () => {
    for (const item of [row({ action: push(), enabledWhen: { condition: hot, whenUnknown: 'disabled' } }), button({ enabledWhen: { condition: hot, whenUnknown: 'keep' } }),
      node('bound-control', { props: { kind: 'button', unavailableText: 'x' }, action: call(), enabledWhen: { condition: hot, whenUnknown: 'enabled' } }),
      stateTile({ enabledWhen: { condition: hot, whenUnknown: 'disabled' } })]) {
      const capabilities = needs([item]);
      expect(capabilities).toEqual(expect.arrayContaining(['sh.enabled-when@1', 'sh.conditions@1']));
    }
  });
  it('is not required by a document that does not use it', () => {
    expect(needs([button()])).not.toContain('sh.enabled-when@1');
  });
  it('refuses a row with no action to enable, a missing or wrong policy, a node that has none, and a condition that reads nothing', () => {
    expect(first(compile([row({ enabledWhen: { condition: hot, whenUnknown: 'disabled' } })]))).toBe('invalid_combination ~/enabledWhen');
    expect(first(compile([button({ enabledWhen: { condition: hot } })]))).toBe('missing_required ~/enabledWhen/whenUnknown');
    expect(first(compile([button({ enabledWhen: { condition: hot, whenUnknown: 'show' } })]))).toBe('unknown_variant ~/enabledWhen/whenUnknown');
    expect(first(compile([text(lit('x')).constructor === Object ? { ...text(lit('x')), enabledWhen: { condition: hot, whenUnknown: 'enabled' } } : text(lit('x'))]))).toBe('unknown_field ~/enabledWhen');
    expect(first(compile([button({ enabledWhen: { condition: cmp('above', read('missing', ['state'], 'number'), lit(1)), whenUnknown: 'enabled' } })])))
      .toBe('invalid_reference ~/enabledWhen/condition/left/from/sourceId');
  });
});

describe('tile look conditions (sh.tile-look@1)', () => {
  it('takes activeWhen, filledWhen and errorWhen on a state tile only', () => {
    expect(needs([stateTile({ activeWhen: hot, filledWhen: hot, errorWhen: hot })])).toContain('sh.tile-look@1');
    expect(needs([stateTile()])).not.toContain('sh.tile-look@1');
    expect(first(compile([navTile(undefined, { activeWhen: hot })]))).toBe('unknown_field ~/activeWhen');
    expect(first(compile([stateTile({ errorWhen: cmp('above', read('missing', ['state'], 'number'), lit(1)) })]))).toBe('invalid_reference ~/errorWhen/left/from/sourceId');
  });
});

describe('bound-color, bound-symbol and the text fallback (sh.rules@1)', () => {
  const bound = (fallback: J, value = read('temp', ['state'])): J => ({ type: 'bound-color', value, fallback });
  it('takes a bound color with a required fallback on a chip fill and glyph, a navigation tile fill and a room card state color', () => {
    expect(needs([chip({ icon: symbol('house'), fill: bound(STANDARD), glyph: bound(rgb(1, 2, 3)) })])).toContain('sh.rules@1');
    expect(needs([navTile({ layout: 'standard', titleLines: 1, fill: bound(rgb(1, 2, 3)) })])).toContain('sh.rules@1');
    needs([node('room-card', { icon: symbol('house'), binding: { sourceId: 'temp', projection: 'room-state@1' }, props: {
      kind: 'light', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [], stateColors: [{ state: 'on', fill: bound(rgb(1, 2, 3)) }] } })]);
  });
  it('takes a conditional fill on a navigation tile and keeps its family rule: only a neutral tile may be filled', () => {
    expect(needs([navTile({ layout: 'standard', titleLines: 1, fill: rule([[hot, rgb(1, 2, 3)]], STANDARD) })])).toEqual(expect.arrayContaining(['sh.rules@1', 'sh.conditions@1']));
    const lights = navTile({ layout: 'standard', titleLines: 1, fill: bound(rgb(1, 2, 3)) }); lights.props.family = 'lights';
    expect(first(compile([lights]))).toBe('invalid_combination ~/props/family');
  });
  it('refuses a missing fallback, a glyph fallback that is not exact, a number value, an unknown source and a bound color inside a conditional', () => {
    expect(first(compile([chip({ icon: symbol('house'), fill: { type: 'bound-color', value: read('temp', ['state']) } })]))).toBe('missing_required ~/props/states/0/appearance/fill/fallback');
    expect(first(compile([chip({ icon: symbol('house'), fill: STANDARD, glyph: bound(STANDARD) })]))).toBe('unknown_variant ~/props/states/0/appearance/glyph/fallback/type');
    expect(first(compile([chip({ icon: symbol('house'), fill: bound(STANDARD, read('temp', ['state'], 'number')) })]))).toBe('binding_type ~/props/states/0/appearance/fill/value');
    expect(first(compile([chip({ icon: symbol('house'), fill: bound(STANDARD, read('missing', ['state'])) })]))).toBe('invalid_reference ~/props/states/0/appearance/fill/value/from/sourceId');
    expect(first(compile([chip({ icon: symbol('house'), fill: rule([[hot, bound(STANDARD)]], STANDARD) })]))).toBe('unknown_variant ~/props/states/0/appearance/fill/cases/0/then/type');
  });
  it('takes a bound symbol with a required fallback on an icon, and nowhere else', () => {
    const named = (extra: J = {}): J => ({ type: 'bound-symbol', value: read('temp', ['state']), fallback: symbol('lightbulb'), ...extra });
    expect(needs([chip({ icon: named(), fill: STANDARD })])).toContain('sh.rules@1');
    expect(first(compile([chip({ icon: { type: 'bound-symbol', value: read('temp', ['state']) }, fill: STANDARD })]))).toBe('missing_required ~/props/states/0/appearance/icon/fallback');
    expect(first(compile([chip({ icon: named({ value: read('temp', ['state'], 'number') }), fill: STANDARD })]))).toBe('binding_type ~/props/states/0/appearance/icon/value');
    expect(first(compile([chip({ icon: symbol('house'), fill: STANDARD, glyph: named() })]))).toBe('unknown_variant ~/props/states/0/appearance/glyph/type');
  });
  it('takes a fallback text on expr and read slots, requiring sh.rules@1 only when it is there', () => {
    expect(needs([text({ ...read('temp', ['state']), fallback: 'No reading' })])).toContain('sh.rules@1');
    expect(needs([text({ type: 'expr', value: read('temp', ['state']), fallback: 'No reading' })])).toContain('sh.rules@1');
    expect(needs([text(read('temp', ['state']))])).not.toContain('sh.rules@1');
    expect(first(compile([text({ type: 'literal', value: 'a', fallback: 'b' })]))).toBe('unknown_field ~/props/value/fallback');
    expect(first(compile([text({ type: 'expr', value: read('temp', ['state']), fallback: 'x'.repeat(16385) })]))).toBe('limit_exceeded ~/props/value/fallback');
    expect(first(compile([row({ props: { primary: { type: 'expr', value: read('temp', ['state']), fallback: '' }, secondary: lit(''), value: lit(''), accessory: 'none', loadingText: 'a', unavailableText: 'b' } })])))
      .toBe('invalid_value ~/props/primary/fallback');
  });
});

describe('badges (sh.badges@1)', () => {
  const value = (operand: J): J => ({ type: 'value', value: operand });
  it('takes none or a value on a chip, a navigation tile, a state tile, a tab and a header button', () => {
    expect(needs([chip({ icon: symbol('house'), fill: STANDARD }, { badge: value(read('lights', ['count'], 'number')) })])).toEqual(expect.arrayContaining(['sh.badges@1', 'sh.home-status-counts@1']));
    expect(needs([navTile(undefined, { badge: value(lit('New')) }), stateTile({ id: 'm', badge: { type: 'none' } })])).toContain('sh.badges@1');
    expect(needs([], document => { document.navigation.tabs[0].badge = value(lit(2)); })).toContain('sh.badges@1');
    expect(needs([], document => { document.navigation.chrome.groups[1].items[0].badge = value(lit(2)); })).toContain('sh.badges@1');
  });
  it('keeps the shipped header button badge, none, free of the new capability', () => {
    expect(needs([])).not.toContain('sh.badges@1');
  });
  it('refuses a boolean or a list value, none with a value, a node that has no badge and an unknown source', () => {
    expect(first(compile([navTile(undefined, { badge: value(read('temp', ['state'], 'boolean')) })]))).toBe('binding_type ~/badge/value');
    expect(first(compile([navTile(undefined, { badge: value({ type: 'list', items: [lit(1)] }) })]))).toBe('binding_type ~/badge/value');
    expect(first(compile([navTile(undefined, { badge: { type: 'none', value: lit(1) } })]))).toBe('unknown_field ~/badge/value');
    expect(first(compile([{ ...text(lit('x')), badge: value(lit(1)) }]))).toBe('unknown_field ~/badge');
    expect(first(compile([navTile(undefined, { badge: value(read('missing', ['state'], 'number')) })]))).toBe('invalid_reference ~/badge/value/from/sourceId');
  });
});

describe('an action chosen by rule (sh.action-rules@1)', () => {
  it('is accepted on a row, a button, a navigation tile, a list row and a header button, with otherwise an action or none', () => {
    expect(needs([row({ action: rule([[hot, push()]], push('page-echo')) })])).toEqual(expect.arrayContaining(['sh.action-rules@1', 'sh.conditions@1']));
    needs([button({ action: rule([[hot, call()]], { type: 'none' }) })]);
    needs([navTile(undefined, { action: rule([[hot, push()]], push('page-echo')) })]);
    expect(needs([], document => { document.navigation.chrome.groups[1].items[0].action = rule([[hot, push()]], { type: 'none' }); })).toContain('sh.action-rules@1');
  });
  it('is not required by a plain action', () => {
    expect(needs([button()])).not.toContain('sh.action-rules@1');
  });
  it('checks each case like a plain action: the page exists and a power action stays off a row', () => {
    expect(first(compile([button({ action: rule([[hot, push('page-missing')]], { type: 'none' }) })]))).toBe('invalid_reference ~/action/cases/0/then/pageId');
    expect(first(compile([button({ action: rule([[hot, push()]], push('page-missing')) })]))).toBe('invalid_reference ~/action/otherwise/pageId');
    const domain: J = { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } };
    expect(first(compile([row({ action: rule([[hot, domain]], { type: 'none' }) })]))).toBe('invalid_combination ~/action/cases/0/then/type');
  });
  it('allows one level only, and needs cases and an otherwise', () => {
    expect(compile([button({ action: rule([[hot, rule([[hot, push()]], { type: 'none' })]], push()) })]).issues).not.toEqual([]);
    expect(first(compile([button({ action: rule([], push()) })]))).toBe('limit_exceeded ~/action/cases');
    expect(compile([button({ action: { type: 'conditional', cases: [{ when: hot, then: push() }] } })]).issues).not.toEqual([]);
    expect(compile([button({ action: rule(Array.from({ length: 17 }, () => [hot, push()] as [J, J]), push()) })]).issues).not.toEqual([]);
    expect(compile([button({ action: rule(Array.from({ length: 16 }, () => [hot, push()] as [J, J]), push()) })]).issues).toEqual([]);
  });
  it('is refused where the node takes a power action only', () => {
    expect(compile([node('action-tile', { icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: {
      family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' }, action: rule([[hot, push()]], { type: 'none' }) })]).issues).not.toEqual([]);
  });
  it('counts the pages a rule can open in the chrome limits, so a push inside a case is walked like a plain one', () => {
    expect(compile([button({ action: rule([[hot, push('page-echo')]], { type: 'none' }) })]).issues).toEqual([]);
  });
});

describe('confirmation.when (sh.confirm-when@1)', () => {
  const ask = (when?: J, type = 'additional'): J => type === 'policy' ? { type: 'policy', ...(when ? { when } : {}) }
    : { type: 'additional', style: 'alert', title: 'Turn on?', confirmLabel: 'Turn On', cancelLabel: 'Cancel', destructive: false, ...(when ? { when } : {}) };
  it('takes a condition on an additional confirmation of a service call and of a power action', () => {
    expect(needs([button({ action: call({ confirmation: ask(hot) }) })])).toEqual(expect.arrayContaining(['sh.confirm-when@1', 'sh.conditions@1']));
    const domain: J = { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: ask(hot) };
    expect(needs([node('action-tile', { icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: {
      family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' }, action: domain })])).toContain('sh.confirm-when@1');
    expect(needs([button({ action: call({ confirmation: ask() }) })])).not.toContain('sh.confirm-when@1');
  });
  it('refuses a condition on the app\'s own policy, one that reads nothing and one over the 32 node limit', () => {
    expect(first(compile([button({ action: call({ confirmation: ask(hot, 'policy') }) })]))).toBe('unknown_field ~/action/confirmation/when');
    expect(first(compile([button({ action: call({ confirmation: ask(cmp('above', read('missing', ['state'], 'number'), lit(1))) }) })]))).toBe('invalid_reference ~/action/confirmation/when/left/from/sourceId');
    const wide: J = { type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'all', of: [hot, hot] })) };
    expect(first(compile([button({ action: call({ confirmation: ask(wide) }) })]))).toBe('limit_exceeded ~/action/confirmation/when/of/10/of/0');
  });
});

describe('fallbackTabId (sh.tab-fallback@1)', () => {
  const tabs = (extra: J): J => node('local-tabs', { props: { stateId: 'pane', transition: 'canonical-swap@1', ...extra }, tabs: [{ id: 'one', label: 'One', children: [] }, { id: 'two', label: 'Two', children: [] }] });
  const pane = (document: J) => { document.localState = [{ id: 'pane', type: 'choice', initial: 'one', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }]; };
  it('names one of the container\'s tabs, and only then requires the capability', () => {
    expect(needs([tabs({ fallbackTabId: 'two' })], pane)).toContain('sh.tab-fallback@1');
    expect(needs([tabs({})], pane)).not.toContain('sh.tab-fallback@1');
    expect(first(compile([tabs({ fallbackTabId: 'three' })], pane))).toBe('invalid_reference ~/props/fallbackTabId');
  });
});

describe('the list parts (sh.list-parts@1)', () => {
  const list = (props: J = {}): J => node('row-collection', { props: { providerId: 'upcoming', loadingText: 'a', emptyText: 'b', unavailableText: 'c', errorText: 'd', staleText: 'e', ...props } });
  const flow = (name: 'upcoming' | 'overdue') => (document: J) => {
    const file = name === 'upcoming' ? 'pipeline-upcoming-chores' : 'pipeline-overdue-chores';
    document.dataSources.push(JSON.parse(readFileSync(path.join(corpus, `accept/${file}.json`), 'utf8')).document.dataSources.find((entry: J) => entry.id === name));
  };
  it('takes rowAction, refreshable and emptyMessage, and requires the capability only when one is present', () => {
    expect(needs([list({ rowAction: push() })], flow('upcoming'))).toContain('sh.list-parts@1');
    expect(needs([list({ emptyMessage: { type: 'literal', value: 'Nothing is due.' } })], flow('upcoming'))).toContain('sh.list-parts@1');
    expect(needs([list({ refreshable: false })], flow('upcoming'))).toContain('sh.list-parts@1');
    expect(needs([list()], flow('upcoming'))).not.toContain('sh.list-parts@1');
  });
  it('keeps collection as it is, with none of the three', () => {
    const collection = node('collection', { props: { providerId: 'p', template: 'rows', loadingText: 'a', emptyText: 'b', rowAction: push() } });
    expect(first(compile([collection]))).toBe('unknown_field ~/props/rowAction');
    expect(needs([node('collection', { props: { providerId: 'p', template: 'rows', loadingText: 'a', emptyText: 'b' } })])).not.toContain('sh.list-parts@1');
  });
  it('lets a list be pulled only over a flow that has "When pulled"', () => {
    expect(needs([list({ refreshable: true })], flow('upcoming'))).toContain('sh.list-parts@1');
    expect(first(compile([list({ providerId: 'overdue', refreshable: true })], flow('overdue')))).toBe('invalid_combination ~/props/refreshable');
  });
  it('keeps a power action off a row, and checks a row action like any other', () => {
    const domain: J = { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } };
    expect(first(compile([list({ rowAction: domain })], flow('upcoming')))).toBe('invalid_combination ~/props/rowAction/type');
    expect(first(compile([list({ rowAction: push('page-missing') })], flow('upcoming')))).toBe('invalid_reference ~/props/rowAction/pageId');
    expect(first(compile([list({ refreshable: 'yes' })], flow('upcoming')))).toBe('invalid_value ~/props/refreshable');
  });
});

describe('the date format (sh.pipeline-operands@1)', () => {
  const dated = (style: string, arg: J = lit('2026-11-12')): J => text({ type: 'expr', value: { type: 'format', pattern: '{d}', args: { d: arg }, formats: { d: { date: { style } } } } });
  it('takes the six styles and names the pending operands capability', () => {
    for (const style of ['short-date', 'long-date', 'weekday-date', 'time', 'date-time', 'relative']) expect(needs([dated(style)])).toContain('sh.pipeline-operands@1');
  });
  it('keeps a number format free of that capability', () => {
    const number = text({ type: 'expr', value: { type: 'format', pattern: '{n}', args: { n: lit(2.5) }, formats: { n: { number: { maximumFractionDigits: 1 } } } } });
    expect(needs([number])).not.toContain('sh.pipeline-operands@1');
  });
  it('refuses a pattern in place of a style, a number argument and a format that names no argument', () => {
    expect(first(compile([dated('MMM d')]))).toBe('unknown_variant ~/props/value/value/formats/d');
    expect(first(compile([dated('long-date', read('temp', ['state'], 'number'))]))).toBe('binding_type ~/props/value/value/formats/d');
    const unnamed = text({ type: 'expr', value: { type: 'format', pattern: '{d}', args: { d: lit('x') }, formats: { e: { date: { style: 'time' } } } } });
    expect(first(compile([unnamed]))).toBe('invalid_reference ~/props/value/value/formats/e');
  });
});

describe('the handshake for these capabilities', () => {
  const shippedIds = ['sh.list-parts@1', 'sh.action-rules@1', 'sh.badges@1', 'sh.confirm-when@1', 'sh.enabled-when@1', 'sh.tab-fallback@1', 'sh.tile-look@1'];
  const shipped: string[] = JSON.parse(readFileSync(path.join(corpus, 'capabilities.json'), 'utf8'));
  const pending: string[] = JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'));
  const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: unknown; issue?: { code: string; capability?: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
  const families = ['enabled-when', 'tile-look', 'bound-color', 'bound-symbol', 'text-fallback', 'badge', 'action-rules', 'confirm-when', 'tab-fallback', 'list-parts', 'date-format'];
  const mine = index.cases.filter(entry => families.some(family => new RegExp(`^(accept|reject)/(pending-)?${family}-`).test(entry.file)));
  it('lists the shipped ids as shipped and none of them as pending, list-parts among them', () => {
    for (const id of shippedIds) { expect(shipped).toContain(id); expect(pending).not.toContain(id); expect(pendingCompositionCapabilities).not.toContain(id); }
  });
  it('has a case in every family', () => {
    for (const family of families) expect(mine.some(entry => new RegExp(`^(accept|reject)/(pending-)?${family}-`).test(entry.file)), family).toBe(true);
  });
  it.each(mine.map(entry => [entry.file, entry] as const))('%s: held back only by a pending id it declares, otherwise decided by its own content', (file, entry) => {
    const envelope = JSON.parse(readFileSync(path.join(corpus, file), 'utf8'));
    const declared: string[] = envelope.capabilities;
    const firstUnshipped = declared.find(name => !shipped.includes(name));
    if (entry.pending) {
      // The shipped list refuses the first id it does not know; the Studio, whose list is shipped plus pending, compiles it or gives its own issue.
      expect(entry.issue?.code).toBe('unsupported_capability');
      expect(entry.issue?.capability).toBe(firstUnshipped);
      expect(declared.filter(name => !shipped.includes(name)).every(name => pending.includes(name))).toBe(true);
    } else {
      expect(firstUnshipped).toBeUndefined();
      expect(entry.file.startsWith('accept/') ? 'accept' : 'reject').toBe(entry.outcome);
    }
    if (entry.outcome === 'accept' || (entry.pending && !entry.studioIssue)) expect(legacyManifest(compileCompositionDocument(envelope.document).capabilities)).toEqual(legacyManifest(declared));
  });
  it('names list-parts in an accepted case, so the shipped list is exercised', () => {
    const named = new Set(mine.filter(entry => entry.outcome === 'accept').flatMap(entry => JSON.parse(readFileSync(path.join(corpus, entry.file), 'utf8')).capabilities as string[]));
    expect(named.has('sh.list-parts@1')).toBe(true);
  });
});
