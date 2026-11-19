import { Braces, Check, Clock, Hash, Layers, Tag, Type, CircleHelp, type LucideIcon } from 'lucide-react';
import type { PortType } from '../../shared/composition/graph';

const icons: Readonly<Record<string, LucideIcon>> = { number: Hash, text: Type, condition: Check, time: Clock, entity: Tag, list: Layers, record: Braces };
function shapeKind(shape: PortType['shape']): string {
  switch (shape.kind) {
    case 'number': return 'number';
    case 'boolean': return 'condition';
    case 'string': return shape.format === 'entity-id' ? 'entity' : shape.format === 'date' || shape.format === 'date-time' ? 'time' : 'text';
    case 'object': return 'record';
    case 'array': return 'list';
    case 'union': {
      const kinds = new Set(shape.of.filter(member => member.kind !== 'null').map(shapeKind));
      return kinds.size === 1 ? [...kinds][0] : 'unknown';
    }
    default: return 'unknown';
  }
}
export function listItemKind(shape: PortType['shape']): string {
  if (shape.kind === 'array') return shapeKind(shape.of);
  if (shape.kind === 'union') {
    const kinds = new Set(shape.of.filter(member => member.kind !== 'null').map(listItemKind));
    if (kinds.size === 1) return [...kinds][0];
  }
  return 'unknown';
}
export default function PortGlyph({ kind, itemKind }: { kind: string; itemKind?: string }) {
  const item = kind === 'list' ? itemKind ?? 'unknown' : undefined, Icon = icons[item ?? kind] ?? CircleHelp;
  return <span className="w2-canvas-port-glyph" data-port-kind={kind} data-item-kind={item} aria-hidden><Icon size={10}/></span>;
}
