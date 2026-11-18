import { createContext, useContext, useSyncExternalStore } from 'react';

/** The logic template whose body an editor is drawing: its settings are named by label, and the value picker offers them first. */
export interface LogicScopeValue { entryId: string }
const Scope = createContext<LogicScopeValue | undefined>(undefined);
/** Provides the template being edited to the editors below it (the inspector's Properties panel). */
export const LogicScopeProvider = Scope.Provider;

// MARK: The pushed path
// A page pushed inside a sheet is drawn by the stack that holds it, not by the page that pushed it, so a provider around the pushing page does not reach it.
// The Project sheet (a phone) therefore says which template is open here, and the stack's pages read it.
let held: LogicScopeValue | undefined;
const listeners = new Set<() => void>();
/** Says which template is open in a pushed page (undefined: none). */
export function setHeldLogicScope(next: LogicScopeValue | undefined): void {
  if (held?.entryId === next?.entryId) return;
  held = next;
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The template being edited, or undefined outside a template's editor. */
export function useLogicScope(): LogicScopeValue | undefined {
  const own = useContext(Scope);
  const pushed = useSyncExternalStore(subscribe, () => held, () => undefined);
  return own ?? pushed;
}
