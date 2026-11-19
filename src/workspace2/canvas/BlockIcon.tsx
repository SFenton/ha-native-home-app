import {
  ArrowDown, ArrowDownWideNarrow, ArrowLeftRight, ArrowRightFromLine, ArrowUp, ArrowUpDown, BetweenHorizontalStart,
  Blocks, Braces, Check, CircleCheck, CircleDashed, CircleDot, CircleSlash, Clock, Contact, CornerDownRight,
  Database, Divide, Download, Equal, EqualNot, Gauge, GitBranch, Hash, House, Layers, Link, ListChecks, ListFilter,
  ListOrdered, ListPlus, ListStart, Map, Maximize, Minus, MousePointerClick, PanelsTopLeft, Percent, Plus,
  Repeat2, Scaling, Settings2, Shapes, Sigma, SlidersHorizontal, Tag, Timer, ToggleLeft, Type, UnfoldVertical,
  UserCheck, UserRound, Waypoints, Workflow, X, type LucideIcon,
} from 'lucide-react';
import { blockCatalog } from '../../shared/composition/graph';

const icons: Record<string, LucideIcon> = {
  'sourceId': House, 'operand.read': ListChecks, 'operand.raw-state': CircleDot, 'operand.last-changed': Clock,
  'operand.list-count': ListOrdered, 'operand.list-includes': ListChecks, 'operand.viewer': UserRound,
  'operand.control': SlidersHorizontal, 'operand.item': Blocks, 'operand.index': ListOrdered, 'operand.param': Settings2,
  'operand.clock': Clock, 'operand.date': Timer, 'operand.format': Type, 'operand.map': Map, 'operand.choose': GitBranch,
  'operand.list': ListPlus, 'operand.object': Braces, 'operand.count': ListChecks,
  'predicate.state': CircleCheck, 'predicate.numeric': Gauge, 'predicate.viewer': UserCheck, 'predicate.viewer-person': Contact,
  'predicate.in': ListFilter, 'predicate.exists': CircleDashed, 'predicate.all': Workflow, 'predicate.any': Waypoints, 'predicate.not': CircleSlash,
  'template.logic-ref': Link, 'template.hole': Settings2, 'renderer.repeat': Repeat2, 'request.ha-subscription': Database,
  'literal.number': Hash, 'literal.text': Type, 'literal.boolean': ToggleLeft, 'literal.entity-id': Tag, 'literal.structured': Braces, 'literal.null': CircleSlash,
  'math.add': Plus, 'math.subtract': Minus, 'math.multiply': X, 'math.divide': Divide, 'math.modulo': Percent, 'math.abs': ArrowLeftRight,
  'math.min': ArrowDown, 'math.max': ArrowUp, 'math.round': Hash, 'math.truncate': Hash, 'math.clamp': BetweenHorizontalStart, 'math.scale': Scaling,
  'compare.eq': Equal, 'compare.ne': EqualNot, 'compare.above': ArrowUpDown, 'compare.below': ArrowDown,
  'compare.before': Clock, 'compare.after': Timer,
  'step.get': CornerDownRight, 'step.select-key': Tag, 'step.filter': ListFilter, 'step.sort': ArrowDownWideNarrow,
  'step.limit': ListStart, 'step.map': Braces, 'step.group': Layers, 'step.count': ListOrdered, 'step.sum': Sigma,
  'step.first': ListStart, 'step.flatten': UnfoldVertical, 'step.unique': Blocks, 'step.default': ArrowLeftRight,
  'step.min': ArrowDown, 'step.max': ArrowUp, 'step.average': Divide, 'step.running-sum': Sigma, 'step.annotate': BetweenHorizontalStart,
  'request.entities': Layers, 'request.none': Braces, 'request.entity-attribute': Database, 'request.service-response': Download,
  'destination.text': Type, 'destination.look-rules': Shapes, 'destination.bound-symbol': Shapes, 'destination.action-rules': MousePointerClick, 'destination.field': ArrowRightFromLine,
  'frame.for-each': Repeat2, 'frame.bundle-outputs': PanelsTopLeft, 'frame.group': Maximize,
  'recipe.average-fixed': Divide, 'recipe.average-two-flow': Sigma, 'recipe.any-count': Waypoints, 'recipe.all-count': Workflow,
};
export default function BlockIcon({ catalogKey, size = 18 }: { catalogKey: string; size?: number }) {
  const entry = blockCatalog.find(entry => entry.key === catalogKey);
  const variant = entry?.grammar === 'operand.literal' ? `literal.${entry.variant}` : entry?.grammar === 'operand.math' ? `math.${entry.variant}`
    : entry?.grammar === 'predicate.compare' ? `compare.${entry.variant}` : catalogKey;
  const Icon = icons[variant] ?? icons[entry?.grammar ?? ''] ?? (entry?.grammar === 'output' ? ArrowRightFromLine : Check);
  return <Icon size={size} aria-hidden data-block-icon={variant}/>;
}
