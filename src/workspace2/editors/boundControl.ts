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
  return replaceAt(document, path, { ...rest, props: { ...withoutSurface, ...(surface === undefined ? {} : { surface }), kind } } as never);
}

/**
 * Whether the editor shows the field at `at` for the bound control at `path`: false for a field the control's kind does not use.
 * Other nodes show everything.
 */
export function boundControlShows(document: CompositionDocument, path: EditorPath, at: EditorPath): boolean {
  const node = valueAt(document, path) as { type?: string; props?: { kind?: BoundControlKind } } | undefined;
  if (node?.type !== 'bound-control' || !node.props?.kind) return true;
  const below = at.slice(path.length);
  if (below.length === 1) return boundControlAllows(node.props.kind, 'node', String(below[0]));
  if (below.length === 2 && below[0] === 'props') return boundControlAllows(node.props.kind, 'props', String(below[1]));
  return true;
}
