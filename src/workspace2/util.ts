import type { CompositionNode } from '../shared/composition/schema';
import { createId as uid } from '../shared/ids';
import { copySubtree } from './editors/provenance';

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
  const copy = copySubtree(node) as CompositionNode & Record<string, unknown>;
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
  'weather-panel': 'Weather', stack: 'Stack', repeat: 'Repeat', shape: 'Shape', symbol: 'Symbol', chart: 'Chart', 'linear-gauge': 'Gauge', 'room-card': 'Room card', 'settings-link': 'Settings link', 'account-header': 'Account header', 'local-tabs': 'Tabs', overlay: 'Overlay',
  dial: 'Dial', 'arc-track': 'Arc', 'dial-control': 'Dial Control',
};
const plainType = (type: string) => type.replace(/-/g, ' ').replace(/^\w/, letter => letter.toUpperCase());

/**
 * The plain names of a node type's primitives: `vacuum-control` is one node type with fourteen kinds, so the tree names a node by
 * the primitive it is. The kinds stay separate building blocks; only the words differ. `climate-control` is named the same way.
 */
export const primitiveNames: Record<string, Record<string, string>> = {
  'vacuum-control': {
    card: 'Vacuum tile', map: 'Map', status: 'Readout', notices: 'Vacuum notices', 'auto-clean': 'Auto-clean switch', settings: 'Cleaning settings',
    command: 'Command', choice: 'Choice', consumable: 'Consumable', report: 'Cleaning report', outcomes: 'Cleaning outcomes', target: 'Cleaning target',
    'clear-area': 'Clear area', 'area-editor': 'Area editor',
  },
  'climate-control': {
    dial: 'Dial Control', toggle: 'Climate switch', 'explicit-switch': 'Climate switch', check: 'Climate check', mode: 'Mode picker', fan: 'Fan picker', preset: 'Preset picker',
    options: 'Climate options', hub: 'Climate hub', notice: 'Climate notice', status: 'Climate status', link: 'Climate link', 'room-tile': 'Room climate tile',
  },
};
/** What names a node: its `type`, with the `props.kind` or `props.primitive.kind` that picks one of its primitives. */
export interface NodeLike { type: string; props?: unknown }
const kindOf = (node: NodeLike): string | undefined => {
  const props = node.props as { kind?: unknown; primitive?: { kind?: unknown } } | undefined;
  const kind = node.type === 'vacuum-control' ? props?.primitive?.kind : props?.kind;
  return typeof kind === 'string' ? kind : undefined;
};
/**
 * The name the Studio shows for a node type, or, given the node, for the primitive it is ("Vacuum tile", not "Vacuum control").
 * The single source of display names: the tree, the inspector, the breadcrumb and the untitled-node words all come through here.
 */
export function typeName(type: string | NodeLike): string {
  if (typeof type === 'string') return typeNames[type] ?? plainType(type);
  const kind = kindOf(type);
  return (kind && primitiveNames[type.type]?.[kind]) ?? typeNames[type.type] ?? plainType(type.type);
}

/**
 * `text` cut in the middle to at most `room` characters, the cut drawn as one ellipsis ("tile-gu…-7f3a"). A middle cut keeps the
 * start and the end of an identifier, which is where two of them differ. `text` as given when it fits.
 */
export function middleEllipsis(text: string, room: number): string {
  if (!Number.isFinite(room) || text.length <= room) return text;
  const keep = Math.max(2, Math.floor(room) - 1), head = Math.ceil(keep / 2), tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
