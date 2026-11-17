import type { CompositionIssue } from './json';
import type { RepeatNode } from './schema';

/**
 * The rules of the `repeat` node (`sh.repeat@1`) that need only the node itself: its paging against its axis and its counts, and its placeholder against its
 * children. What needs the document (the flow it names, the records' shape for `item` paths, nesting) is the compiler's `repeat`. Pointers are absolute
 * (they start at `at`, the node's own pointer).
 */
export const REPEAT_CAPABILITY_NAME = 'repeat';

/**
 * Checks a repeat's own fields.
 * - `paging` is for a horizontal repeat: a vertical one is not paged (`invalid_combination` at `paging`).
 * - `paging.minimum` is at most `compact` and at most `regular` (`invalid_value`): it is the fewest items a page may shrink to.
 * - `paging.scaleByTextSize` never grows with the text size: each factor is at most the one before (`invalid_value`).
 * - `paging.buttons` of `regular-width` and a `label` are about paging only, so they need `paging` (they sit inside it).
 * - `placeholder` is drawn from the second child: both or neither (`missing_required` at `children` when the count is set and the child is not;
 *   `invalid_combination` at the child when the child has no count).
 */
export function checkRepeat(node: RepeatNode, at: string): { issues: CompositionIssue[] } {
  const issues: CompositionIssue[] = [];
  const add = (code: CompositionIssue['code'], pointer: string) => issues.push({ code, pointer });
  const { paging, placeholder } = node.props;
  if (paging) {
    if (node.props.axis !== 'horizontal') add('invalid_combination', `${at}/props/paging`);
    if (paging.minimum !== undefined && (paging.minimum > paging.compact || paging.minimum > paging.regular)) add('invalid_value', `${at}/props/paging/minimum`);
    const scale = paging.scaleByTextSize;
    if (scale && scale.some((factor, index) => index > 0 && factor > scale[index - 1])) add('invalid_value', `${at}/props/paging/scaleByTextSize`);
  }
  if (placeholder && node.children.length < 2) add('missing_required', `${at}/children`);
  else if (!placeholder && node.children.length > 1) add('invalid_combination', `${at}/children/1`);
  return { issues };
}
