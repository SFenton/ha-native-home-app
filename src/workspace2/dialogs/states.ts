import { createId as uid } from '../../shared/ids';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { LocalField } from '../../shared/composition/shell';

/** The words for a state's kind (spec 5.7: Choice, On-off, Number, Text). */
export const kindWords: Record<LocalField['type'], string> = { choice: 'Choice', boolean: 'On-off', number: 'Number', string: 'Text' };
export const kindOrder: readonly LocalField['type'][] = ['choice', 'boolean', 'number', 'string'];

/** A new state of `type`, named so that it clashes with nothing. */
export function newLocalState(document: CompositionDocument, type: LocalField['type'] = 'boolean'): LocalField {
  const taken = new Set((document.localState ?? []).map(field => field.id));
  let id = uid('state');
  while (taken.has(id)) id = uid('state');
  return startingState(id, type);
}

/** `id` as a state of `type`, at its starting values. */
export function startingState(id: string, type: LocalField['type'], keep?: LocalField): LocalField {
  switch (type) {
    case 'boolean': return { id, type, initial: false };
    case 'number': return { id, type, initial: 0, minimum: 0, maximum: 100, step: 1 };
    case 'string': return { id, type, initial: '', maxLength: 200 };
    case 'choice': return keep?.type === 'choice' ? keep : { id, type, initial: 'first', options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] };
  }
}

/** The document with state `from` renamed `to`, and everything that names it following. */
export function renameLocalState(document: CompositionDocument, from: string, to: string): CompositionDocument {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'stateId' && child === from ? to : walk(child)]));
    return value;
  };
  const next = walk(document) as CompositionDocument;
  return { ...next, localState: (document.localState ?? []).map(field => field.id === from ? { ...field, id: to } : field) };
}

/** The start of a state in words: "On", "Off", the option's label, the number or the text. */
export function startingValue(field: LocalField): string {
  if (field.type === 'boolean') return field.initial ? 'On' : 'Off';
  if (field.type === 'choice') return field.options.find(option => option.id === field.initial)?.label ?? field.initial;
  return String(field.initial);
}
