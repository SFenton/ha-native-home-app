/**
 * Authoring warnings for the generic grammar. They never block a save or a publish: the owner chose full control, and
 * the Studio only points out calls that are easy to regret.
 */
import { overflowNotices } from './surface-controls-fit';

export interface CompositionWarning { pointer: string; message: string }

/** Domains whose actions should ask first. */
export const confirmedDomains = ['lock', 'alarm_control_panel', 'cover'] as const;
const secretName = /(token|secret|password|passwd|api[_-]?key|webhook)/i;

/** Warnings for one `call-service` action (an object with `type: 'call-service'`). */
export function callServiceWarnings(call: unknown, pointer = ''): CompositionWarning[] {
  if (!call || typeof call !== 'object') return [];
  const value = call as { domain?: unknown; service?: unknown; confirmation?: { type?: unknown }; data?: { fields?: Record<string, unknown> } };
  const warnings: CompositionWarning[] = [];
  if (typeof value.domain === 'string' && (confirmedDomains as readonly string[]).includes(value.domain) && value.confirmation?.type !== 'additional')
    warnings.push({ pointer, message: `A ${value.domain}.${String(value.service)} call has no confirmation. Add one so a stray tap cannot change a lock, alarm or cover.` });
  for (const name of Object.keys(value.data?.fields ?? {})) {
    if (secretName.test(name)) warnings.push({ pointer: `${pointer}/data/fields/${name}`, message: `Data field "${name}" looks like a secret. The publication is readable by every signed-in user.` });
  }
  return warnings;
}

/** Every warning in a document, with the pointer of the offending action. */
export function compositionWarnings(document: unknown): CompositionWarning[] {
  const warnings: CompositionWarning[] = [];
  const walk = (value: unknown, pointer: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${pointer}/${index}`)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'call-service') warnings.push(...callServiceWarnings(record, pointer));
    // A map whose buttons do not all fit a family: a note, never a refusal (the app puts the rest behind More).
    if (record.kind === 'map' && Array.isArray(record.controls) && typeof record.height === 'number' && typeof record.locate === 'boolean')
      for (const message of overflowNotices(record as unknown as Parameters<typeof overflowNotices>[0])) warnings.push({ pointer: `${pointer}/controls`, message });
    for (const [key, child] of Object.entries(record)) walk(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  walk(document, '/document');
  return warnings;
}
