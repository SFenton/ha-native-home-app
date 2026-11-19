import { Braces, Check, Clock, Hash, List, Tag, Type, CircleHelp, type LucideIcon } from 'lucide-react';

const icons: Readonly<Record<string, LucideIcon>> = { number: Hash, text: Type, condition: Check, time: Clock, entity: Tag, list: List, record: Braces };
export default function PortGlyph({ kind }: { kind: string }) {
  const Icon = icons[kind] ?? CircleHelp;
  return <span className="w2-canvas-port-glyph" data-port-kind={kind} aria-hidden><Icon size={10}/></span>;
}
