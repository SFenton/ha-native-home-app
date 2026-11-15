import type { CompositionNode } from '../shared/composition/schema';
import { uid } from '../editor';

/** Copies text. The Clipboard API needs a secure context, which LAN HTTP is not, so fall back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/** A deep copy of a node with a fresh id on it and on every node beneath it. */
export function cloneNode(node: CompositionNode): CompositionNode {
  const copy = structuredClone(node) as CompositionNode & Record<string, unknown>;
  const fresh = (item: Record<string, unknown>) => {
    if (typeof item.id === 'string' && typeof item.type === 'string' && 'layout' in item) item.id = uid('native');
    for (const key of ['children']) if (Array.isArray(item[key])) (item[key] as Record<string, unknown>[]).forEach(fresh);
    if (Array.isArray(item.tabs)) (item.tabs as { children?: Record<string, unknown>[] }[]).forEach(tab => tab.children?.forEach(fresh));
  };
  fresh(copy);
  return copy;
}

/** The app's name for a node type (the glossary in the spec), else the type in words. */
export const typeNames: Record<string, string> = {
  'action-tile': 'Action tile', 'navigation-tile': 'Navigation tile', 'status-chip': 'Status chip', 'status-rail': 'Status rail', section: 'Section',
  'tile-grid': 'Tile grid', row: 'Row', 'primary-button': 'Button', text: 'Text', 'camera-tile': 'Camera tile', 'climate-control': 'Climate',
  'weather-panel': 'Weather', 'room-card': 'Room card', 'settings-link': 'Settings link', 'account-header': 'Account header', 'local-tabs': 'Local tabs',
};
export const typeName = (type: string) => typeNames[type] ?? type.replace(/-/g, ' ').replace(/^\w/, letter => letter.toUpperCase());
