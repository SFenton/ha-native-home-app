/**
 * Writes the `component-*` cases of the shared publication corpus: accepted and rejected envelopes for `sh.component-ref@1`, the document's
 * component library, the `component-ref` node and the per-use parameters (`params`, `bindings`, `args`). Each case is the shared first-slice fixture
 * with its third page's body replaced and the library set, so the files stay small.
 *
 *   tsx scripts/generate-component-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}component-*.json and their index entries
 *
 * `sh.component-ref@1` is shipped; a case that declares a still-pending id (a flow) is refused by the shipped app first (`unsupported_capability`). Every other accepted case
 * is `accept/component-*`, and a rejected one is `reject/component-*` with the Studio's own first issue as `issue` (a pending one also records `studioIssue`)
 * (see `contract/corpus/README.md`). Run `scripts/app-corpus-check/run.sh` afterwards. This file owns only the `component-*` cases.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const PREFIX = 'component-';
const CAPABILITY = 'sh.component-ref@1';

// MARK: Builders
const lit = (value: unknown) => ({ type: 'literal', value });
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, extra: J = {}): J => node(id, 'text', { props: { value: lit('Guests are staying over'), style: 'body', unavailableText: 'None' }, ...extra });
const push = (pageId = 'page-lattice'): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const doorTile = (id: string, extra: J = {}): J => node(id, 'navigation-tile', {
  icon: symbol('info.circle'), props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Open the shelf') }, action: push(), ...extra,
});
const powerTile = (id: string, sourceId = 'source-power', extra: J = {}): J => node(id, 'action-tile', {
  icon: symbol('power'), binding: { sourceId, projection: 'power-tile@1' },
  props: { family: 'lights', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
  action: { type: 'domain', sourceId, intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, ...extra,
});
const section = (id: string, children: J[], extra: J = {}): J => node(id, 'section', {
  props: { header: 'Guests', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children, ...extra,
});
const grid = (id: string, children: J[]): J => node(id, 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' }, children,
});
const form = (id: string): J => node(id, 'form', { props: { providerId: 'sample-provider', saveLabel: 'Save', selectionOnly: false, fields: [{ key: 'name', label: 'Name', control: 'text' }] } });
const settingsLink = (id: string): J => node(id, 'settings-link', { icon: symbol('gear'), props: { subtitle: 'Open', showsChevron: true }, action: push() });
const callButton = (id: string): J => node(id, 'primary-button', { props: {}, action: { type: 'call-service', domain: 'fan', service: 'turn_on', target: { entity_id: lit('fan.demo_bath_fan') } } });
const isOn: J = { type: 'state', sourceId: 'source-entity', path: ['state'], in: ['on'] };
const localTabs = (id: string, first: J[], second: J[]): J => node(id, 'local-tabs', {
  props: { stateId: 'panel', transition: 'canonical-swap@1' },
  tabs: [{ id: 'a', label: 'A', children: first }, { id: 'b', label: 'B', children: second }],
});
const panel: J = { id: 'panel', type: 'choice', initial: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
const entry = (id: string, name: string, body: J, rest: J = {}): J => ({ id, name, node: body, ...rest });
const ref = (id: string, componentId: string, rest: J = {}): J => ({ id, type: 'component-ref', componentId, layout: { span: 1 }, ...rest });
const stateStyle: J = {
  id: 'tidy-vacuum', name: 'Tidy vacuum', base: 'robot', domain: 'vacuum',
  rules: [{ states: ['docked', 'idle'], class: 'resting', active: false }, { states: ['unavailable', 'unknown'], class: 'unknown', active: false }],
  fallback: { class: 'unknown', active: false },
};
const stateTile = (id: string): J => node(id, 'state-tile', { icon: symbol('fan'), props: {}, binding: { entityId: 'vacuum.demo_robot', styleId: 'tidy-vacuum', builtIn: 'robot' } });
const readText = (id: string, sourceId: string, extra: J = {}): J => node(id, 'text', {
  props: { value: { type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'string', missing: 'unavailable' }, style: 'body', unavailableText: 'None' }, ...extra,
});
const haSource = (id: string, entityId: string): J => ({ id, kind: 'ha-entity', entityId: lit(entityId) });
const lengthy = (prefix: string, length: number) => (prefix + 'x'.repeat(length)).slice(0, length);

/** Parameters over a navigation tile: where it goes (page), what its second line says (text), its icon (symbol) and the sheet it opens (modal). */
const paramTile = (id = 'cmp-open'): J => doorTile(id);
const pageParam = { params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }] };

const fanParam = { params: [{ name: 'fan', kind: 'entity-id' }], bindings: [{ param: 'fan', nodeId: 'cmp-go', field: 'action/target/entity_id/value' }] };
const statePanel = { params: [{ name: 'tabs', kind: 'state-id' }], bindings: [{ param: 'tabs', nodeId: 'cmp-tabs', field: 'props/stateId' }] };
const manyParams = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `p${index}`, kind: 'text' }));
const rowsOfText = (count: number): J[] => Array.from({ length: count }, (_, index) => text(`cmp-row-${index}`));
const rowBindings = (count: number): J[] => Array.from({ length: count }, (_, index) => [
  { param: 'words', nodeId: `cmp-row-${index}`, field: 'props/value/value' }, { param: 'words', nodeId: `cmp-row-${index}`, field: 'title' }]).flat();

interface Case {
  name: string; pages?: J[];
  /** Capabilities a rejected case lists though its compile stops before collecting them, so the app reaches the Studio's issue and not a manifest mismatch. */
  needs?: string[]; outcome: 'accept' | 'reject'; note: string; library?: J[]; components?: J[]; modal?: J[]; localState?: J[]; sources?: J[]; stateStyles?: J;
  tweak?: (envelope: J) => void;
}
const cases: Case[] = [];
const accept = (name: string, note: string, more: Partial<Case>) => cases.push({ name: PREFIX + name, outcome: 'accept', note, ...more });
const reject = (name: string, note: string, more: Partial<Case>) => cases.push({ name: PREFIX + name, outcome: 'reject', note, ...more });
const copy = entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'));
const open = (rest: J = {}) => entry('door-row', 'Door Row', paramTile(), rest);

