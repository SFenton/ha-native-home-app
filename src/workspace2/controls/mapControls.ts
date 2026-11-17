import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { effectiveControls, withControls, type SurfaceButton, type SurfaceControls, type SurfaceCorner } from '../../shared/composition/surface-controls';
import { vacuumCommandLooks, type VacuumControl } from '../../shared/composition/vacuum';

/** The map primitive of a `vacuum-control` node. */
export type MapPrimitive = Extract<VacuumControl['props']['primitive'], { kind: 'map' }>;
/** The pieces of a map node the inspector reads: its primitive, where that is, and the vacuum source it draws. */
export interface MapNode { node: VacuumControl; primitive: MapPrimitive; primitivePath: EditorPath; sourceIndex: number }

/** The map a node path names, or `undefined` when the node is not a vacuum map. */
export function mapNodeAt(document: CompositionDocument, path: EditorPath): MapNode | undefined {
  const node = valueAt(document, path) as VacuumControl | undefined;
  if (node?.type !== 'vacuum-control' || node.props.primitive.kind !== 'map') return undefined;
  const sourceIndex = document.dataSources.findIndex(source => source.id === node.props.sourceId);
  return { node, primitive: node.props.primitive, primitivePath: [...path, 'props', 'primitive'], sourceIndex };
}
/** The groups a map draws now: the authored ones or the default Locate. */
export const groupsOf = (map: MapNode): SurfaceControls => effectiveControls(map.primitive);
/** The document with the map's groups replaced (and `locate` kept truthful, `controls` dropped when it is the default). */
export const withGroups = (document: CompositionDocument, map: MapNode, controls: SurfaceControls): CompositionDocument =>
  replaceAt(document, map.primitivePath, withControls(map.primitive, controls) as never);

/** The vacuum source a map draws, when the document has it. */
export function vacuumSourceOf(document: CompositionDocument, map: MapNode) {
  const source = document.dataSources[map.sourceIndex];
  return source?.kind === 'model' && source.model === 'vacuum@1' ? source : undefined;
}
/** The document with the vacuum's flips set; both off removes the object, so a map that draws as before declares nothing new. */
export function withFlips(document: CompositionDocument, map: MapNode, flipHorizontal: boolean, flipVertical: boolean): CompositionDocument {
  const path: EditorPath = ['dataSources', map.sourceIndex, 'inputs'];
  const { orientation: _old, ...inputs } = valueAt(document, path) as Record<string, unknown>; void _old;
  return replaceAt(document, path, (flipHorizontal || flipVertical ? { ...inputs, orientation: { flipHorizontal, flipVertical } } : inputs) as never);
}

/** The words a button's label shows in a list: the plain label, or "Follows a rule" when it is a slot. */
export const labelWords = (button: SurfaceButton): string => typeof button.label === 'string' ? button.label : 'Follows a rule';
/** What a button does, in a few words, for its row. */
export function doesWords(button: SurfaceButton): string {
  const action = button.action;
  if (action.type === 'map') return 'Locate';
  if (action.type === 'source-command') return `Robot: ${vacuumCommandLooks[action.command as keyof typeof vacuumCommandLooks]?.label ?? action.command}`;
  if (action.type === 'call-service') return `${action.domain}.${action.service}`;
  return 'Opens a page or sheet';
}

/** A new button of a kind, with its symbol and label filled in so it is valid at once. */
export type NewKind = 'locate' | 'command' | 'service' | 'page';
export function newButton(kind: NewKind, document: CompositionDocument, id: string): SurfaceButton {
  const icon = (name: string) => ({ type: 'sf-symbol' as const, name, rendering: 'canonical' as const, unavailable: 'fallback' as const });
  switch (kind) {
    case 'locate': return { id, icon: icon('scope'), label: 'Locate', hint: 'Asks the robot to play a sound.', action: { type: 'map', command: 'locate' } };
    case 'command': return { id, icon: icon(vacuumCommandLooks.dock.symbol), label: vacuumCommandLooks.dock.label, action: { type: 'source-command', command: 'dock' } };
    case 'service': return { id, icon: icon('bolt.fill'), label: 'Button', action: { type: 'call-service', domain: 'light', service: 'toggle' } };
    case 'page': return { id, icon: icon('arrow.right'), label: 'Open Page',
      action: { type: 'push', pageId: document.pages[1]?.id ?? document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } };
  }
}
/** The base of a new button's id for a kind. */
export const idBase: Record<NewKind, string> = { locate: 'locate', command: 'command', service: 'service', page: 'page' };
/** The corners in screen order, with their words. */
export const cornerOrder: readonly SurfaceCorner[] = ['top-leading', 'top-trailing', 'bottom-leading', 'bottom-trailing'];
