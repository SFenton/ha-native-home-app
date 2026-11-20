import { replaceAt, valueAt } from '../../composition-editor';
import { bodyNodes, readField } from '../../shared/composition/components';
import { omitFoldSide, type FoldSide } from '../../shared/composition/fold-sides';
import type { RepeatAnalysis, RepeatPlan } from '../../shared/composition/repeats';
import { createId as uid } from '../../shared/ids';
import type { ComponentEntry, ComponentRefNode, CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { labelValid } from '../params';
import { MAX_COMPONENTS, nameTaken, nameValid } from '../linked';
import { paramNameFor, savedText } from './repeatWords';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { editSubtrees } from '../editors/provenance';
import { fieldPointer } from '../logic-fields/registry';

/** What Save as Template makes of a repeated piece. */
export interface RepeatSave {
  document: CompositionDocument;
  entryId: string;
  /** How many places now use the template. */
  places: number;
  /** The status line. */
  message: string;
}

/**
 * Saves a repeated piece as a template (templates spec 5): one new entry, and each place the plan keeps replaced by a reference that has its own
 * values. The entry's body is the first kept place, with a fresh root id and a width of 1; each checked group is one parameter, bound to every
 * field it fills, with the label the person gave it. A place keeps the id of the node it replaces, so a selection or a link to it carries over.
 * The result is one document, so one undo step, and every place draws as it did: the plan leaves out any place a parameter could not reproduce.
 *
 * @param labels The label of each checked group, by group id.
 * @throws When the name or a label is not valid, the library is full, or fewer than two places are left.
 */
export function saveRepeat(document: CompositionDocument, analysis: RepeatAnalysis, plan: RepeatPlan, name: string, labels: ReadonlyMap<string, string>): RepeatSave {
  if (plan.kept.length < 2) throw new Error('A template needs at least 2 places');
  if ((document.componentLibrary?.length ?? 0) >= MAX_COMPONENTS) throw new Error(`A document holds at most ${MAX_COMPONENTS} templates`);
  const title = name.trim();
  if (!nameValid(title)) throw new Error('Name the template in 1 to 80 characters');
  if (nameTaken(document, title)) throw new Error(`A template named ${title} already exists.`);
  const places = plan.kept.map(at => analysis.cls.places[at]);
  const effective = resolveLogicUseBindings(document).document;
  const nodes = places.map(place => valueAt(effective, place.path) as CompositionNode | undefined);
  if (nodes.some(node => !node)) throw new Error('A place of this piece has changed. Look for repeated pieces again.');
  const first = nodes[0]!;
  const body = { ...first, id: uid('native'), layout: { ...omitFoldSide(first.layout), span: 1 } } as CompositionNode;
  const inBody = bodyNodes(body);
  const taken = new Set<string>();
  const params: NonNullable<ComponentEntry['params']> = [], bindings: NonNullable<ComponentEntry['bindings']> = [];
  const named = plan.checked.map(group => {
    const label = (labels.get(group.id) ?? '').trim();
    if (!labelValid(label)) throw new Error('Name each setting in 1 to 80 characters');
    const param = paramNameFor(label, taken);
    taken.add(param);
    params.push({ name: param, kind: group.kind, label });
    for (const field of group.fields) bindings.push({ param, nodeId: inBody[field.index].id, field: field.field });
    return { group, param };
  });
  const entry: ComponentEntry = { id: uid('component'), name: title, ...(params.length ? { params } : {}), ...(bindings.length ? { bindings } : {}), node: body };
  let next = document;
  plan.kept.forEach((at, order) => {
    const node = nodes[order]!;
    // Each place keeps its own fold side (`sh.fold-sides@1`) on its reference; the template body holds none.
    const side = (node.layout as { foldSide?: FoldSide }).foldSide;
    const args = Object.fromEntries(named.map(({ group, param }) => {
      const field = group.fields[0];
      const value = readField(bodyNodes(node)[field.index], field.field);
      if (typeof value !== 'string') throw new Error('A repeated piece setting changed. Look for repeated pieces again.');
      return [param, value];
    }));
    const ref: ComponentRefNode = { id: node.id, type: 'component-ref', componentId: entry.id, layout: { ...(node.layout.span === undefined ? {} : { span: node.layout.span }), ...(side === undefined ? {} : { foldSide: side }) }, ...(named.length ? { args } : {}) };
    next = replaceAt(next, places[order].path, ref);
  });
  next = { ...next, componentLibrary: [...(document.componentLibrary ?? []), entry] };
  const target = fieldPointer(['componentLibrary', document.componentLibrary?.length ?? 0, 'node']);
  return { document: editSubtrees(document, next, { relocated: new Map(places.map(place => [fieldPointer(place.path), [target]])) }),
    entryId: entry.id, places: places.length, message: savedText(title, places.length) };
}
