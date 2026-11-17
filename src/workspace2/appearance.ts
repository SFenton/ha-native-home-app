import { useSyncExternalStore } from 'react';
import { readParentVariables } from './theme';

/** How the Studio's own chrome is lit: follow Home Assistant (or the system), or always light or dark. Light and Dark also light the preview's `system` sheets; pages and `dark` sheets keep their look. */
export type Appearance = 'follow' | 'light' | 'dark';
/** The browser storage key of the choice. */
export const APPEARANCE_KEY = 'sh-studio.appearance';
export const appearanceChoices: readonly Appearance[] = ['follow', 'light', 'dark'];

/** A stored value, or `follow` for anything else (nothing stored, a removed choice, a damaged value). */
export function parseAppearance(stored: unknown): Appearance {
  return stored === 'light' || stored === 'dark' ? stored : 'follow';
}
/** Reads the choice from the browser; it is read before the first paint, so the chrome never flashes the other look. */
export function readAppearance(): Appearance {
  try { return parseAppearance(localStorage.getItem(APPEARANCE_KEY)); } catch { return 'follow'; }
}

let current: Appearance = typeof localStorage === 'undefined' ? 'follow' : readAppearance();
const listeners = new Set<() => void>();
/** Remembers the choice in this browser and tells the chrome. */
export function setAppearance(next: Appearance): void {
  current = next;
  try { localStorage.setItem(APPEARANCE_KEY, next); } catch { /* storage blocked: the choice lasts for this page */ }
  listeners.forEach(listener => listener());
}
/** Reads storage again (a test clears it between cases). */
export function reloadAppearance(): void { current = readAppearance(); listeners.forEach(listener => listener()); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === APPEARANCE_KEY) reloadAppearance(); });

/** The choice, re-reading when it changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => 'follow');
}

/** Whether the Studio runs inside Home Assistant and can read its theme. */
export const insideHomeAssistant = (frame: Window = window): boolean => readParentVariables(frame) !== undefined;

/** The words of a choice: "Follow" reads "Follow Home Assistant" inside it and "Follow System" outside. */
export function appearanceWords(choice: Appearance, inHomeAssistant = insideHomeAssistant()): string {
  return choice === 'light' ? 'Light' : choice === 'dark' ? 'Dark' : inHomeAssistant ? 'Follow Home Assistant' : 'Follow System';
}
