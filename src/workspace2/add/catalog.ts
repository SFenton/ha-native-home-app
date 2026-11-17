import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { createId as uid } from '../../shared/ids';
import { builtInStyles, type StateStyleDefinition } from '../../shared/composition/state-styles';
import { newStateTile } from '../../shared/composition/state-style-library';
import { newRepeat } from './repeat';

/** An SF Symbol reference as the document stores it. */
export const symbol = (name: string) => ({ type: 'sf-symbol' as const, name, rendering: 'canonical' as const, unavailable: 'fallback' as const });
type Source = CompositionDocument['dataSources'][number];
const literal = (value: string) => ({ type: 'literal' as const, value });
const spacing = { type: 'token' as const, name: 'm' as const };

/** What a factory is given: the document it adds to and, for entity-bound types, the entity and its friendly name. */
export interface MakeContext { document: CompositionDocument; entityId?: string; name?: string; /** Home Assistant's device class for the entity, which picks a state tile's style. */ deviceClass?: string }
/** A node and the data sources it needs (added to the document in the same undo step). */
export interface Made { node: CompositionNode; sources: Source[]; /** Saved styles the node needs, added to the document's library in the same undo step. */ stateStyles?: StateStyleDefinition[]; /** Choice fields of the document's local state the node needs (a tab container's selected tab), added in the same undo step. */ localState?: NonNullable<CompositionDocument['localState']> }

/** One kind of thing the Add picker offers. */
export interface TileType {
  /** The node type. */
  type: CompositionNode['type'];
  /** What the picker, the palette and a drag call this entry. One node type can have several entries (a Command and a Toggle are both a `bound-control`), so it is not always the node type. */
  key: string;
  /** A question asked before anything is added: "Map of" asks which robot. */
  asks?: 'robot';
  /** The app's name for it (spec section 10, "Add picker"). */
  name: string;
  /** A Lucide icon name for the picker's grid (the Studio's own stand-in glyph). */
  glyph: string;
  /** Domains an entity must belong to; the picker asks for an entity first when set. */
  domains?: readonly string[];
  /** Builds the node. */
  make(context: MakeContext): Made;
}

const shortId = (entityId: string) => entityId.replace(/[^A-Za-z0-9_-]/g, '-');
const nodeId = (prefix: string) => `${prefix}-${uid('n').replace(/^n-?/, '').slice(0, 8)}`;
const sourceFor = (document: CompositionDocument, make: (id: string) => Source, find: (source: Source) => boolean, base: string): { source: Source; created: Source[] } => {
  const found = document.dataSources.find(find);
  if (found) return { source: found, created: [] };
  const taken = new Set(document.dataSources.map(item => item.id));
  let id = base, count = 1;
  while (taken.has(id)) id = `${base}-${++count}`;
  const source = make(id);
  return { source, created: [source] };
};
const holdsEntity = (source: Source, model: string | undefined, entityId: string) => {
  const inputs = (source as { inputs?: { entityId?: { value?: string } } }).inputs;
  const bound = source.kind === 'ha-entity' ? (source.entityId.type === 'literal' ? source.entityId.value : undefined) : inputs?.entityId?.value;
  return bound === entityId && (model ? (source as { model?: string }).model === model : source.kind === 'ha-entity');
};
/** The id of the first other page, for tiles that need somewhere to go. */
const firstOtherPage = (document: CompositionDocument) => document.pages[1]?.id ?? document.pages[0].id;

const base = (prefix: string, title: string) => ({ id: nodeId(prefix), title, layout: { span: 1 } });

/** What the Add picker says when an entity has no built-in or saved style that fits. */
export const NO_STYLE_FITS = 'No style fits this entity yet.';