// MARK: Accepted
accept('single-use', 'One entry and one reference on a page: the reference expands to its body, whose id becomes the reference id.', {
  library: [copy], components: [ref('home-guests', 'guests-staying-over')],
});
accept('two-uses-one-page', 'The same entry used twice on one page: ids stay unique after expansion because an inner id is prefixed with the reference id.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', section('cmp-section', [text('cmp-copy')]))],
  components: [ref('home-guests', 'guests-staying-over'), ref('guest-suite', 'guests-staying-over')],
});
accept('across-surfaces', 'Uses on a page, in a sheet and in a local tab.', {
  library: [copy], localState: [panel],
  components: [localTabs('tabs', [ref('tab-guests', 'guests-staying-over')], [text('plain')]), ref('page-guests', 'guests-staying-over')],
  modal: [ref('sheet-guests', 'guests-staying-over')],
});
accept('in-grid-span', 'A tile body used in a tile grid at width 2: the width is the use\'s own, the body\'s root stays at 1.', {
  library: [entry('door-row', 'Door Row', doorTile('cmp-door'))],
  components: [grid('grid', [ref('door-a', 'door-row', { layout: { span: 2 } }), ref('door-b', 'door-row')])],
});
accept('container-body', 'A section body with children, a rule on a child and a call-service action: every check runs once at the library pointer.', {
  library: [entry('guest-controls', 'Guest Controls', section('cmp-section', [text('cmp-note', { visibleWhen: isOn }), callButton('cmp-go')]))],
  components: [ref('guests', 'guest-controls')],
});
accept('root-rule', 'A rule on the body\'s root applies in every place the component is used.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy', { visibleWhen: isOn }))],
  components: [ref('home-guests', 'guests-staying-over'), ref('guest-suite', 'guests-staying-over')],
});
accept('unused-entry', 'An entry no node uses compiles, and the manifest still lists the capability.', { library: [copy] });
accept('empty-library', 'An empty library is still the key, so it still needs the capability.', { library: [] });
accept('state-tile-body', 'A body whose state tile applies a style from the document\'s style library.', {
  stateStyles: { type: 'state-styles@1', styles: [stateStyle] }, library: [entry('robot-tile', 'Robot Tile', stateTile('cmp-robot'))],
  components: [ref('robot-a', 'robot-tile'), ref('robot-b', 'robot-tile')],
});
accept('long-ids', 'An 80-character reference id over an 80-character inner id: a derived id may be longer than 80 characters.', {
  library: [entry('long', 'Long', section(lengthy('cmp-section-', 80), [text(lengthy('cmp-inner-', 80))]))],
  components: [ref(lengthy('use-', 80), 'long')],
});
accept('args-page-and-text', 'One parameter that fills a tile\'s destination page: two uses send two different pages.', {
  library: [open(pageParam)],
  components: [ref('door-a', 'door-row', { args: { target: 'page-lattice' } }), ref('door-b', 'door-row', { args: { target: 'page-orbit' } })],
});
accept('args-source-bound-twice', 'One source parameter bound to two fields of one tile (its binding and its action), set per use.', {
  sources: [{ id: 'source-power-2', kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_fan') } }],
  library: [entry('power-row', 'Power Row', powerTile('cmp-power'), {
    params: [{ name: 'lamp', kind: 'source-id' }],
    bindings: [{ param: 'lamp', nodeId: 'cmp-power', field: 'binding/sourceId' }, { param: 'lamp', nodeId: 'cmp-power', field: 'action/sourceId' }],
  })],
  components: [ref('lamp-a', 'power-row', { args: { lamp: 'source-power' } }), ref('lamp-b', 'power-row', { args: { lamp: 'source-power-2' } })],
});
accept('args-text-symbol-modal', 'Text, symbol and sheet parameters on one tile, each bound by node id and a field path.', {
  library: [entry('sheet-row', 'Sheet Row', doorTile('cmp-open', { action: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' } }), {
    params: [{ name: 'words', kind: 'text' }, { name: 'glyph', kind: 'symbol' }, { name: 'sheet', kind: 'modal-id' }],
    bindings: [{ param: 'words', nodeId: 'cmp-open', field: 'props/subtitle/value' }, { param: 'glyph', nodeId: 'cmp-open', field: 'icon/name' },
      { param: 'sheet', nodeId: 'cmp-open', field: 'action/modalId' }],
  })],
  components: [ref('sheet-a', 'sheet-row', { args: { words: 'Open the swatches', glyph: 'star', sheet: 'modal-swatch' } })],
});
accept('args-in-section', 'A parameter bound to a node inside a body: the bound node is found by its id, not its position.', {
  library: [entry('guest-controls', 'Guest Controls', section('cmp-section', [text('cmp-note'), doorTile('cmp-open')]), pageParam)],
  components: [ref('guests', 'guest-controls', { args: { target: 'page-orbit' } })],
});

accept('args-entity-id', 'An entity parameter bound to a service call\'s target: each use sends its own entity id.', {
  library: [entry('fan-button', 'Fan Button', callButton('cmp-go'), fanParam)],
  components: [ref('fan-a', 'fan-button', { args: { fan: 'fan.demo_bath_fan' } }), ref('fan-b', 'fan-button', { args: { fan: 'fan.demo_attic_fan' } })],
});
accept('args-entity-id-state-tile', 'An entity parameter bound to a state tile\'s entity (`binding/entityId`).', {
  stateStyles: { type: 'state-styles@1', styles: [stateStyle] },
  library: [entry('robot-tile', 'Robot Tile', stateTile('cmp-robot'), {
    params: [{ name: 'robot', kind: 'entity-id' }], bindings: [{ param: 'robot', nodeId: 'cmp-robot', field: 'binding/entityId' }],
  })],
  components: [ref('robot-a', 'robot-tile', { args: { robot: 'vacuum.demo_robot' } }), ref('robot-b', 'robot-tile', { args: { robot: 'vacuum.demo_upstairs_robot' } })],
});
accept('args-state-id', 'A tab container whose selected-tab state is a parameter: two uses keep two selections.', {
  localState: [panel, { ...panel, id: 'panel-2' }],
  library: [entry('tabbed', 'Tabbed', localTabs('cmp-tabs', [text('cmp-a')], [text('cmp-b')]), statePanel)],
  components: [ref('tabs-a', 'tabbed', { args: { tabs: 'panel' } }), ref('tabs-b', 'tabbed', { args: { tabs: 'panel-2' } })],
});
accept('args-labels', 'A parameter may carry a label, the words an arguments form shows instead of its name.', {
  library: [open({ params: [{ ...pageParam.params[0], label: 'Where it goes' }], bindings: pageParam.bindings })],
  components: [ref('door-a', 'door-row', { args: { target: 'page-orbit' } })],
});
accept('origin', 'An entry records the kit it was copied from; the app ignores it.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'), { origin: { id: 'kit.guests-staying-over', version: 3 } })],
  components: [ref('home-guests', 'guests-staying-over')],
});
accept('params-sixteen', 'An entry declares 16 parameters and a use gives all 16.', {
  library: [open({ params: manyParams(16) })],
  components: [ref('door-a', 'door-row', { args: Object.fromEntries(manyParams(16).map(param => [param.name, 'x'])) })],
});
accept('bindings-128', 'An entry holds 128 bindings: 64 text nodes, each bound twice (its title and its text) to one parameter.', {
  library: [entry('rows', 'Rows', section('cmp-section', rowsOfText(64)), { params: [{ name: 'words', kind: 'text' }], bindings: rowBindings(64) })],
  components: [ref('rows-a', 'rows', { args: { words: 'Hello' } })],
});

