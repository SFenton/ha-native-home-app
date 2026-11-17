import { type CompositionDocument, type CompositionNode } from './schema';
import {
  builtInStyle, stateStyleSchema, type StateRule, type StateStyleAction, type StateStyleDefinition, type StateStyleLibrary,
} from './state-styles';

/**
 * Converts a `door-tile` into the generic `state-tile` that draws the same thing from a document style (`sh.state-style-fills@1`).
 *
 * The door tile is retired: its authored fields become a style the Studio saves in the document's library, and the node becomes a
 * `state-tile` bound to the door's entity. The style starts as a copy of the built-in `lock` or `garage-door` (so the actions, the request
 * timings and the classes are the ones the door always used) and the door's own words, symbols and fills are written over it.
 *
 * **Mapped**
 * - `states[].appearance.{text, icon, fill}` and `states[].active`: one rule per state, the state's words, glyph, fill and lit face. A state the
 *   door lists with `error: true` takes the `error` class. A built-in state the door does not list takes the door's `fallback` look, unlit, as the
 *   door drew it.
 * - `fallback.{icon, fill}`: the unknown rule (`unavailable`, `unknown`) and the style's fallback; `fallback.text` is the fallback's words.
 * - `unavailableText`: the words of the unknown rule.
 * - `hiddenText`: the style's `hiddenWords`.
 * - `errorText`: `request.errorWords`.
 * - `sendingOpenText`, `sendingCloseText` (garage only): `request.pendingWords` for `open_cover` and `close_cover`. A lock never showed them.
 * - `openLabel`, `closeLabel`, `reverseLabel`: the verbs of the matching actions. `reverseLabel` is the verb of the opening and closing states,
 *   including the alternative the door drew when the cover cannot stop.
 * - `loadingText`: an `expr` subtitle on the node, `choose` over the source's `phase` read, the words while the phase is `loading` and none otherwise.
 *
 * **Not mapped** (named in `unmapped`)
 * - the door's `sourceId` source stays in `dataSources`: the subtitle reads its `phase`, so the caller must not remove it;
 * - `sendingOpenText` and `sendingCloseText` on a lock;
 * - a stop command's words (`stop_cover`) keep the built-in "Stopping…": the door has no field for them;
 * - `loadingText` is a subtitle: while it is not blank it takes the place of the state's words (the Studio preview draws it so), and a blank one
 *   leaves the words. Native must draw a non-blank subtitle in place of the words for the first load to read as the door did.
 * - a state that no built-in rule names is added as a rule with no action.
 */

/** A `door-tile` node. */
export type DoorTileNode = Extract<CompositionNode, { type: 'door-tile' }>;
/** A `state-tile` node. */
export type StateTileNode = Extract<CompositionNode, { type: 'state-tile' }>;
type DataSource = CompositionDocument['dataSources'][number];

/** What one door converted to. */
export interface DoorConversion {
  /** The replacement node: same id, title, layout and rules as the door. */
  node: StateTileNode;
  /** The derived style; saved in the document's library by `convertDoorTiles`. */
  style: StateStyleDefinition;
  /** Authored fields with no exact home and the known approximations, each as a short sentence. */
  unmapped: string[];
}

/** Why a door cannot be converted at all. */
export class DoorConversionError extends Error {}

const defaultFill = { type: 'solid-rgb' as const, red: 84, green: 110, blue: 122 };
const ruleFill = (fill: { red: number; green: number; blue: number }) => ({ type: 'solid-rgb' as const, red: fill.red, green: fill.green, blue: fill.blue });

/**
 * Converts one door. `sources` are the document's data sources: the door's `sourceId` must name a `security-door@1` source whose entity
 * is a literal.
 * @throws DoorConversionError when the source is missing, is not a door source, or its entity is not a literal.
 */