/** The tile types the Add picker offers, in the app's vocabulary. */
type Entry = Omit<TileType, 'key'> & { key?: string };
const entries: readonly Entry[] = [
  { type: 'action-tile', name: 'Action tile', glyph: 'power', domains: ['switch', 'input_boolean'], make({ document, entityId = 'switch.example', name }) {
    const { source, created } = sourceFor(document, id => ({ id, kind: 'model', model: 'power-toggle@1', inputs: { entityId: literal(entityId) } }),
      item => holdsEntity(item, 'power-toggle@1', entityId), `power-${shortId(entityId)}`);
    const node = { ...base('tile', name ?? entityId), type: 'action-tile' as const, icon: symbol('power'), binding: { sourceId: source.id, projection: 'power-tile@1' as const },
      props: { family: 'neutral' as const, bodyActionId: 'power' as const, actionOrder: ['power'] as ['power'], stateText: 'provider' as const, feedback: 'policy' as const },
      action: { type: 'domain' as const, sourceId: source.id, intent: 'power.toggle' as const, feedback: 'policy' as const, confirmation: { type: 'policy' as const } } };
    return { node, sources: created };
  } },
  { type: 'bound-control', name: 'Toggle', glyph: 'toggle-right', domains: ['light', 'fan', 'media_player', 'humidifier'], make({ document, entityId = 'light.example', name }) {
    const { source, created } = sourceFor(document, id => ({ id, kind: 'ha-entity', entityId: literal(entityId) }), item => holdsEntity(item, undefined, entityId), `entity-${shortId(entityId)}`);
    const call = (service: string) => ({ type: 'call-service' as const, domain: entityId.split('.')[0], service, target: { entity_id: literal(entityId) } });
    const node = { ...base('toggle', name ?? entityId), type: 'bound-control' as const, icon: symbol(entityId.startsWith('light.') ? 'lightbulb' : 'power'),
      props: { kind: 'toggle' as const, surface: 'tile' as const, isOn: { type: 'state' as const, sourceId: source.id, path: ['state'], in: ['on'] }, unavailableText: 'Unavailable' },
      onAction: call('turn_on'), offAction: call('turn_off') };
    return { node, sources: created };
  } },
  { type: 'navigation-tile', name: 'Navigation tile', glyph: 'arrow-right-circle', make: ({ document }) => ({ sources: [], node: { ...base('tile', 'New tile'), type: 'navigation-tile', icon: symbol('square.grid.2x2'),
    props: { family: 'neutral', selected: 'navigation-path', subtitle: literal('') }, action: { type: 'push', pageId: firstOtherPage(document), arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } } }) },
  { type: 'state-tile', name: 'State tile', glyph: 'activity', domains: [...new Set(builtInStyles.map(style => style.domain))], make({ document, entityId = 'lock.example', name, deviceClass }) {
    const node = newStateTile(entityId, name ?? entityId, deviceClass, document.stateStyles);
    if (!node) throw new Error(NO_STYLE_FITS);
    return { node: node as CompositionNode, sources: [] };
  } },
  { type: 'local-tabs', name: 'Tabs', glyph: 'panels-top-left', make({ document }) {
    const taken = new Set((document.localState ?? []).map(field => field.id));
    let stateId = 'tabs', count = 1;
    while (taken.has(stateId)) stateId = `tabs-${++count}`;
    const tabs = [{ id: 'tab-one', label: 'One', children: [] }, { id: 'tab-two', label: 'Two', children: [] }];
    const node = { ...base('tabs', 'New tabs'), type: 'local-tabs' as const, props: { stateId, transition: 'canonical-swap@1' as const }, tabs };
    return { node, sources: [], localState: [{ id: stateId, type: 'choice' as const, initial: tabs[0].id, options: tabs.map(tab => ({ id: tab.id, label: tab.label })) }] };
  } },
  { type: 'overlay', name: 'Overlay', glyph: 'layers', make: () => ({ sources: [], node: { ...base('overlay', 'New overlay'), type: 'overlay', props: { anchors: [] }, children: [{ ...base('text', 'Base'), type: 'text', props: { value: literal('Base'), style: 'body', unavailableText: 'Unavailable' } }] } }) },
  // The generic parts (`sh.stack@1`, `sh.symbol-part@1`): a row or column, a plain shape and a symbol. No kit: each starts as the smallest useful part.
  { type: 'stack', name: 'Stack', glyph: 'layout-list', make: () => ({ sources: [], node: { ...base('stack', 'New stack'), type: 'stack', props: { axis: 'vertical', spacing }, children: [] } }) },
  // A template drawn once for each record of a records flow (`sh.repeat@1`).
  { type: 'repeat', name: 'Repeat', glyph: 'repeat', make: ({ document, entityId }) => newRepeat(document, entityId) },
  { type: 'shape', name: 'Shape', glyph: 'shapes', make: () => ({ sources: [], node: { ...base('shape', 'New shape'), type: 'shape', props: { form: 'capsule', width: 48, height: 8, fill: { type: 'solid-rgb', red: 142, green: 142, blue: 147 } } } }) },
  { type: 'symbol', name: 'Symbol', glyph: 'sparkles', make: () => ({ sources: [], node: { ...base('symbol', 'New symbol'), type: 'symbol', props: { name: symbol('questionmark.circle'), size: { points: 28 }, rendering: 'monochrome' }, a11y: { element: 'hidden' } } }) },
  // The generic data parts (`sh.chart@1`, `sh.linear-gauge@1`): a chart of a few points and a rail with a marker. Each starts as the smallest useful part, in a neutral grey.
  { type: 'chart', name: 'Chart', glyph: 'chart', make: () => ({ sources: [], node: { ...base('chart', 'New chart'), type: 'chart', props: {
    mark: 'bar', series: { type: 'literal', points: [10, 40, 20, 60, 30].map((value, index) => ({ label: `${index + 1}`, value })) },
    domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: { type: 'solid-rgb', red: 142, green: 142, blue: 147 },
    axis: { levels: 3, label: { pattern: '{value}', digits: 0 } }, emptyText: 'Unavailable' }, a11y: { label: literal('Chart') } } }) },
  { type: 'linear-gauge', name: 'Gauge', glyph: 'gauge', make: () => ({ sources: [], node: { ...base('gauge', 'New gauge'), type: 'linear-gauge', props: {
    value: { type: 'literal', value: 0.5 }, fill: 'scale', stops: [{ at: 0, ink: { type: 'solid-rgb', red: 142, green: 142, blue: 147 } }, { at: 1, ink: { type: 'solid-rgb', red: 99, green: 99, blue: 102 } }],
    track: { type: 'rgba', red: 142, green: 142, blue: 147, alpha: 0.3 }, marker: { size: 12, ink: { type: 'solid-rgb', red: 255, green: 255, blue: 255 } } }, a11y: { element: 'hidden' } } }) },
  { type: 'section', name: 'Section', glyph: 'rows-3', make: () => ({ sources: [], node: { ...base('section', 'New section'), type: 'section', props: { header: 'New section', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing }, children: [] } }) },
  { type: 'tile-grid', name: 'Tile grid', glyph: 'layout-grid', make: () => ({ sources: [], node: { ...base('grid', 'New grid'), type: 'tile-grid',
    props: { minimum: 'tile@1', maxColumns: 2, spacing, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [] } }) },
  // The generic gauge parts (`sh.dial@1`, `sh.arc-track@1`): a ring of ticks with one lit, and an arc with a marker. Each starts as the smallest useful part, in neutral greys.
  { type: 'dial', name: 'Dial', glyph: 'dial', make: () => ({ sources: [], node: { ...base('dial', 'New dial'), type: 'dial', props: {
    sweep: { start: 145, length: 250 }, aspect: 1.4, centerY: 0.56,
    ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: { type: 'rgba', red: 142, green: 142, blue: 147, alpha: 0.6 } },
    pointer: { kind: 'tick', value: { type: 'literal', value: 0.5 }, inner: 0.7, outer: 0.98, width: 3, ink: { type: 'solid-rgb', red: 255, green: 159, blue: 10 } } }, a11y: { element: 'hidden' } } }) },
  { type: 'arc-track', name: 'Arc', glyph: 'arc-track', make: () => ({ sources: [], node: { ...base('arc', 'New arc'), type: 'arc-track', props: {
    curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, ink: { type: 'rgba', red: 142, green: 142, blue: 147, alpha: 0.8 }, width: 2, dash: [3, 4],
    progress: { type: 'literal', value: 0.5 }, marker: { size: 10, ink: { type: 'solid-rgb', red: 255, green: 204, blue: 0 } } }, a11y: { element: 'hidden' } } }) },
  { type: 'status-rail', name: 'Status rail', glyph: 'gallery-horizontal', make: () => ({ sources: [], node: { ...base('rail', 'New rail'), type: 'status-rail', props: {}, children: [] } }) },
  { type: 'row', name: 'Row', glyph: 'list', make({ document, entityId, name }) {
    // With an entity the row shows its state; the data source is reused when the document already reads that entity.
    const { source, created } = entityId ? sourceFor(document, id => ({ id, kind: 'ha-entity', entityId: literal(entityId) }), item => holdsEntity(item, undefined, entityId), `entity-${shortId(entityId)}`) : { source: undefined, created: [] as Source[] };
    const value = source ? { type: 'read' as const, from: { type: 'source' as const, sourceId: source.id, path: ['state'] }, as: 'string' as const, missing: 'unavailable' as const } : literal('');
    return { sources: created, node: { ...base('row', name ?? 'New row'), type: 'row', props: { primary: literal(name ?? 'New row'), secondary: literal(''), value, accessory: 'none', loadingText: 'Loading', unavailableText: 'Unavailable' } } };
  } },
  { type: 'primary-button', name: 'Button', glyph: 'rectangle-horizontal', make: () => ({ sources: [], node: { ...base('button', 'New button'), type: 'primary-button', props: {}, action: { type: 'back' } } }) },
  { type: 'text', name: 'Text', glyph: 'type', make: () => ({ sources: [], node: { ...base('text', 'New text'), type: 'text', props: { value: literal('New text'), style: 'body', unavailableText: 'Unavailable' } } }) },
  { type: 'settings-link', name: 'Settings link', glyph: 'settings', make: ({ document }) => ({ sources: [], node: { ...base('link', 'New link'), type: 'settings-link', icon: symbol('gearshape'),
    props: { subtitle: '', showsChevron: true }, action: { type: 'push', pageId: firstOtherPage(document), arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } } }) },
  // A button that calls a service: the starting call has no entity chosen, which Checks names (spec D13, "Command").
  { type: 'bound-control', key: 'command', name: 'Command', glyph: 'rectangle-horizontal', make: () => ({ sources: [], node: { ...base('command', 'New Command'), type: 'bound-control', icon: symbol('bolt'),
    props: { kind: 'button', unavailableText: 'Unavailable' }, action: { type: 'call-service', domain: 'light', service: 'turn_on' } } }) },
  // A choice of two to twelve: it starts with two, each calling a service when chosen.
  { type: 'bound-control', key: 'choice', name: 'Choice', glyph: 'rows-3', make: () => {
    const option = (id: string, label: string) => ({ id, label, selectedWhen: { type: 'compare' as const, left: literal(''), op: 'eq' as const, right: literal(id) }, action: { type: 'call-service' as const, domain: 'light', service: 'turn_on' } });
    return { sources: [], node: { ...base('choice', 'New Choice'), type: 'bound-control', props: { kind: 'choice', unavailableText: 'Unavailable', options: [option('one', 'One'), option('two', 'Two')] } } as CompositionNode };
  } },
  // A readout of an entity: the value is the entity's state; the tone is Neutral until a rule says otherwise.
  { type: 'status-pill', key: 'readout', name: 'Readout', glyph: 'gauge', make({ document, entityId, name }) {
    const { source, created } = entityId ? sourceFor(document, id => ({ id, kind: 'ha-entity', entityId: literal(entityId) }), item => holdsEntity(item, undefined, entityId), `entity-${shortId(entityId)}`) : { source: undefined, created: [] as Source[] };
    const value = source ? { type: 'read' as const, from: { type: 'source' as const, sourceId: source.id, path: ['state'] }, as: 'string' as const, missing: 'unavailable' as const } : literal('Value');
    return { sources: created, node: { ...base('readout', name ?? 'New Readout'), type: 'status-pill', icon: symbol('gauge'), props: { value, detail: literal(''), tone: 'neutral', unavailableText: 'Unavailable' } } as CompositionNode };
  } },
  // A robot's map: it asks "Map of" first, and takes its robot from the document's own vacuum sources.
  { type: 'vacuum-control', key: 'map', name: 'Map', glyph: 'map', asks: 'robot', make: () => { throw new Error('Choose a robot first.'); } },
];
/** The catalog: every entry with its key (the node type unless it says otherwise). */
export const tileTypes: readonly TileType[] = entries.map(entry => ({ ...entry, key: entry.key ?? entry.type }));

