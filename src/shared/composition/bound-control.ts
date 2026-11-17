import type { Json } from '../types';
import { titleCase } from './pipeline/text';

/** The kinds of bound control. */
export type BoundControlKind = 'toggle' | 'stepper' | 'slider' | 'choice' | 'button';

/**
 * The `props` fields each kind of bound control uses, and the only ones the compiler accepts (any other present is
 * `invalid_combination`). The compiler and the Studio's editor read the same table, so the editor never offers a field the compiler rejects.
 */
export const boundControlProps: Readonly<Record<BoundControlKind, readonly string[]>> = {
  toggle: ['isOn'], stepper: ['value', 'range', 'format'], slider: ['value'], choice: ['options'], button: [],
};
/** The most options a choice offers, authored or read from an entity (`sh.bound-options-read@1`). */
export const MAX_CHOICE_OPTIONS = 12;

/** The node-level action fields each kind uses; the others are `invalid_combination`. */
export const boundControlActions: Readonly<Record<BoundControlKind, readonly string[]>> = {
  toggle: ['onAction', 'offAction'], stepper: ['action'], slider: ['action'], choice: [], button: ['action'],
};

/** Every field that depends on the kind. */
export const kindDependentProps = ['isOn', 'value', 'range', 'format', 'options'] as const;
export const kindDependentActions = ['onAction', 'offAction', 'action'] as const;

/** Whether a bound control of `kind` may carry `field` (a `props` key, or an action key on the node itself). */
export function boundControlAllows(kind: BoundControlKind, scope: 'props' | 'node', field: string): boolean {
  const table = scope === 'props' ? boundControlProps : boundControlActions;
  const dependent: readonly string[] = scope === 'props' ? kindDependentProps : kindDependentActions;
  return !dependent.includes(field) || table[kind].includes(field);
}

/** One option read from an entity's list: the item as the entity holds it, and the words drawn for it. */
export interface ReadOption { value: string; label: string }

/**
 * The options of a choice whose `optionsFrom` reads `list` (`sh.bound-options-read@1`): the items that are text and not blank, each once and in the
 * list's order, at most {@link MAX_CHOICE_OPTIONS}. Anything else in the list is left out. When fewer than two remain, or the list is not a list, the
 * result is `undefined`: the choice keeps its authored `options` (the fallback).
 */
export function optionsFromList(list: Json | undefined, labels: 'as-is' | 'title-case'): ReadOption[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set<string>();
  const options: ReadOption[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim() || seen.has(item)) continue;
    seen.add(item);
    options.push({ value: item, label: labels === 'title-case' ? titleCase(item) : item });
    if (options.length === MAX_CHOICE_OPTIONS) break;
  }
  return options.length >= 2 ? options : undefined;
}