// MARK: Rejected
const manifestWithout = (envelope: J) => {
  // A pending capability the document does not use keeps the shipped list's refusal first, as the pipeline cases do.
  envelope.capabilities = [...envelope.capabilities.filter((name: string) => name !== CAPABILITY), 'sh.pipeline@1'].sort();
};
reject('capability-missing', 'A document that carries a component library must list sh.component-ref@1.', {
  library: [copy], components: [ref('home-guests', 'guests-staying-over')], tweak: manifestWithout,
});
reject('empty-library-capability-missing', 'The key alone needs the capability, even with no entry, because an older app refuses the unknown key either way.', {
  library: [], tweak: manifestWithout,
});
reject('ref-missing', 'A reference names an entry the library does not hold.', { library: [copy], components: [ref('home-guests', 'no-such-component')] });
reject('ref-no-library', 'A reference with no library at all names nothing.', { components: [ref('home-guests', 'guests-staying-over')] });
reject('ref-no-component-id', 'A reference names its component.', {
  library: [copy], components: [ref('home-guests', 'guests-staying-over')], tweak: envelope => { delete envelope.document.pages[PAGE].components[0].componentId; },
});
reject('duplicate-entry-id', 'A library names each entry id once.', { library: [copy, entry('guests-staying-over', 'Another Name', text('cmp-other'))] });
reject('body-id-on-page', 'A body node shares its id with a node on a page: one catalog of node ids.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('node-live-state'))], components: [text('node-live-state'), ref('home-guests', 'guests-staying-over')],
});
reject('body-id-in-two-bodies', 'Two bodies share an inner id.', {
  library: [copy, entry('guest-suite', 'Guest Suite', text('cmp-copy'))],
});
reject('ref-id-taken', 'A reference shares its id with another node.', { library: [copy], components: [text('node-live-state'), ref('node-live-state', 'guests-staying-over')] });
reject('nested-ref', 'A body holds no reference: nesting is a later version.', {
  library: [copy, entry('wrapper', 'Wrapper', section('cmp-section', [ref('cmp-inner', 'guests-staying-over')]))],
});
reject('root-is-ref', 'A body\'s root is not a reference.', { library: [copy, entry('wrapper', 'Wrapper', ref('cmp-root', 'guests-staying-over'))] });
reject('root-span', 'A body\'s root has width 1; the width belongs to each use.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy', { layout: { span: 2 } }))],
});
reject('ref-span-outside-grid', 'A reference\'s width is 1 outside a grid, as for any node.', {
  library: [copy], components: [ref('home-guests', 'guests-staying-over', { layout: { span: 2 } })],
});
reject('form-below-top', 'A form body may only sit at the top of a page, not inside a section.', {
  library: [entry('editor', 'Editor', form('cmp-form'))], components: [section('holder', [ref('editor-use', 'editor')])],
});
reject('grid-refused-root', 'A settings link may not sit in a grid, and a reference to one is no different.', {
  library: [entry('link', 'Link', settingsLink('cmp-link'))], components: [grid('grid', [ref('link-use', 'link')])],
});
reject('two-forms-one-page', 'A page holds one form: two references to a form body are two forms.', {
  library: [entry('editor', 'Editor', form('cmp-form'))], components: [ref('editor-a', 'editor'), ref('editor-b', 'editor')],
});
const deep = (levels: number): J => { let value: J = text('cmp-leaf'); for (let level = 1; level < levels; level++) value = section(`cmp-level-${level}`, [value]); return value; };
reject('depth', 'A body 12 levels tall fits at the top of a page and not one level down: the limit counts the expanded tree.', {
  library: [entry('tall', 'Tall', deep(12))], components: [section('holder', [ref('tall-use', 'tall')])],
});
reject('node-total', 'Each use adds the whole body to the document\'s total of 4096 nodes.', {
  library: [entry('big', 'Big', section('cmp-big', Array.from({ length: 100 }, (_, index) => text(`cmp-row-${index}`))))],
  modal: Array.from({ length: 41 }, (_, index) => ref(`big-${index}`, 'big')),
});
reject('library-too-long', 'A library holds at most 100 entries.', {
  library: Array.from({ length: 101 }, (_, index) => entry(`entry-${index}`, `Entry ${index}`, text(`cmp-${index}`))),
});
reject('ref-unknown-field', 'A reference carries no title of its own.', { library: [copy], components: [ref('home-guests', 'guests-staying-over', { title: 'Guests' })] });
reject('entry-unknown-field', 'An entry takes the fields of its schema and no others.', { library: [{ ...copy, description: 'Who is staying' }] });
reject('entry-name-empty', 'An entry\'s name is 1 to 80 characters.', { library: [{ ...copy, name: '' }] });
reject('entry-name-control', 'An entry\'s name has no control or format characters.', { library: [{ ...copy, name: 'Guests\u0007' }] });
reject('body-bad-source', 'A body that names a source the document lacks is reported once, at the library, though the entry is used twice.', {
  library: [entry('bad-power', 'Bad Power', powerTile('cmp-power', 'source-missing'))], components: [ref('power-a', 'bad-power'), ref('power-b', 'bad-power')],
});
reject('args-missing', 'A parameter with no argument in a use.', { library: [open(pageParam)], components: [ref('door-a', 'door-row', { args: {} })] });
reject('args-unknown', 'An argument for a parameter the entry does not declare.', {
  library: [open(pageParam)], components: [ref('door-a', 'door-row', { args: { target: 'page-lattice', other: 'x' } })],
});
reject('args-on-component-without-params', 'A use gives arguments to an entry with no parameters.', {
  library: [copy], components: [ref('home-guests', 'guests-staying-over', { args: { target: 'page-lattice' } })],
});
reject('args-page-missing', 'A page argument names a page the document lacks.', {
  library: [open(pageParam)], components: [ref('door-a', 'door-row', { args: { target: 'page-missing' } })],
});
reject('args-source-wrong-model', 'A source argument names a source of the wrong model: it is checked as the field it fills, at the argument.', {
  library: [entry('power-row', 'Power Row', powerTile('cmp-power'), {
    params: [{ name: 'lamp', kind: 'source-id' }],
    bindings: [{ param: 'lamp', nodeId: 'cmp-power', field: 'binding/sourceId' }, { param: 'lamp', nodeId: 'cmp-power', field: 'action/sourceId' }],
  })],
  components: [ref('lamp-a', 'power-row', { args: { lamp: 'source-entity' } })],
});
reject('args-not-an-identifier', 'A page argument is an identifier.', { library: [open(pageParam)], components: [ref('door-a', 'door-row', { args: { target: 'not an id' } })] });
reject('binding-node-missing', 'A binding names a node of the body.', {
  library: [open({ params: pageParam.params, bindings: [{ param: 'target', nodeId: 'no-such-node', field: 'action/pageId' }] })],
});
reject('binding-field-missing', 'A binding names a field the node has.', {
  library: [open({ params: pageParam.params, bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/nowhere' }] })],
});
reject('binding-kind-mismatch', 'A parameter\'s kind must match the bound field: a page parameter cannot fill a text field.', {
  library: [open({ params: pageParam.params, bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'props/subtitle/value' }] })],
});
reject('binding-param-missing', 'A binding names a declared parameter.', {
  library: [open({ params: pageParam.params, bindings: [{ param: 'other', nodeId: 'cmp-open', field: 'action/pageId' }] })],
});
reject('binding-field-twice', 'A field is bound once.', {
  library: [open({ params: [...pageParam.params, { name: 'again', kind: 'page-id' }],
    bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'action/pageId' }, { param: 'again', nodeId: 'cmp-open', field: 'action/pageId' }] })],
});
reject('params-duplicate-name', 'A parameter is declared once.', {
  library: [open({ params: [...pageParam.params, ...pageParam.params], bindings: pageParam.bindings })],
});
reject('params-too-many', 'An entry declares at most 16 parameters.', {
  library: [open({ params: Array.from({ length: 17 }, (_, index) => ({ name: `p${index}`, kind: 'text' })) })],
});

