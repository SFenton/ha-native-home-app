import { Check, Clock, Hash, List, Type } from 'lucide-react';
import type { OutputKind } from './model';

export default function OutputGlyph({ kind }: { kind: OutputKind }) {
  const Icon = { boolean: Check, number: Hash, words: Type, list: List, time: Clock }[kind];
  return <span className="w2-flow-glyph" data-kind={kind}><Icon size={16} aria-hidden/></span>;
}
