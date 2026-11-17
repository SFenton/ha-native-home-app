import type { CompositionDocument } from '../../shared/composition/schema';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { boundControlAllows, kindDependentActions, kindDependentProps, type BoundControlKind } from '../../shared/composition/bound-control';

/** The kinds a bound control can take, in the order the Kind row lists them. */
export const boundControlKinds: readonly BoundControlKind[] = ['toggle', 'stepper', 'slider', 'choice', 'button'];

/**
 * A bound control at `path` with its kind changed. Every field the new kind does not use (a toggle's "When turned on" under a
 * button, a button's "When tapped" under a toggle) is dropped with it, so changing the kind never leaves a combination the
 * compiler rejects. Fields the new kind needs and the control lacks are left for the person to add: Checks names them.
 */
export function withBoundControlKind(document: CompositionDocument, path: EditorPath, kind: BoundControlKind): CompositionDocument {
  const node = valueAt(document, path) as Record<string, unknown> & { props: Record<string, unknown> };
  const props = Object.fromEntries(Object.entries(node.props).filter(([key]) => !(kindDependentProps as readonly string[]).includes(key) || boundControlAllows(kind, 'props', key)));
  const rest = Object.fromEntries(Object.entries(node).filter(([key]) => !(kindDependentActions as readonly string[]).includes(key) || boundControlAllows(kind, 'node', key)));
  const surface = kind === 'toggle' ? props.surface : undefined;
  const { surface: _surface, ...withoutSurface } = props;
  // The parts that belong to one kind go with it: a row's parts and its face stay on a toggle, the entity's options on a choice.
  const kept = Object.fromEntries(Object.entries(withoutSurface).filter(([key]) => !(rowPartKeys.includes(key) && kind !== 'toggle') && !(key === 'optionsFrom' && kind !== 'choice')));
  return replaceAt(document, path, { ...rest, props: { ...kept, ...(surface === undefined ? {} : { surface }), kind } } as never);
}

/** The `props` of a toggle row (`sh.bound-row-parts@1`, `sh.check-face@1`): the compiler refuses them on any other kind or on a tile surface. */
const rowPartKeys: readonly string[] = ['subtitle', 'hint', 'metrics', 'failureText', 'glyph', 'face', 'checkTint'];
/** The parts a check face does not draw: its leading slot is the circle and the title is all of its text. */
const notOnCheck: readonly string[] = ['subtitle', 'glyph', 'metrics'];

/**
 * Whether the editor shows the field at `at` for the bound control at `path`: false for a field the control's kind does not use, and for a row part
 * on anything but a toggle drawn as a row. A check face also hides the parts it does not draw, and the node's own icon. Other nodes show everything.
 */
export function boundControlShows(document: CompositionDocument, path: EditorPath, at: EditorPath): boolean {
  const node = valueAt(document, path) as { type?: string; icon?: unknown; props?: { kind?: BoundControlKind; surface?: string; face?: string } } | undefined;
  if (node?.type !== 'bound-control' || !node.props?.kind) return true;
  const below = at.slice(path.length);
  if (below.length === 1 && below[0] === 'icon' && node.props.face === 'check') return false;
  if (below.length === 1) return boundControlAllows(node.props.kind, 'node', String(below[0]));
  if (below.length === 2 && below[0] === 'props') {
    const key = String(below[1]);
    if (rowPartKeys.includes(key)) {
      if (node.props.kind !== 'toggle' || (node.props.surface ?? 'row') !== 'row') return false;
      if (key === 'checkTint') return node.props.face === 'check';
      return !(node.props.face === 'check' && notOnCheck.includes(key));
    }
    if (key === 'optionsFrom') return node.props.kind === 'choice';
    return boundControlAllows(node.props.kind, 'props', key);
  }
  return true;
}

/**
 * A toggle with its face changed (`sh.check-face@1`). A check mark row has its circle where an icon would sit and its title for all its text, so choosing it
 * drops the icon, subtitle, glyph tint and row size, and going back to a switch drops the check color; the compiler would refuse the combination.
 */
export function withBoundControlFace(document: CompositionDocument, path: EditorPath, face: 'switch' | 'check'): CompositionDocument {
  const node = valueAt(document, path) as Record<string, unknown> & { props: Record<string, unknown> };
  const dropped = face === 'check' ? notOnCheck : ['checkTint'];
  const props = Object.fromEntries(Object.entries(node.props).filter(([key]) => !dropped.includes(key)));
  const { icon: _icon, ...rest } = node;
  return replaceAt(document, path, { ...(face === 'check' ? rest : node), props: { ...props, face } } as never);
}