export function convertDoorTile(door: DoorTileNode, sources: readonly DataSource[], id = `${door.id}-style`): DoorConversion {
  const source = sources.find(candidate => candidate.id === door.props.sourceId);
  if (source?.kind !== 'model' || source.model !== 'security-door@1') throw new DoorConversionError(`Door "${door.id}" has no security-door source "${door.props.sourceId}".`);
  const entityId = source.inputs.entityId.value;
  const props = door.props;
  const baseId = props.kind === 'lock' ? 'lock' : 'garage-door';
  const base = structuredClone(builtInStyle(baseId))!;
  const unmapped: string[] = [];
  const authored = new Map(props.states.map(state => [state.state, state]));

  const verb = (action: StateStyleAction | undefined, rule: StateRule) => {
    if (!action) return;
    const moving = rule.states.includes('opening') || rule.states.includes('closing');
    const label = moving && props.kind === 'garage' ? props.reverseLabel
      : action.service === 'open_cover' || action.service === 'unlock' ? props.openLabel
        : action.service === 'close_cover' || action.service === 'lock' ? props.closeLabel : undefined;
    if (label !== undefined) action.verb = label;
    if (action.otherwise && moving && props.kind === 'garage') action.otherwise.verb = props.reverseLabel;
  };

  // One rule per state, so each keeps the words and the fill the door gave it.
  const rules: StateRule[] = [];
  for (const rule of base.rules) {
    if (rule.class === 'unknown') continue;
    for (const state of rule.states) {
      const found = authored.get(state as never);
      const look = found?.appearance ?? props.fallback;
      const copy: StateRule = {
        ...structuredClone(rule), states: [state], active: found?.active ?? false,
        icon: look.icon.name, text: look.text, fill: ruleFill(look.fill ?? defaultFill),
      };
      if (found?.error && copy.class !== 'error') copy.class = 'error';
      verb(copy.action, copy);
      rules.push(copy);
    }
  }
  const named = new Set(rules.flatMap(rule => rule.states));
  for (const state of props.states) {
    if (named.has(state.state)) continue;
    rules.push({
      states: [state.state], class: state.error ? 'error' : 'resting', active: state.active,
      icon: state.appearance.icon.name, text: state.appearance.text, fill: ruleFill(state.appearance.fill),
    });
    unmapped.push(`State "${state.state}" is not one the ${baseId} style names: it became a rule with no action.`);
  }
  const unknownBase = base.rules.find(rule => rule.class === 'unknown')!;
  const unknown: StateRule = {
    ...structuredClone(unknownBase), states: ['unavailable', 'unknown'], icon: props.fallback.icon.name, text: props.unavailableText,
    fill: ruleFill(props.fallback.fill),
  };
  verb(unknown.action, unknown);
  const { states: _states, ...unknownLook } = structuredClone(base.fallback) as StateRule;
  const fallback = { ...unknownLook, icon: props.fallback.icon.name, text: props.fallback.text, fill: ruleFill(props.fallback.fill) };

  const request = structuredClone(base.request)!;
  request.errorWords = props.errorText;
  if (props.kind === 'garage') {
    request.pendingWords = (request.pendingWords ?? []).map(entry => entry.service === 'open_cover' ? { ...entry, text: props.sendingOpenText }
      : entry.service === 'close_cover' ? { ...entry, text: props.sendingCloseText } : entry);
    unmapped.push('The stop command keeps the built-in words "Stopping…": the door has no field for them.');
  } else unmapped.push('sendingOpenText and sendingCloseText are dropped: a lock never showed them.');
  unmapped.push('loadingText is a subtitle that takes the place of the state words while it is not blank; native must do the same.');

  const style: StateStyleDefinition = {
    id, name: `${door.title} look`.slice(0, 80), base: baseId, domain: base.domain, ...(base.actionId ? { actionId: base.actionId } : {}),
    ...(base.togglesDisc ? { togglesDisc: true } : {}), ...(base.drawsErrorDisc ? { drawsErrorDisc: true } : {}),
    hiddenWords: props.hiddenText, rules: [...rules, unknown], fallback, request,
  };
  const parsed = stateStyleSchema.safeParse(style);
  if (!parsed.success) throw new DoorConversionError(`Door "${door.id}" does not fit a state style: ${parsed.error.issues[0].path.join('/')}.`);

  const { props: _props, type: _type, ...shared } = door;
  const subtitle = {
    type: 'expr' as const, fallback: '',
    value: {
      type: 'choose' as const, otherwise: { type: 'literal' as const, value: '' },
      cases: [{
        when: {
          type: 'compare' as const, op: 'eq' as const, right: { type: 'literal' as const, value: 'loading' },
          left: { type: 'read' as const, from: { type: 'source' as const, sourceId: door.props.sourceId, path: ['phase'] }, as: 'string' as const, missing: 'unavailable' as const },
        },
        then: { type: 'literal' as const, value: props.loadingText },
      }],
    },
  };
  const node: StateTileNode = {
    ...shared, type: 'state-tile', icon: props.fallback.icon,
    binding: { entityId, styleId: id, builtIn: baseId }, props: { subtitle },
  };
  return { node, style, unmapped };
}

// MARK: Document

/** The result of converting a whole document. */
export interface DocumentConversion {
  /** A copy of the document with every door replaced and the derived styles added to `stateStyles`. */
  document: CompositionDocument;
  /** One entry per door converted. */
  conversions: { nodeId: string; styleId: string; unmapped: string[] }[];
}

/**
 * Converts every `door-tile` of a document (pages, modals and nested containers), in place of a copy. Two doors that derive the same style
 * share one library entry. The doors' sources stay. A document with no door comes back equal.
 * @throws DoorConversionError for the first door that cannot be converted.
 */
export function convertDoorTiles(input: CompositionDocument): DocumentConversion {
  const document = structuredClone(input);
  const library: StateStyleLibrary = document.stateStyles ?? { type: 'state-styles@1', styles: [] };
  const conversions: DocumentConversion['conversions'] = [];
  const same = (a: StateStyleDefinition, b: StateStyleDefinition) => JSON.stringify({ ...a, id: '', name: '' }) === JSON.stringify({ ...b, id: '', name: '' });
  const convert = (node: CompositionNode): CompositionNode => {
    if (node.type !== 'door-tile') { visit(node); return node; }
    let id = `${node.id}-style`, n = 2;
    while (library.styles.some(style => style.id === id)) id = `${node.id}-style-${n++}`;
    const result = convertDoorTile(node, document.dataSources, id);
    const twin = library.styles.find(style => same(style, result.style));
    if (twin) result.node.binding.styleId = twin.id;
    else library.styles.push(result.style);
    conversions.push({ nodeId: node.id, styleId: result.node.binding.styleId!, unmapped: result.unmapped });
    return result.node;
  };
  const list = (nodes: CompositionNode[]) => { nodes.forEach((node, index) => { nodes[index] = convert(node); }); };
  const visit = (node: CompositionNode) => {
    if ('children' in node && Array.isArray(node.children)) list(node.children as CompositionNode[]);
    if (node.type === 'local-tabs') {
      node.tabs.forEach(tab => list(tab.children));
      node.blocks?.forEach(block => list(block.children));
    }
  };
  for (const surface of [...document.pages, ...document.modals]) list(surface.components);
  if (conversions.length > 0) document.stateStyles = library;
  return { document, conversions };
}