/** The map of a robot: the primitive's starting values, over the document's vacuum source. */
export function makeMap(sourceId: string, title: string): Made {
  const node = { ...base('map', `${title} map`), type: 'vacuum-control', props: { sourceId, primitive: { kind: 'map', overlay: 'rooms', height: 300, runtimeHeight: 400, label: `${title} map`, loadingText: 'Loading', unavailableText: 'Unavailable', locate: true } } } as CompositionNode;
  return { node, sources: [] };
}

/** The robots a document has: its `vacuum@1` sources, with the name the descriptor gives them. */
export function robotsOf(document: CompositionDocument): { sourceId: string; title: string; entityId: string }[] {
  return document.dataSources.flatMap(source => {
    if (source.kind !== 'model' || (source as { model?: string }).model !== 'vacuum@1') return [];
    const inputs = (source as unknown as { inputs: { title?: string; entityId?: string } }).inputs;
    return [{ sourceId: source.id, title: inputs.title ?? source.id, entityId: inputs.entityId ?? '' }];
  });
}

/**
 * What a tile can do, asked when one is added ("What should this tile do?"). An action tile is one action, switching its entity on
 * or off; a toggle drawn as a tile runs one service on and another off; a navigation tile opens a page.
 */
export const tileChoices: readonly { type: 'action-tile' | 'bound-control' | 'navigation-tile' | 'state-tile'; name: string; detail: string }[] = [
  { type: 'action-tile', name: 'Switch an Entity', detail: 'Turns a switch or an input boolean on or off.' },
  { type: 'bound-control', name: 'Run On and Off Services', detail: 'Calls one service when it turns on and another when it turns off.' },
  { type: 'navigation-tile', name: 'Open a Page', detail: 'Goes to another page.' },
  { type: 'state-tile', name: 'Show a Device’s State', detail: 'Follows a door, lock, sensor or robot through its states. Can have buttons.' },
];
/** The catalog types the one "Tile" entry of the Add picker stands for. */
export const tileKinds: readonly string[] = tileChoices.map(item => item.type);

