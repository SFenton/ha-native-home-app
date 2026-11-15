import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { createId as uid } from '../../shared/ids';

/** An SF Symbol reference as the document stores it. */
export const symbol = (name: string) => ({ type: 'sf-symbol' as const, name, rendering: 'canonical' as const, unavailable: 'fallback' as const });
type Source = CompositionDocument['dataSources'][number];
const literal = (value: string) => ({ type: 'literal' as const, value });
const spacing = { type: 'token' as const, name: 'm' as const };

/** What a factory is given: the document it adds to and, for entity-bound types, the entity and its friendly name. */
export interface MakeContext { document: CompositionDocument; entityId?: string; name?: string }
/** A node and the data sources it needs (added to the document in the same undo step). */
export interface Made { node: CompositionNode; sources: Source[] }

/** One kind of thing the Add picker offers. */
export interface TileType {
  /** The node type. */
  type: CompositionNode['type'];
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

/** The tile types the Add picker offers, in the app's vocabulary. */
export const tileTypes: readonly TileType[] = [
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
  { type: 'section', name: 'Section', glyph: 'rows-3', make: () => ({ sources: [], node: { ...base('section', 'New section'), type: 'section', props: { header: 'New section', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing }, children: [] } }) },
  { type: 'tile-grid', name: 'Tile grid', glyph: 'layout-grid', make: () => ({ sources: [], node: { ...base('grid', 'New grid'), type: 'tile-grid',
    props: { minimum: 'tile@1', maxColumns: 2, spacing, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [] } }) },
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
];

/** The catalog entry for a node type. */
export const tileType = (type: string): TileType | undefined => tileTypes.find(item => item.type === type);

/** What an entity's domain adds when it is chosen in the Entities segment: the fitting bound tile. */
export function typeForEntity(entityId: string): TileType {
  const domain = entityId.split('.')[0];
  return tileTypes.find(item => item.domains?.includes(domain)) ?? tileTypes.find(item => item.type === 'row')!;
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