reject('args-entity-id-malformed', 'An entity argument has the form domain.object.', {
  library: [entry('fan-button', 'Fan Button', callButton('cmp-go'), fanParam)], components: [ref('fan-a', 'fan-button', { args: { fan: 'Fan Bath' } })],
});
reject('args-entity-id-no-domain', 'An entity argument names a domain: a bare object id is not an entity id.', {
  library: [entry('fan-button', 'Fan Button', callButton('cmp-go'), fanParam)], components: [ref('fan-a', 'fan-button', { args: { fan: 'demo_bath_fan' } })],
});
reject('args-entity-id-wrong-domain', 'An entity argument is checked as the field it fills: a state tile with a vacuum style takes a vacuum.', {
  stateStyles: { type: 'state-styles@1', styles: [stateStyle] },
  library: [entry('robot-tile', 'Robot Tile', stateTile('cmp-robot'), {
    params: [{ name: 'robot', kind: 'entity-id' }], bindings: [{ param: 'robot', nodeId: 'cmp-robot', field: 'binding/entityId' }],
  })],
  components: [ref('robot-a', 'robot-tile', { args: { robot: 'light.demo_lamp' } })],
});
reject('binding-entity-id-on-text-field', 'An entity parameter cannot fill a text field.', {
  library: [open({ params: [{ name: 'target', kind: 'entity-id' }], bindings: [{ param: 'target', nodeId: 'cmp-open', field: 'props/subtitle/value' }] })],
});
reject('binding-text-on-entity-field', 'A text parameter cannot fill a service target: the literal under entity_id is an entity id, not text.', {
  library: [entry('fan-button', 'Fan Button', callButton('cmp-go'), { params: [{ name: 'fan', kind: 'text' }], bindings: fanParam.bindings })],
  needs: ['sh.call-service@1', 'sh.operands@1', 'sh.primary-button@1'],
});
reject('binding-source-id-on-entity-field', 'A source parameter cannot fill an entity field.', {
  library: [entry('fan-button', 'Fan Button', callButton('cmp-go'), { params: [{ name: 'fan', kind: 'source-id' }], bindings: fanParam.bindings })],
});
reject('args-state-id-missing-field', 'A state argument names a local state field the document lacks.', {
  localState: [panel],
  library: [entry('tabbed', 'Tabbed', localTabs('cmp-tabs', [text('cmp-a')], [text('cmp-b')]), statePanel)],
  components: [ref('tabs-a', 'tabbed', { args: { tabs: 'no-such-field' } })],
});
reject('args-state-id-wrong-field', 'A state argument is checked as the field it fills: tabs need a choice field whose options are the tab ids.', {
  localState: [panel, { id: 'panel-2', type: 'choice', initial: 'x', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }],
  library: [entry('tabbed', 'Tabbed', localTabs('cmp-tabs', [text('cmp-a')], [text('cmp-b')]), statePanel)],
  components: [ref('tabs-a', 'tabbed', { args: { tabs: 'panel-2' } })],
});
reject('args-state-id-not-an-identifier', 'A state argument is an identifier.', {
  localState: [panel],
  library: [entry('tabbed', 'Tabbed', localTabs('cmp-tabs', [text('cmp-a')], [text('cmp-b')]), statePanel)],
  components: [ref('tabs-a', 'tabbed', { args: { tabs: 'not an id' } })],
});
reject('binding-state-id-on-page-field', 'A state parameter cannot fill a page field.', {
  library: [open({ params: [{ name: 'target', kind: 'state-id' }], bindings: pageParam.bindings })],
});
reject('binding-page-id-on-state-field', 'A page parameter cannot fill a state field.', {
  library: [entry('tabbed', 'Tabbed', localTabs('cmp-tabs', [text('cmp-a')], [text('cmp-b')]), { params: [{ name: 'tabs', kind: 'page-id' }], bindings: statePanel.bindings })],
});
reject('bindings-too-many', 'An entry holds at most 128 bindings.', {
  library: [entry('rows', 'Rows', section('cmp-section', rowsOfText(65)), { params: [{ name: 'words', kind: 'text' }], bindings: rowBindings(65) })],
});
reject('param-label-empty', 'A parameter\'s label is 1 to 80 characters.', {
  library: [open({ params: [{ ...pageParam.params[0], label: '' }], bindings: pageParam.bindings })],
});
reject('param-label-too-long', 'A parameter\'s label is at most 80 characters.', {
  library: [open({ params: [{ ...pageParam.params[0], label: 'x'.repeat(81) }], bindings: pageParam.bindings })],
});
reject('param-label-control', 'A parameter\'s label has no control or format characters.', {
  library: [open({ params: [{ ...pageParam.params[0], label: 'Where\u0007' }], bindings: pageParam.bindings })],
});
reject('param-unknown-field', 'A parameter takes a name, a kind and a label and no other field.', {
  library: [open({ params: [{ ...pageParam.params[0], default: 'page-lattice' }], bindings: pageParam.bindings })],
});
reject('origin-unknown-field', 'An origin is an id and a version and nothing else.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'), { origin: { id: 'kit.guests', version: 1, name: 'Guests' } })],
});
reject('origin-version-zero', 'An origin version counts from 1.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'), { origin: { id: 'kit.guests', version: 0 } })],
});
reject('origin-id-not-an-identifier', 'An origin id is an identifier.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'), { origin: { id: 'not an id', version: 1 } })],
});
reject('origin-version-missing', 'An origin names its version.', {
  library: [entry('guests-staying-over', 'Guests Staying Over', text('cmp-copy'), { origin: { id: 'kit.guests' } })],
});

