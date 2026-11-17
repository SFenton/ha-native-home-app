import { useSyncExternalStore } from 'react';

/**
 * Saved Colors are the Studio's own: kept in the browser's `localStorage` for every project, never in a document. Choosing one
 * copies its RGB into a field; changing or removing a saved color never changes a tile that used it. (The key keeps the
 * spec's spelling: it names stored data, not copy.)
 */
export const SAVED_COLORS_KEY = 'sh-studio.saved-colours';
/** Most colors kept. */
export const SAVED_COLORS_LIMIT = 24;

/** A solid fill as the contract stores it. */
export interface SolidColor { type: 'solid-rgb'; red: number; green: number; blue: number }

/** An exact color for each appearance as the contract stores it (`sh.solid-appearance@1`): `light` in Light Mode, `dark` in Dark Mode. */
export interface SolidPair { type: 'solid-appearance'; light: SolidColor; dark: SolidColor }

/** The twelve presets, in the grid's reading order. */
export const presetColors = [
  { name: 'Red', hex: '#FF3B30' }, { name: 'Orange', hex: '#FF9500' }, { name: 'Amber', hex: '#FFC107' }, { name: 'Green', hex: '#34C759' },
  { name: 'Teal', hex: '#30B0C7' }, { name: 'Light Blue', hex: '#5AC8FA' }, { name: 'Indigo', hex: '#5856D6' }, { name: 'Purple', hex: '#AF52DE' },
  { name: 'Pink', hex: '#FF2D55' }, { name: 'Brown', hex: '#A2845E' }, { name: 'Gray', hex: '#8E8E93' }, { name: 'White', hex: '#FFFFFF' },
] as const;

const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
/** The `#RRGGBB` of a fill. */
export const hexOf = (fill: Pick<SolidColor, 'red' | 'green' | 'blue'>) => `#${channel(fill.red)}${channel(fill.green)}${channel(fill.blue)}`;
/** The fill of a `#RRGGBB` (any case). */
export const solidOf = (hex: string): SolidColor => ({ type: 'solid-rgb', red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16) });
/** A pair that starts as one color in both appearances. */
export const pairOf = (color: SolidColor): SolidPair => ({ type: 'solid-appearance', light: { ...color }, dark: { ...color } });
/** A hex color the Studio keeps: `#RRGGBB`, upper case. */
export const isHex = (text: unknown): text is string => typeof text === 'string' && /^#[0-9A-Fa-f]{6}$/.test(text);
/** What a color is called: the preset's name, else its hex value. */
export const colorName = (hex: string) => presetColors.find(preset => preset.hex === hex.toUpperCase())?.name ?? hex.toUpperCase();

const read = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_COLORS_KEY) ?? '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isHex).map(hex => hex.toUpperCase()))].slice(0, SAVED_COLORS_LIMIT) : [];
  } catch { return []; }
};
let snapshot = typeof localStorage === 'undefined' ? [] : read();
const listeners = new Set<() => void>();
const publish = (next: string[]) => {
  snapshot = next;
  try { localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: the list lasts for this page */ }
  listeners.forEach(listener => listener());
};
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === SAVED_COLORS_KEY) { snapshot = read(); listeners.forEach(listener => listener()); } });

/** Adds a color to the saved list (newest last). A full list refuses; a saved color is not added twice. Returns whether it was added. */
export function saveColor(hex: string): boolean {
  const next = hex.toUpperCase();
  if (!isHex(next) || snapshot.includes(next) || snapshot.length >= SAVED_COLORS_LIMIT) return false;
  publish([...snapshot, next]);
  return true;
}
/** Removes a color from the saved list. */
export function removeSavedColor(hex: string): void { publish(snapshot.filter(item => item !== hex.toUpperCase())); }
/** Forgets what was read, so the next read comes from storage (a test clears storage between cases). */
export function reloadSavedColors(): void { snapshot = read(); listeners.forEach(listener => listener()); }

/** The saved colors, re-reading when they change here or in another tab. */
export function useSavedColors(): readonly string[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => []);
}
