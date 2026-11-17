/**
 * How a `stack` (`sh.stack@1`) chooses between its two arrangements: the one it is written in, and the collapsed one a horizontal stack falls back to
 * at an accessibility text size or when the children that must fit beside each other do not.
 *
 * The rules are the ones the app's hand-laid weather card header follows (`UKWeatherCard.layout`, native-ingest): the header stacks when the text size is an
 * accessibility size, or when the range text is wider than the room left beside the reading, measured from natural widths that do not depend on the
 * layout chosen, with half a point of tolerance. The shared evaluation corpus (`contract/corpus/evaluation/stack-*.json`) pins them, so the app's own
 * measuring and this module agree.
 */
import type { StackGroup, StackProps } from './schema';

/** A spacing value as the document writes it. */
export type StackSpace = { type: 'token'; name: string } | { type: 'points'; value: number };
/** The canonical spacing tokens. `section-header` is 10, as native `SpaceToken.sectionHeader`, apple/Sources/HassCore/ServerUIComposition/ServerUICompositionDocument.swift:143 (native-home fcbb4876) (it was 20 here until integ11). */
const tokens: Record<string, number> = { zero: 0, xs: 4, s: 8, m: 12, l: 16, xl: 24, 'section-header': 10 };
/** Points for a spacing value (the canonical tokens: zero 0, xs 4, s 8, m 12, l 16, xl 24, section-header 10). */
export const spacePoints = (space: StackSpace | undefined, fallback = 0): number => !space ? fallback : space.type === 'points' ? space.value : tokens[space.name] ?? fallback;

/** One child as measured: its natural width in points, and whether it can give room (a text whose overflow is `truncate` or `ticker`). */
export interface StackMeasure { id: string; width: number; shrinks?: boolean }
/** What a stack needs to choose: its props, its children as measured, the width inside its padding and the text size class. */
export interface StackLayoutInput {
  props: Pick<StackProps, 'axis' | 'spacing' | 'groups' | 'collapse'>;
  children: StackMeasure[];
  width: number;
  accessibilitySize: boolean;
}
/** One group of the chosen arrangement: its children, the points between them, and whether it takes the room the others leave. */
export interface StackGroupLayout { children: string[]; spacing: number; distribution: 'natural' | 'spread'; align: 'start' | 'center' | 'end'; grow: boolean }
/** The arrangement chosen. */
export interface StackLayout {
  collapsed: boolean;
  /** Why it collapsed, or `null`. When both hold the text size is named first. */
  reason: 'accessibility-size' | 'overflow' | null;
  axis: 'horizontal' | 'vertical';
  /** The points between groups. */
  spacing: number;
  groups: StackGroupLayout[];
}
/** Half a point: a header whose natural widths fit within it does not collapse (the app's rounding tolerance). */
export const OVERFLOW_TOLERANCE = 0.5;

function resolveGroups(groups: StackGroup[] | undefined, children: StackMeasure[], spacing: number): StackGroupLayout[] {
  const own = groups ?? children.map(child => ({ children: [child.id] }) as StackGroup);
  return own.map(group => ({
    children: group.children, spacing: group.spacing ? spacePoints(group.spacing) : spacing,
    distribution: group.distribution ?? 'natural', align: group.align ?? 'start', grow: group.grow ?? false,
  }));
}

/**
 * Whether the children that must fit do not, side by side. A group needs the widest of the children it counts: the ones `fits` names, or, in a group that
 * names none, the ones that cannot give room. The groups need their widths plus the spacing between them.
 */
export function stackOverflows(props: StackLayoutInput['props'], children: StackMeasure[], width: number): boolean {
  const named = new Set(props.collapse?.fits ?? []);
  const byId = new Map(children.map(child => [child.id, child]));
  const base = props.groups ?? children.map(child => ({ children: [child.id] }));
  if (named.size > 0 && ![...named].some(id => (byId.get(id)?.width ?? 0) > 0)) return false;
  const spacing = spacePoints(props.spacing);
  let need = 0;
  for (const group of base) {
    const members = group.children.map(id => byId.get(id)).filter((child): child is StackMeasure => child !== undefined);
    const hasNamed = members.some(child => named.has(child.id));
    need += Math.max(0, ...members.filter(child => named.has(child.id) || (!hasNamed && !child.shrinks)).map(child => child.width));
  }
  need += spacing * Math.max(0, base.length - 1);
  return need > width + OVERFLOW_TOLERANCE;
}

/** The arrangement a stack draws now. */
export function layoutStack(input: StackLayoutInput): StackLayout {
  const { props, children } = input;
  const spacing = spacePoints(props.spacing);
  const collapse = props.axis === 'horizontal' ? props.collapse : undefined;
  const reason = !collapse ? null
    : collapse.when.includes('accessibility-size') && input.accessibilitySize ? 'accessibility-size'
      : collapse.when.includes('overflow') && stackOverflows(props, children, input.width) ? 'overflow' : null;
  if (!collapse || !reason) return { collapsed: false, reason: null, axis: props.axis, spacing, groups: resolveGroups(props.groups, children, spacing) };
  const next = collapse.spacing ? spacePoints(collapse.spacing) : spacing;
  return { collapsed: true, reason, axis: 'vertical', spacing: next, groups: resolveGroups(collapse.groups ?? props.groups, children, next) };
}