// MARK: Template-owned sources (D2)
/** An entry whose body reads one private source, `state`, and whose parameter `lamp` is that source's entity. */
const lampRow = (rest: J = {}, body: J = readText('cmp-state', 'state')): J => entry('lamp-row', 'Lamp Row', body, {
  params: [{ name: 'lamp', kind: 'entity-id', label: 'Lamp' }], sources: [haSource('state', 'light.demo_lamp')],
  bindings: [{ param: 'lamp', sourceId: 'state', field: 'entityId/value' }], ...rest,
});
accept('sources-one-use', 'An entry owns a data source; each use gets its own copy, named <reference id>~<source id>, and the body\'s read of it follows.', {
  library: [lampRow()], components: [ref('lamp-a', 'lamp-row', { args: { lamp: 'light.demo_lamp' } })],
});
accept('sources-two-uses', 'Two uses of one entry own two sources (lamp-a~state and lamp-b~state), each filled by its own entity argument.', {
  library: [lampRow()],
  components: [ref('lamp-a', 'lamp-row', { args: { lamp: 'light.demo_lamp' } }), ref('lamp-b', 'lamp-row', { args: { lamp: 'light.demo_porch' } })],
});
accept('sources-no-params', 'An entry may own a source with no parameter: every use reads the same entity, through its own copy.', {
  library: [entry('lamp-row', 'Lamp Row', readText('cmp-state', 'state'), { sources: [haSource('state', 'light.demo_lamp')] })],
  components: [ref('lamp-a', 'lamp-row'), ref('lamp-b', 'lamp-row')],
});
accept('sources-one-argument-two-fields', 'One entity argument fills the private source and a service target, so one choice cannot drift between two fields.', {
  library: [entry('fan-row', 'Fan Row', section('cmp-section', [readText('cmp-state', 'state'), callButton('cmp-go')]), {
    params: [{ name: 'fan', kind: 'entity-id', label: 'Fan' }], sources: [haSource('state', 'fan.demo_bath_fan')],
    bindings: [{ param: 'fan', sourceId: 'state', field: 'entityId/value' }, { param: 'fan', nodeId: 'cmp-go', field: 'action/target/entity_id/value' }],
  })],
  components: [ref('fan-a', 'fan-row', { args: { fan: 'fan.demo_bath_fan' } }), ref('fan-b', 'fan-row', { args: { fan: 'fan.demo_attic_fan' } })],
});
accept('sources-two-owned', 'An entry owns two sources; a body node reads each by its own id.', {
  library: [entry('pair-row', 'Pair Row', section('cmp-section', [readText('cmp-one', 'first'), readText('cmp-two', 'second')]), {
    params: [{ name: 'one', kind: 'entity-id' }, { name: 'two', kind: 'entity-id' }],
    sources: [haSource('first', 'light.demo_lamp'), haSource('second', 'light.demo_porch')],
    bindings: [{ param: 'one', sourceId: 'first', field: 'entityId/value' }, { param: 'two', sourceId: 'second', field: 'entityId/value' }],
  })],
  components: [ref('pair-a', 'pair-row', { args: { one: 'light.demo_a', two: 'light.demo_b' } })],
});
accept('sources-in-rule', 'A private source named by a rule on a body node (visibleWhen) is rewritten like any other source id.', {
  library: [lampRow({}, text('cmp-state', { visibleWhen: { type: 'state', sourceId: 'state', path: ['state'], in: ['on'] } }))],
  components: [ref('lamp-a', 'lamp-row', { args: { lamp: 'light.demo_lamp' } })],
});
accept('sources-shadow-document-source', 'A private source whose id equals a document source: inside the body the private source wins, so source-entity still means the document\'s everywhere else.', {
  library: [entry('lamp-row', 'Lamp Row', readText('cmp-state', 'source-entity'), { sources: [haSource('source-entity', 'light.demo_lamp')] })],
  components: [ref('lamp-a', 'lamp-row'), readText('outside', 'source-entity')],
});
accept('sources-source-id-arg-not-rewritten', 'A source parameter whose argument equals a private id names the document\'s source of that id, never the private copy.', {
  sources: [haSource('state', 'light.demo_porch')],
  library: [entry('lamp-row', 'Lamp Row', section('cmp-section', [readText('cmp-own', 'state'), readText('cmp-other', 'state')]), {
    params: [{ name: 'other', kind: 'source-id' }], sources: [haSource('state', 'light.demo_lamp')],
    bindings: [{ param: 'other', nodeId: 'cmp-other', field: 'props/value/from/sourceId' }],
  })],
  components: [ref('lamp-a', 'lamp-row', { args: { other: 'state' } })],
});

