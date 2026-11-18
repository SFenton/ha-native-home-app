import type { LogicEntry } from '../../../shared/composition/logic-library';
import { isHole, isUse, settingKindOf, type LogicParam } from './logicModel';
import { logicWords } from './logicWords';

/** What naming a use or a setting needs: the library, and the settings of the template being edited (a body names its settings by label). */
export interface LogicNames { library: readonly LogicEntry[]; settings?: readonly LogicParam[] }

/** "10:00 PM" for 600 and 22:00 for 1320. */
export const minutesWords = (minutes: number): string => { const hour = Math.floor(minutes / 60) % 24, minute = Math.round(minutes % 60); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; };
/** The minutes of a "HH:MM" time input, or undefined. */
export const parseMinutes = (text: string): number | undefined => { const match = /^(\d{1,2}):(\d{2})$/.exec(text); return match ? Number(match[1]) * 60 + Number(match[2]) : undefined; };
/** The "HH:MM" of a number of minutes, for a time input. */
export const minutesInput = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

const labelOf = (names: LogicNames | undefined, name: string): string => {
  const param = names?.settings?.find(item => item.name === name);
  return param ? (param.label ?? param.name) : name;
};

/** The name of a use, a hole, or the operand a setting stands in, or undefined when the operand is none of those. */
export function logicOperandName(operand: unknown, names: LogicNames | undefined): string | undefined {
  if (!operand || typeof operand !== 'object') return undefined;
  const value = operand as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (isUse(value)) return names?.library.find(entry => entry.id === value.logicId)?.name ?? logicWords.missing;
  if (isHole(value)) return labelOf(names, value.name);
  if (value.type === 'literal' && isHole(value.value)) return labelOf(names, value.value.name);
  if (value.type === 'read' && isHole(value.from?.sourceId)) {
    const label = labelOf(names, value.from.sourceId.name), path = value.from.path as string[];
    return path[0] === 'attributes' && path[1] ? `${label} · ${path[1]}` : label;
  }
  return undefined;
}

/** A use's settings in a line: "Night Hours 10:00 PM, 7:00 AM". `say` names an operand argument. */
export function useSentence(use: { logicId: string; args: Record<string, unknown> }, names: LogicNames | undefined, say: (value: unknown) => string, entityName: (sourceId: string) => string): string {
  const entry = names?.library.find(item => item.id === use.logicId);
  if (!entry) return logicWords.missing;
  const parts = entry.params.map(param => {
    const arg = use.args[param.name];
    switch (settingKindOf(param)) {
      case 'entity': return typeof arg === 'string' ? entityName(arg) : '';
      case 'time': return typeof arg === 'number' ? minutesWords(arg) : '';
      case 'person': case 'text': case 'number': return arg === undefined ? '' : String(arg);
      case 'value': return say(arg);
      case 'condition': return '';
    }
  }).filter(Boolean);
  return parts.length ? `${entry.name} ${parts.join(', ')}` : entry.name;
}