/** The two palettes of the library: layout and tiles, and controls. Each lists catalog types by node type. */
export type PaletteKind = 'components' | 'controls';
/** What each palette offers, in order. */
export const paletteGroups: Record<PaletteKind, readonly { id: string; title: string; keys: readonly string[] }[]> = {
  components: [
    { id: 'layout', title: 'Layout', keys: ['section', 'tile-grid', 'status-rail', 'local-tabs', 'overlay', 'stack', 'repeat'] },
    { id: 'tiles', title: 'Tiles', keys: ['action-tile', 'navigation-tile', 'state-tile'] },
    { id: 'content', title: 'Content', keys: ['row', 'text', 'readout', 'map', 'symbol', 'shape', 'chart', 'linear-gauge', 'dial', 'arc-track'] },
  ],
  controls: [{ id: 'controls', title: 'Controls', keys: ['bound-control', 'command', 'choice', 'primary-button', 'settings-link'] }],
};
/** What each palette offers, in order. */
export const paletteTypes: Record<PaletteKind, readonly string[]> = { components: paletteGroups.components.flatMap(group => group.keys), controls: paletteGroups.controls.flatMap(group => group.keys) };

/** The catalog entry for a node type. */
export const tileType = (key: string): TileType | undefined => tileTypes.find(item => item.key === key);

/** What an entity's domain adds when it is chosen in the Entities segment: the fitting bound tile. */
export function typeForEntity(entityId: string): TileType {
  const domain = entityId.split('.')[0];
  // A state tile is chosen on purpose ("Show a Device’s State"), never the default for a domain.
  return tileTypes.find(item => item.type !== 'state-tile' && item.domains?.includes(domain)) ?? tileTypes.find(item => item.type === 'row')!;
}

/**
 * Builds a node for an entity. Domains without a power tile get a Row titled with the entity's name (an entity-free tile the
 * person can wire from properties); the id of the entity is kept out of the title.
 */
export function makeForEntity(document: CompositionDocument, entityId: string, name?: string): Made {
  const type = typeForEntity(entityId);
  return type.make({ document, entityId, name: name || entityId });
}
export { holdsEntity };
