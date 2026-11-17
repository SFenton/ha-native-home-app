import { compositionChildren, type CompositionDocument, type CompositionNode } from '../../shared/composition/schema';
import { REPEAT_LIMITS, type RepeatAnalysis, type RepeatClass, type RepeatGroup, type RepeatPlace, type RepeatPlan, type RepeatResult } from '../../shared/composition/repeats';
import { fieldLabel, kindWords } from '../params';
import { freeName, nameTaken, tileTypes } from '../linked';
import { identifierSchema } from '../../shared/validation';
import { typeName } from '../util';
import { valueAt } from '../../composition-editor';

/**
 * The words of Repeated Pieces (templates spec, "Copy": Repeats). Plain functions over the walk's results, so a test can read every sentence
 * without drawing anything.
 */

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The summary under the level's title: "49 found in 218 places". */
export const summaryText = (result: Pick<RepeatResult, 'classes' | 'placeCount'>): string => `${result.classes.length} found in ${plural(result.placeCount, 'place')}`;

/** How many places a row says: "14 places". */
export const placesText = (count: number): string => plural(count, 'place');

function inside(node: CompositionNode): CompositionNode[] { return compositionChildren(node).flatMap(child => [child, ...inside(child)]); }

/** The node at the first place of a class, or undefined when the document no longer has it. */
export const firstNode = (document: Pick<CompositionDocument, 'pages' | 'modals'>, cls: RepeatClass): CompositionNode | undefined => valueAt(document, cls.places[0].path) as CompositionNode | undefined;

/** What a piece is, in a row and the proposal's header: "Tile grid, 3 tiles". */
export function pieceText(document: Pick<CompositionDocument, 'pages' | 'modals'>, cls: RepeatClass): string {
  const node = firstNode(document, cls);
  const held = node ? inside(node) : [];
  const count = Math.max(held.length, cls.size - 1);
  const tiles = held.length > 0 && held.every(item => tileTypes.has(item.type));
  return `${typeName(cls.type)}, ${plural(count, tiles ? 'tile' : 'thing')}`;
}

/** The count line of the proposal: "Repeated in 14 places". */
export const repeatedText = (count: number): string => `Repeated in ${plural(count, 'place')}`;

/** The Places group's title: "Places (14)", or "Places (9 of 14)" while some are left out. */
export const placesTitle = (kept: number, all: number): string => kept === all ? `Places (${all})` : `Places (${kept} of ${all})`;

/** The second line of a place row: "Tab · Lights", "Page" or "Sheet". */
export const placeKindText = (place: RepeatPlace): string => place.tab ? `Tab · ${place.tab.label}` : place.surface.kind === 'page' ? 'Page' : 'Sheet';

/** The tag on the canvas: "1 of 14". */
export const markText = (at: number, count: number): string => `${at + 1} of ${count}`;

/** The row's label for each group, numbered when two share a name: "Entity 1", "Entity 2". */
export function groupLabels(analysis: RepeatAnalysis): Map<string, string> {
  const base = analysis.groups.map(group => fieldLabel(group.fields[0].nodeType, group.fields[0].field.split('/')));
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const name of base) total.set(name, (total.get(name) ?? 0) + 1);
  return new Map(analysis.groups.map((group, at) => {
    const name = base[at], number = (seen.get(name) ?? 0) + 1;
    seen.set(name, number);
    return [group.id, (total.get(name) ?? 0) > 1 ? `${name} ${number}` : name];
  }));
}

/** The second line of a proposal row: "Entity · 14 different · fills 3 fields". */
export const groupText = (group: RepeatGroup): string =>
  `${kindWords[group.kind]} · ${group.distinct} different · fills ${plural(group.fields.length, 'field')}`;

/** The line under the parameters when more are found than a template holds. */
export const limitText = `A template holds ${REPEAT_LIMITS.params} parameters.`;

/**
 * The foot of the proposal. Nothing left out: "Replaces 14 places with one template." Otherwise the count and one sentence for each reason:
 * "Replaces 9 of 14 places. 5 use another Icon 1 and stay as they are."
 */
export function footText(plan: RepeatPlan, all: number, labels: ReadonlyMap<string, string>): string {
  if (plan.kept.length === all) return `Replaces ${all} places with one template.`;
  const head = `Replaces ${plan.kept.length} of ${all} places.`;
  const reasons = plan.reasons.map(reason => {
    const one = reason.places === 1;
    if (reason.group) return `${reason.places} ${one ? 'uses' : 'use'} another ${labels.get(reason.group.id) ?? 'value'} and ${one ? 'stays as it is' : 'stay as they are'}.`;
    const field = reason.field!;
    return `${reason.places} ${one ? 'differs' : 'differ'} in ${fieldLabel(field.nodeType, field.field.split('/'))}, which a template cannot set.`;
  });
  return [head, ...reasons].join(' ');
}

/** The suggested name of a new template: the piece's type in words, made free by a number. */
export function suggestTemplateName(document: Pick<CompositionDocument, 'componentLibrary'>, cls: RepeatClass): string {
  const base = typeName(cls.type);
  return nameTaken(document, base) ? freeName(document, base) : base;
}

/** The identifier of a parameter made from its label, free among `taken`. */
export function paramNameFor(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'setting';
  const start = identifierSchema.safeParse(base).success ? base : `setting_${base}`;
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) if (!taken.has(`${start}_${n}`)) return `${start}_${n}`;
}

/** The status line after a save: "Saved Light Grid. 14 places use it." */
export const savedText = (name: string, places: number): string => `Saved ${name}. ${plural(places, 'place')} use${places === 1 ? 's' : ''} it.`;