reject('source-binding-both-targets', 'A binding names a node or a source, not both.', {
  library: [lampRow({ bindings: [{ param: 'lamp', nodeId: 'cmp-state', sourceId: 'state', field: 'entityId/value' }] })],
});
reject('source-binding-no-target', 'A binding names a node or a source.', { library: [lampRow({ bindings: [{ param: 'lamp', field: 'entityId/value' }] })] });
reject('source-binding-unknown-source', 'A binding names a source of the entry.', {
  library: [lampRow({ bindings: [{ param: 'lamp', sourceId: 'no-such-source', field: 'entityId/value' }] })],
});
reject('source-binding-field-missing', 'A binding names a field the source has.', {
  library: [lampRow({ bindings: [{ param: 'lamp', sourceId: 'state', field: 'entityId/nowhere' }] })],
});
reject('source-binding-kind-mismatch', 'A text parameter cannot fill a source\'s entity id.', {
  library: [lampRow({ params: [{ name: 'lamp', kind: 'text' }] })],
});
reject('source-binding-not-an-entity-field', 'Only a source\'s entity id may be a parameter: its id is not.', {
  library: [lampRow({ params: [{ name: 'lamp', kind: 'source-id' }], bindings: [{ param: 'lamp', sourceId: 'state', field: 'id' }] })],
});
reject('source-binding-field-twice', 'A source\'s field is bound once.', {
  library: [lampRow({ params: [{ name: 'lamp', kind: 'entity-id' }, { name: 'again', kind: 'entity-id' }],
    bindings: [{ param: 'lamp', sourceId: 'state', field: 'entityId/value' }, { param: 'again', sourceId: 'state', field: 'entityId/value' }] })],
});
reject('source-duplicate-id', 'An entry names each private source once.', {
  library: [lampRow({ sources: [haSource('state', 'light.demo_lamp'), haSource('state', 'light.demo_porch')] })],
});
reject('source-bad-default-entity', 'A private source\'s own entity id has the form domain.object, argument or not.', {
  library: [lampRow({ sources: [haSource('state', 'Demo Lamp')] })],
});
reject('source-unknown-field', 'A private source takes the fields of an entity source and no others.', {
  library: [lampRow({ sources: [{ ...haSource('state', 'light.demo_lamp'), name: 'Lamp' }] })],
});
reject('source-not-an-entity-source', 'A private source is an entity source: a model source stays in the document.', {
  library: [lampRow({ sources: [{ id: 'state', kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_lamp') } }] })],
});
reject('source-entity-not-literal', 'A private source\'s entity is a literal: it reads nothing.', {
  library: [lampRow({ sources: [{ id: 'state', kind: 'ha-entity', entityId: { type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['state'] }, as: 'entity-id', missing: 'unavailable' } }] })],
});
reject('sources-too-many', 'An entry owns at most 8 sources.', {
  library: [lampRow({ sources: Array.from({ length: 9 }, (_, index) => haSource(`state-${index}`, 'light.demo_lamp')) })],
});
reject('source-id-not-an-identifier', 'A private source\'s id is an identifier.', { library: [lampRow({ sources: [haSource('not an id', 'light.demo_lamp')] })] });
reject('source-unknown-in-body', 'A body names a source that is neither the document\'s nor one the entry owns.', {
  library: [lampRow({}, readText('cmp-state', 'no-such-source'))],
});
reject('source-arg-entity-malformed', 'An entity argument that only fills a source is still checked as an entity id.', {
  library: [lampRow()], components: [ref('lamp-a', 'lamp-row', { args: { lamp: 'Demo Lamp' } })],
});
reject('source-arg-missing', 'A parameter that fills a source needs its argument like any other.', { library: [lampRow()], components: [ref('lamp-a', 'lamp-row', { args: {} })] });
reject('source-arg-private-id', 'A source parameter cannot name a private source: the arguments are the document\'s names.', {
  library: [entry('lamp-row', 'Lamp Row', readText('cmp-state', 'state'), {
    params: [{ name: 'other', kind: 'source-id' }], sources: [haSource('state', 'light.demo_lamp')],
    bindings: [{ param: 'other', nodeId: 'cmp-state', field: 'props/value/from/sourceId' }],
  })],
  components: [ref('lamp-a', 'lamp-row', { args: { other: 'state' } })],
});
reject('sources-over-document-limit', 'Every use adds its sources to the document\'s 1,000: 126 uses of an entry that owns 8 do not fit.', {
  library: [entry('lamp-row', 'Lamp Row', text('cmp-state'), { sources: Array.from({ length: 8 }, (_, index) => haSource(`state-${index}`, 'light.demo_lamp')) })],
  components: Array.from({ length: 100 }, (_, index) => ref(`lamp-${index}`, 'lamp-row')), modal: Array.from({ length: 26 }, (_, index) => ref(`lamp-m${index}`, 'lamp-row')),
});

// MARK: Examples
// The four examples of the templates research note (build/research/component-templates.md 5.1), compiled. Every entity id is a placeholder.
/** The humidifier source the sheet reads: one model source, every entity id invented. */
const humidifierSource: J = {
  id: 'humidifier-main', kind: 'model', model: 'humidifier@1', inputs: {
    id: 'humidifier-main', title: 'Humidifier', applyProfileScriptService: 'example_humidifier_profile', currentHumidityEntityId: 'sensor.example_humidifier_humidity',
    currentTemperatureEntityId: 'sensor.example_humidifier_temperature', displayEntityId: 'switch.example_humidifier_display',
    humidifyingEntityId: 'binary_sensor.example_humidifier_running', mistLevelEntityId: 'number.example_humidifier_mist', modeEntityId: 'select.example_humidifier_mode',
    powerEntityId: 'switch.example_humidifier_power', scheduleEnabledEntityId: 'input_boolean.example_humidifier_schedule_on', scheduleEntityId: 'schedule.example_humidifier',
    scheduleId: 'example_humidifier', setLevelScriptService: 'example_humidifier_level', tankRemovedEntityId: 'binary_sensor.example_humidifier_tank',
    targetHumidityEntityId: 'number.example_humidifier_target', timerMinutesEntityId: 'number.example_humidifier_timer', timerRemainingEntityId: 'sensor.example_humidifier_remaining',
    vacationModeEntityId: 'input_boolean.example_humidifier_vacation', warmLevelEntityId: 'number.example_humidifier_warm', waterLowEntityId: 'binary_sensor.example_humidifier_water',
  },
};
const deviceLabels = { loading: 'Loading', unavailable: 'Unavailable', failed: 'Failed', on: 'On', off: 'Off', action: 'Apply', cancel: 'Cancel', footnote: '',
  sleep: 'Sleep', tankFault: 'Tank removed', waterFault: 'Water low', invalidTarget: 'Invalid', highTarget: 'High' };
const deviceControl = (id: string, title: string, control: string, extra: J = {}): J => node(id, 'room-device-control', {
  title, icon: symbol('humidifier'), binding: { sourceId: 'humidifier-main' }, props: { control, family: 'water', options: [], labels: deviceLabels, ...extra },
});
const humidifierBody = (): J => node('tabs', 'local-tabs', {
  title: 'Humidifier', props: { stateId: 'humidifier-tab', transition: 'canonical-swap@1' },
  tabs: [
    { id: 'controls', label: 'Controls', children: [
      deviceControl('power', 'Power', 'humidifier-power'),
      deviceControl('mode', 'Mode', 'humidifier-mode', { options: ['Manual', 'Target Humidity', 'Sleep'].map(value => ({ value, label: value })) }),
      deviceControl('target', 'Target', 'humidifier-target'),
      deviceControl('timer', 'Timer', 'humidifier-timer'),
      deviceControl('display', 'Display', 'humidifier-display'),
      deviceControl('level', 'Humidity', 'humidifier-info', { info: 'humidity' }),
    ] },
    { id: 'schedules', label: 'Schedules', children: [deviceControl('scheduling', 'Schedules', 'humidifier-scheduling')] },
  ],
});
const humidifierBindings = (): J[] => [
  { param: 'tabs', nodeId: 'tabs', field: 'props/stateId' },
  ...['power', 'mode', 'target', 'timer', 'display', 'level', 'scheduling'].map(nodeId => ({ param: 'device', nodeId, field: 'binding/sourceId' })),
];
const humidifierSheet = (): J => entry('humidifier-sheet', 'Humidifier Sheet', humidifierBody(), {
  origin: { id: 'kit.humidifier-sheet', version: 1 },
  params: [{ name: 'device', kind: 'source-id', label: 'Humidifier' }, { name: 'tabs', kind: 'state-id', label: 'Tab' }], bindings: humidifierBindings(),
});
const humidifierTabs = (id: string): J => ({ id, type: 'choice', initial: 'controls', options: [{ id: 'controls', label: 'Controls' }, { id: 'schedules', label: 'Schedules' }] });
accept('example-humidifier-sheet', 'Humidifier sheet (research 5.1): a tab body of room-device controls, one source parameter and one tab-state parameter; two sheets keep two tab selections.', {
  sources: [humidifierSource, { ...humidifierSource, id: 'humidifier-second', inputs: { ...humidifierSource.inputs, id: 'humidifier-second' } }],
  localState: [humidifierTabs('humidifier-tab'), humidifierTabs('humidifier-tab-2')],
  library: [humidifierSheet()],
  components: [ref('humidifier-body', 'humidifier-sheet', { args: { device: 'humidifier-main', tabs: 'humidifier-tab' } }),
    ref('humidifier-body-2', 'humidifier-sheet', { args: { device: 'humidifier-second', tabs: 'humidifier-tab-2' } })],
});

/** A light button from generic parts: a toggle tile whose state read and two service targets follow one entity parameter. */
const lightButton = (): J => entry('light-button', 'Light Button', node('button', 'bound-control', {
  title: 'Light', icon: symbol('lightbulb'),
  props: { kind: 'toggle', surface: 'tile', unavailableText: 'Unavailable', isOn: { type: 'state', sourceId: 'state', path: ['state'], in: ['on'] } },
  onAction: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.example') } },
  offAction: { type: 'call-service', domain: 'light', service: 'turn_off', target: { entity_id: lit('light.example') } },
}), {
  origin: { id: 'kit.light-button', version: 1 },
  params: [{ name: 'light', kind: 'entity-id', label: 'Light' }, { name: 'name', kind: 'text', label: 'Name' }, { name: 'icon', kind: 'symbol', label: 'Icon' }],
  sources: [haSource('state', 'light.example')],
  bindings: [
    { param: 'light', sourceId: 'state', field: 'entityId/value' },
    { param: 'light', nodeId: 'button', field: 'onAction/target/entity_id/value' },
    { param: 'light', nodeId: 'button', field: 'offAction/target/entity_id/value' },
    { param: 'name', nodeId: 'button', field: 'title' },
    { param: 'icon', nodeId: 'button', field: 'icon/name' },
  ],
});
accept('example-light-button', 'Light button (research 5.1): one entity argument fills the private state source and both service targets; a use is one reference with three arguments.', {
  library: [lightButton()],
  components: [grid('lights', [
    ref('lamp-1', 'light-button', { args: { light: 'light.example_lamp', name: 'Lamp', icon: 'lightbulb.fill' } }),
    ref('lamp-2', 'light-button', { args: { light: 'light.example_porch', name: 'Porch', icon: 'lightbulb' } })])],
});

/** A vent tile: the state tile's blind face, a "state position%" subtitle and a rule that lights it while open, all reading one private source. */
const ventTile = (): J => entry('vent-tile', 'Vent Tile', node('tile', 'state-tile', {
  title: 'Vent', icon: symbol('fan'), binding: { entityId: 'cover.example_vent', builtIn: 'blind' },
  props: { subtitle: { type: 'expr', value: { type: 'format', pattern: '{state} {position}%', args: {
    state: { type: 'read', from: { type: 'source', sourceId: 'vent', path: ['state'] }, as: 'string', missing: 'unavailable' },
    position: { type: 'read', from: { type: 'source', sourceId: 'vent', path: ['attributes', 'current_position'] }, as: 'number', missing: 'unavailable' } } } } },
  activeWhen: { type: 'state', sourceId: 'vent', path: ['state'], in: ['open'] },
}), {
  origin: { id: 'kit.vent-tile', version: 1 },
  params: [{ name: 'vent', kind: 'entity-id', label: 'Vent' }, { name: 'name', kind: 'text', label: 'Name' }],
  sources: [haSource('vent', 'cover.example_vent')],
  bindings: [
    { param: 'vent', sourceId: 'vent', field: 'entityId/value' },
    { param: 'vent', nodeId: 'tile', field: 'binding/entityId' },
    { param: 'name', nodeId: 'tile', field: 'title' },
  ],
});
accept('example-vent-tile', 'Vent tile (research 5.1): the blind face with a subtitle and a rule over one private source; the same entity fills the source and the tile\'s binding.', {
  library: [ventTile()],
  components: [grid('vents', [ref('vent-a', 'vent-tile', { args: { vent: 'cover.example_vent_one', name: 'Vent One' } }), ref('vent-b', 'vent-tile', { args: { vent: 'cover.example_vent_two', name: 'Vent Two' } })])],
});

/** The bed sheet: temperature, alarms and status tabs; eleven parameters and 22 bindings. */
const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayName: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const bedBase = (sourceId: string) => ({ sourceId, unavailableText: 'Unavailable' });
const scopeLabels = { title: 'Change level', message: 'Apply to', tonightLabel: 'Tonight', allNightsLabel: 'All nights', cancelLabel: 'Cancel' };
const bedControl = (id: string, title: string, props: J): J => node(id, 'bedroom-control', { title, props: { ...bedBase('bed-left'), label: title, ...props } });
const bedBody = (): J => node('tabs', 'local-tabs', {
  title: 'Bed', props: { stateId: 'bed-tab', transition: 'canonical-swap@1', pinned: true },
  tabs: [
    { id: 'temperature', label: 'Temperature', icon: symbol('thermometer'), children: [
      bedControl('target', 'Level', { control: 'bed-target', scope: scopeLabels }),
      bedControl('power', 'Power', { control: 'bed-power', activeLabel: 'On', confirmation: { title: 'Turn off', message: 'Stop the bed?', confirmLabel: 'Turn off', cancelLabel: 'Cancel' } }),
      ...['bedtime', 'asleep', 'dawn'].map(stage => bedControl(`stage-${stage}`, stage, { control: 'bed-stage', parameter: stage, scope: scopeLabels })),
    ] },
    { id: 'alarms', label: 'Alarms', icon: symbol('alarm'), children: days.map(day => node(`d-${day}`, 'navigation-tile', {
      title: dayName[day], icon: symbol('alarm'), props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Alarms') }, action: push(`bed-left-${day}`),
    })) },
    { id: 'status', label: 'Status', icon: symbol('heart'), children: [
      ...['current-temperature', 'pump-status', 'loop-temperature', 'pump-rpm', 'heart-rate', 'breathing', 'hrv'].map(parameter =>
        bedControl(`read-${parameter}`, parameter, { control: 'bed-reading', parameter, ...(parameter === 'pump-status' ? { activeLabel: 'Running', inactiveLabel: 'Idle' } : {}) })),
      node('wake', 'bedroom-control', { title: 'Wake light', props: { ...bedBase('wake-light'), label: 'Wake light', control: 'wake-summary' } }),
    ] },
  ],
});
const bedParams = (): J[] => [
  { name: 'bed', kind: 'source-id', label: 'Bed' }, { name: 'wake', kind: 'source-id', label: 'Wake light' }, { name: 'tabs', kind: 'state-id', label: 'Tab' },
  ...days.map(day => ({ name: day, kind: 'page-id', label: `${dayName[day]} alarms` })), { name: 'name', kind: 'text', label: 'Title' },
];
const bedBindings = (): J[] => [
  { param: 'tabs', nodeId: 'tabs', field: 'props/stateId' }, { param: 'name', nodeId: 'tabs', field: 'title' },
  ...['target', 'power', 'stage-bedtime', 'stage-asleep', 'stage-dawn', ...['current-temperature', 'pump-status', 'loop-temperature', 'pump-rpm', 'heart-rate', 'breathing', 'hrv'].map(name => `read-${name}`)]
    .map(nodeId => ({ param: 'bed', nodeId, field: 'props/sourceId' })),
  { param: 'wake', nodeId: 'wake', field: 'props/sourceId' },
  ...days.map(day => ({ param: day, nodeId: `d-${day}`, field: 'action/pageId' })),
];
const bedSource = (id: string, kind: string): J => ({ id, kind: 'model', model: 'bedroom-provider@1', inputs: { providerId: id, kind } });
const bedTabs = (id: string): J => ({ id, type: 'choice', initial: 'temperature', options: [{ id: 'temperature', label: 'Temperature' }, { id: 'alarms', label: 'Alarms' }, { id: 'status', label: 'Status' }] });
accept('example-bed-sheet', 'Bed sheet (research 5.1): three tabs of bedroom controls over a bed source and a wake-light source, seven alarm-day pages and a tab state; 11 parameters and 22 bindings.', {
  sources: [bedSource('bed-left', 'bed-side'), bedSource('wake-light', 'wake-light')],
  pages: days.map(day => ({ ...structuredClone(base.document.pages[0]), id: `bed-left-${day}`, title: `${dayName[day]} alarms`, components: [] })),
  localState: [bedTabs('bed-tab')],
  library: [entry('bed-sheet', 'Bed Sheet', bedBody(), { origin: { id: 'kit.bed-sheet', version: 1 }, params: bedParams(), bindings: bedBindings() })],
  components: [ref('bed-body', 'bed-sheet', { args: { bed: 'bed-left', wake: 'wake-light', tabs: 'bed-tab', name: 'Bed', ...Object.fromEntries(days.map(day => [day, `bed-left-${day}`])) } })],
});

// MARK: Writing
function envelope(item: Case): J {
  const value = structuredClone(base);
  const document = value.document;
  if (item.pages) document.pages.push(...item.pages);
  if (item.components) document.pages[PAGE].components = item.components;
  if (item.modal) document.modals[0].components = [...document.modals[0].components, ...item.modal];
  if (item.localState) document.localState = item.localState;
  if (item.sources) document.dataSources.push(...item.sources);
  if (item.stateStyles) document.stateStyles = item.stateStyles;
  if (item.library) document.componentLibrary = item.library;
  return value;
}
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
const ownFile = (file: unknown) => new RegExp(`/(pending-)?${PREFIX}`).test(String(file));
// The new cases take the place the old ones had, so a regeneration does not move them in the index.
const slot = Math.max(0, index.cases.findIndex(entry => ownFile(entry.file)));
index.cases = index.cases.filter(entry => !ownFile(entry.file));
const written: J[] = [];
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (ownFile(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));
const shipped = shippedCapabilities(root);
const problems: string[] = [];
for (const item of cases) {
  const draft = envelope(item);
  let issue: J | undefined;
  if (item.outcome === 'accept') {
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; }
    catch (error) { problems.push(`${item.name} did not compile: ${JSON.stringify((error as any).issues)}`); continue; }
  } else {
    // A rejected case starts from a document that would otherwise be complete, so only the fault under test is reported.
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; } catch { /* the document is the fault */ }
    draft.capabilities = [...new Set([...draft.capabilities, CAPABILITY, ...item.needs ?? []])].sort();
    item.tweak?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); problems.push(`${item.name} was accepted`); continue; }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      issue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    }
  }
  if (item.outcome === 'accept') {
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); } catch (error) { problems.push(`${item.name} did not decode: ${JSON.stringify((error as any).issues)}`); continue; }
  }
  // An id the app ships no longer holds a case back: it is an ordinary accept, or a reject with the Studio's issue.
  const { file, entry } = placeCase(item.name, item.note, item.outcome, shippedIssue(shipped, draft.capabilities), issue);
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  written.push(entry);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
index.cases.splice(slot, 0, ...written);
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept)`);
