import { replaceAt } from '../../composition-editor';
import { compileCompositionDocument } from '../../shared/composition/compiler';
import { canonicalCompositionJSON } from '../../shared/composition/json';
import { childLists, componentUses, expandDocument, fieldKind, readField, type NodePath } from '../../shared/composition/components';
import { analyseRepeat, defaultUnchecked, planRepeat, type RepeatAnalysis, type RepeatClass, type RepeatGroup, type RepeatPlace, type RepeatPlan } from '../../shared/composition/repeats';
import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { setParamLabel, setPerPlace } from '../params';
import { paramNameFor } from './repeatWords';
import { saveRepeat, type RepeatSave } from './saveRepeat';

/**
 * Tile templates from a document, without the dialog (the scriptable path of Save as Template). A conversion names the tiles of one kind by id, and
 * this makes one template from them and puts a place of it where each tile stood. It reuses the pieces the dialog uses ({@link analyseRepeat},
 * {@link planRepeat}, {@link saveRepeat}), so a place keeps the id of its tile and draws what the tile drew.
 */

/** What one conversion asks for. */
export interface TileConversion {
  /** The template's name. */
  name: string;
  /** The ids of the tiles to convert, all of one kind. */
  nodeIds: readonly string[];
  /**
   * The label of each setting, by the slash path of a field it fills (`title`, `props/sourceId`). A setting takes the label of the first of its fields
   * this lists, so one entry names a setting that fills several fields.
   */
  labels: Readonly<Record<string, string>>;
  /**
   * Settings the places do not differ in yet, that the template should still offer (a name or an icon every place shares today). Each is a label and the
   * fields of the template's root it fills; a field a setting above already fills is left alone, and a label an existing setting has joins to it.
   * Every place keeps the value it has, so what is drawn does not change.
   */
  also?: readonly { label: string; fields: readonly string[] }[];
}

/** A conversion that did not leave the document drawing what it drew. */
export class ConversionError extends Error {
  constructor(message: string, readonly analysis?: RepeatAnalysis, readonly plan?: RepeatPlan) { super(message); this.name = 'ConversionError'; }
}

/** The places of the tiles with these ids, in document order. */
function placesOf(document: Pick<CompositionDocument, 'pages' | 'modals'>, wanted: ReadonlySet<string>): { places: RepeatPlace[]; type: string } {
  const places: RepeatPlace[] = [];
  const types = new Set<string>();
  const visit = (node: CompositionNode, path: NodePath, surface: RepeatPlace['surface']) => {
    if (wanted.has(node.id)) { places.push({ nodeId: node.id, path, surface }); types.add(node.type); }
    for (const list of childLists(node)) list.nodes.forEach((child, at) => visit(child, [...path, ...list.path, at], surface));
  };
  for (const kind of ['pages', 'modals'] as const) {
    document[kind].forEach((surface, index) => surface.components.forEach((node, at) => visit(node, [kind, index, 'components', at], { kind: kind === 'pages' ? 'page' : 'modal', id: surface.id, title: surface.title, index })));
  }
  if (types.size > 1) throw new ConversionError(`The tiles are of more than one type (${[...types].join(', ')})`);
  return { places, type: [...types][0] ?? '' };
}

/** The label a group takes from the conversion, by its first field the conversion names. */
function labelOf(group: RepeatGroup, labels: TileConversion['labels']): string | undefined {
  for (const field of group.fields) if (labels[field.field] !== undefined) return labels[field.field];
  return undefined;
}

/**
 * Makes one template from the tiles a conversion names and swaps each tile for a place of it, in one document.
 *
 * @throws {ConversionError} When an id is missing, when a field that differs has no label or cannot be a setting, or when a tile would have to stay as it is.
 */
