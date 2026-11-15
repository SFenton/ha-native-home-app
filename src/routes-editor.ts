import type { CompositionDocument } from './shared/composition/schema';

type Extensions = NonNullable<CompositionDocument['extensions']>;
export type AuthoredRoute = Extensions['routes'][number];

/** Paths the retired app alias table opened (research note 07 section 5.4), keyed by the route path they now belong to. */
export const legacyAliases: Readonly<Record<string, readonly string[]>> = {
  home: ['overview'],
  climate: ['thermostat'],
  settings: ['admin', 'vacation', 'vacation-mode', 'car', 'solo-trip', 'to-do', 'guests-staying-over', 'special-device-modes'],
};

/** The first path segments the app read before they became authored (migration default). */
export const legacyLinkPrefixes: readonly string[] = ['sfenton-react-dash', 'ha-sfenton-react-dash', 'at-a-glance'];

/** Every path and alias a document's routes already use, so a new alias never repeats one. */
export function usedPaths(routes: readonly AuthoredRoute[]): Set<string> {
  return new Set(routes.flatMap(route => [route.path, ...(route.aliases ?? [])]));
}

export interface LegacyImport { extensions: Extensions; added: string[]; skipped: string[]; }

/**
 * Adds the legacy aliases to the routes whose path matches, and the legacy link prefixes when none are authored.
 * An alias that another route already uses is skipped and reported, never duplicated; the result is idempotent.
 */
export function importLegacyAliases(extensions: Extensions): LegacyImport {
  const used = usedPaths(extensions.routes);
  const added: string[] = [], skipped: string[] = [];
  const routes = extensions.routes.map(route => {
    const wanted = legacyAliases[route.path];
    if (!wanted) return route;
    const aliases = [...(route.aliases ?? [])];
    for (const alias of wanted) {
      if (aliases.includes(alias)) continue;
      if (used.has(alias) || aliases.length >= 8) { skipped.push(alias); continue; }
      aliases.push(alias); used.add(alias); added.push(alias);
    }
    return aliases.length ? { ...route, aliases } : route;
  });
  const linkPrefixes = extensions.linkPrefixes ?? [...legacyLinkPrefixes];
  if (!extensions.linkPrefixes) added.push(...legacyLinkPrefixes.map(prefix => `link:${prefix}`));
  return { extensions: { ...extensions, routes, linkPrefixes }, added, skipped };
}

/** Splits a comma or line separated field into trimmed, non-empty, de-duplicated words. */
export function words(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map(word => word.trim()).filter(Boolean))];
}

/** Replaces one route, dropping optional fields that became empty so the document stays minimal. */
export function updateRoute(extensions: Extensions, index: number, change: Partial<AuthoredRoute>): Extensions {
  const routes = extensions.routes.map((route, offset) => {
    if (offset !== index) return route;
    const next: Record<string, unknown> = { ...route, ...change };
    for (const key of ['aliases', 'keywords'] as const) {
      const value = next[key];
      if (Array.isArray(value) && value.length === 0) delete next[key];
    }
    if (next.siri === false) delete next.siri;
    return next as AuthoredRoute;
  });
  return { ...extensions, routes };
}
