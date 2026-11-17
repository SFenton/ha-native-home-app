import { useEffect, useState } from 'react';
import { useAppearance, readAppearance, type Appearance } from './appearance';
import { deriveTheme, haVariables, observeParentTheme, parseColor, readParentVariables, type DerivedTheme, type HaVariables } from './theme';

/** Resolves any CSS colour (names, `color-mix`, `hsl` with spaces) to text `parseColor` understands, using the browser. */
function resolveColor(value: string): string {
  if (parseColor(value) || typeof document === 'undefined') return value;
  const probe = document.createElement('span');
  probe.style.color = value;
  if (!probe.style.color) return value;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}
const colorVariables = new Set(['--primary-background-color', '--card-background-color', '--primary-text-color', '--secondary-text-color', '--divider-color', '--primary-color', '--text-primary-color', '--error-color', '--warning-color', '--success-color']);

/** What the chrome currently reads: the parent frame's Home Assistant variables (or none) and the system scheme. */
function readTheme(appearance: Appearance = readAppearance()): DerivedTheme {
  // Light and Dark skip the parent's variables and use the Studio's own palette.
  if (appearance !== 'follow') return deriveTheme({}, appearance === 'dark');
  const read: HaVariables = readParentVariables() ?? {};
  for (const name of haVariables) { const value = read[name]; if (value && colorVariables.has(name)) read[name] = resolveColor(value); }
  const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
  return deriveTheme(read, dark);
}

/**
 * Applies the chrome theme to the document root while `active`, follows the parent's theme changes and the system
 * scheme (unless Studio Appearance is Light or Dark), and removes everything on cleanup.
 */
export function useStudioTheme(active: boolean): DerivedTheme {
  const appearance = useAppearance();
  const [theme, setTheme] = useState<DerivedTheme>(() => readTheme(appearance));
  useEffect(() => {
    if (!active) return;
    const refresh = () => setTheme(readTheme(appearance));
    refresh();
    const stop = observeParentTheme(refresh);
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
    media?.addEventListener('change', refresh);
    return () => { stop(); media?.removeEventListener('change', refresh); };
  }, [active, appearance]);
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement, names = Object.keys(theme.variables);
    for (const name of names) root.style.setProperty(name, theme.variables[name]);
    root.style.setProperty('--studio-selection', theme.selection);
    const previousScheme = root.style.colorScheme;
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const created = !meta;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
    const previousColor = meta.content;
    meta.content = theme.cardColor;
    return () => {
      for (const name of names) root.style.removeProperty(name);
      root.style.removeProperty('--studio-selection'); root.style.colorScheme = previousScheme;
      if (created) meta.remove(); else meta.content = previousColor;
    };
  }, [active, theme]);
  return theme;
}