export function convertTiles(document: CompositionDocument, conversion: TileConversion): RepeatSave {
  const wanted = new Set(conversion.nodeIds);
  const { places, type } = placesOf(document, wanted);
  if (places.length !== wanted.size) throw new ConversionError(`Found ${places.length} of the ${wanted.size} tiles`);
  const cls: RepeatClass = { id: places[0].nodeId, type, size: 1, places };
  const analysis = analyseRepeat(document, cls);
  const plan = planRepeat(analysis, defaultUnchecked(analysis));
  if (plan.kept.length !== places.length) throw new ConversionError(`${places.length - plan.kept.length} of ${places.length} tiles would stay as they are`, analysis, plan);
  const labels = new Map<string, string>();
  for (const group of plan.checked) {
    const label = labelOf(group, conversion.labels);
    if (label === undefined) throw new ConversionError(`No label for the setting that fills ${group.fields.map(field => field.field).join(', ')}`, analysis, plan);
    labels.set(group.id, label);
  }
  const saved = saveRepeat(document, analysis, plan, conversion.name, labels);
  const result = conversion.also?.length ? { ...saved, document: addSettings(saved.document, saved.entryId, conversion.also) } : saved;
  // The gate: the worked-out document is the same before and after, whatever the settings did.
  if (workedOut(result.document) !== workedOut(document)) throw new ConversionError('The worked-out document would change: a setting gives a tile a value it did not have');
  return result;
}

/** The published form of a document with every place worked out and the library left out: what a phone draws. Two equal strings draw the same. */
export function workedOut(document: CompositionDocument): string {
  const { componentLibrary: _library, ...rest } = expandDocument(compileCompositionDocument(document).expanded);
  return canonicalCompositionJSON(rest);
}

/** Adds each `also` setting to the template `entryId`; one that is already filled is skipped. */
function addSettings(document: CompositionDocument, entryId: string, also: NonNullable<TileConversion['also']>): CompositionDocument {
  let next = document;
  const entryOf = (doc: CompositionDocument) => doc.componentLibrary!.find(item => item.id === entryId)!;
  for (const setting of also) {
    for (const field of setting.fields) {
      const entry = entryOf(next);
      if (entry.bindings?.some(binding => binding.nodeId === entry.node.id && binding.field === field)) continue;
      const joined = entry.params?.find(param => param.label === setting.label);
      // A source of a model (not a plain entity) is a setting the dialog makes but the inspector's Set Per Place does not: the place names the source.
      if (fieldKind(entry.node, field) === 'source-id') { next = addSourceSetting(next, entryId, field, setting.label, joined?.name); continue; }
      try { next = setPerPlace(next, entryId, entry.node.id, field, joined?.name); }
      catch (error) { throw new ConversionError(`${setting.label}: ${error instanceof Error ? error.message : String(error)}`); }
      if (!joined) {
        const added = entryOf(next).params!.find(param => !entry.params?.some(old => old.name === param.name))!;
        next = setParamLabel(next, entryId, added.name, setting.label);
      }
    }
  }
  return next;
}

/** Adds a Source setting for `field` of the template's root, each place keeping the source it reads now; it joins `joinTo` when given. */
function addSourceSetting(document: CompositionDocument, entryId: string, field: string, label: string, joinTo: string | undefined): CompositionDocument {
  const at = document.componentLibrary!.findIndex(item => item.id === entryId);
  const entry = document.componentLibrary![at];
  const current = readField(entry.node, field) as string;
  const name = joinTo ?? paramNameFor(label, new Set((entry.params ?? []).map(param => param.name)));
  let next = replaceAt(document, ['componentLibrary', at], {
    ...entry,
    params: joinTo ? entry.params : [...(entry.params ?? []), { name, kind: 'source-id' as const, label }],
    bindings: [...(entry.bindings ?? []), { param: name, nodeId: entry.node.id, field }],
  });
  for (const use of componentUses(next, entryId)) next = replaceAt(next, use.path, { ...use.ref, args: { ...use.ref.args, [name]: use.ref.args?.[name] ?? current } });
  return next;
}
