/** The kinds of bound control. */
export type BoundControlKind = 'toggle' | 'stepper' | 'slider' | 'choice' | 'button';

/**
 * The `props` fields each kind of bound control uses, and the only ones the compiler accepts (any other present is
 * `invalid_combination`). The compiler and the Studio's editor read the same table, so the editor never offers a field the compiler rejects.
 */
export const boundControlProps: Readonly<Record<BoundControlKind, readonly string[]>> = {
  toggle: ['isOn'], stepper: ['value', 'range', 'format'], slider: ['value'], choice: ['options'], button: [],
};

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
