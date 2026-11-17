import type { CompositionAction, CompositionDocument, CallService, Operand } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { fieldVariants, resolveField, variantName, type SchemaField } from '../../composition-editor';
import { sourceEntity } from '../add/sources';

/** The chips of the action editor, in the spec's order. */
export const actionKindOrder = ['call-service', 'push', 'present', 'select-tab', 'back', 'dismiss', 'set-local', 'domain'] as const;
export type ActionKind = typeof actionKindOrder[number] | 'dismiss-then-push' | 'none';

/** The words on a kind's chip. */
export const kindWords: Record<ActionKind, string> = {
  'call-service': 'Call a Service', push: 'Open Page', present: 'Open Sheet', 'select-tab': 'Switch Tab', back: 'Back', dismiss: 'Close Sheet', 'set-local': 'Set Local State',
  domain: 'Turn On or Off', 'dismiss-then-push': 'Close Sheet, Open Page', none: 'Nothing',
};

/** The kinds the schema at a field accepts, as chips, and whether "Nothing" is one of them (an optional field). */
/** Whether an action slot also takes an action chosen by rule (`sh.action-rules@1`). */
export const acceptsRules = (schema: SchemaField) => fieldVariants(schema).some(variant => variantName(resolveField(variant)) === 'conditional');
export function acceptedKinds(schema: SchemaField, optional: boolean): ActionKind[] {
  const names = new Set(fieldVariants(schema).map(variant => variantName(resolveField(variant))));
  names.delete('conditional');
  // Toggle Power belongs to the power tile alone: wherever the schema offers other actions too, the compiler refuses it.
  const kinds: ActionKind[] = actionKindOrder.filter(kind => names.has(kind) && (kind !== 'domain' || names.size === 1));
  if (names.has('dismiss-then-push')) kinds.push('dismiss-then-push');
  if (optional) kinds.push('none');
  return kinds;
}

/** The kind an action value is. */
export const kindOf = (action: Json | undefined): ActionKind => action && typeof action === 'object' && !Array.isArray(action) ? String((action as { type?: string }).type) as ActionKind : 'none';

/** A fresh action of a kind, pointing at something that exists so it is valid at once. */
export function defaultAction(kind: ActionKind, document: CompositionDocument, boundSourceId?: string): CompositionAction | undefined {
  switch (kind) {
    case 'call-service': return { type: 'call-service', domain: 'light', service: 'turn_on' };
    case 'push': return { type: 'push', pageId: document.pages[1]?.id ?? document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' };
    case 'present': return { type: 'present', modalId: document.modals[0]?.id ?? '', arguments: {}, ifPresented: 'reject' };
    case 'select-tab': return { type: 'select-tab', tabId: document.navigation.tabs[0]?.id ?? '' };
    case 'back': return { type: 'back' };
    case 'dismiss': return { type: 'dismiss', scope: 'current-modal' };
    case 'set-local': {
      const field = document.localState?.[0];
      const value: { type: 'string'; value: string } | { type: 'boolean'; value: boolean } | { type: 'number'; value: number } = !field ? { type: 'string', value: '' }
        : field.type === 'boolean' ? { type: 'boolean', value: field.initial } : field.type === 'number' ? { type: 'number', value: field.initial } : { type: 'string', value: field.initial };
      return { type: 'set-local', stateId: field?.id ?? '', value };
    }
    case 'domain': return { type: 'domain', sourceId: boundSourceId ?? '', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } };
    case 'dismiss-then-push': return { type: 'dismiss-then-push', destination: { type: 'push', pageId: document.pages[1]?.id ?? document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } };
    case 'none': return undefined;
  }
}

// MARK: Service calls

/** The entities a call targets when its target is a literal (one id or a list). */
export function targetEntities(call: CallService): string[] | undefined {
  const operand = call.target?.entity_id;
  if (!operand) return [];
  if (operand.type !== 'literal') return undefined;
  return Array.isArray(operand.value) ? operand.value.filter((item): item is string => typeof item === 'string') : typeof operand.value === 'string' && operand.value ? [operand.value] : [];
}
/** A call with its target entities set (one stays a plain id, several a list, none removes the target). */
export function withTargetEntities(call: CallService, ids: string[]): CallService {
  const { target, ...rest } = call;
  const { entity_id: _removed, ...others } = target ?? {};
  const entity_id: Operand | undefined = ids.length === 0 ? undefined : { type: 'literal', value: ids.length === 1 ? ids[0] : ids };
  const next = { ...others, ...(entity_id ? { entity_id } : {}) };
  return Object.keys(next).length ? { ...rest, target: next } : rest;
}
/** A call at another service; its data fields that the new service does not list are kept (the person added them). */
export const withService = (call: CallService, domain: string, service: string): CallService => ({ ...call, domain, service });

/** The data fields of a call, by key. */
export const dataOf = (call: CallService): Record<string, Operand> => call.data?.fields ?? {};
/** A call with one data field set (undefined removes it; the last removal removes `data`). */
export function withDataField(call: CallService, key: string, operand: Operand | undefined): CallService {
  const fields = { ...dataOf(call) };
  if (operand) fields[key] = operand; else delete fields[key];
  const { data: _data, ...rest } = call;
  return Object.keys(fields).length ? { ...rest, data: { type: 'object', fields } } : rest;
}

/** Where a value comes from, as the value source menu names it. */
export type ValueSource = 'fixed' | 'entity' | 'control' | 'viewer' | 'formula';
export const sourceWords: Record<ValueSource, string> = { fixed: 'Fixed value', entity: 'From an entity…', control: 'From this control', viewer: 'From the person using the app', formula: 'Formula…' };
/** The source an operand is. */
export const sourceOf = (operand: Operand): ValueSource => operand.type === 'literal' ? 'fixed' : operand.type === 'read' ? 'entity' : operand.type === 'control' ? 'control' : operand.type === 'viewer' ? 'viewer' : 'formula';
/** A fresh operand for a source. `sourceId` is the entity source for "From an entity…". */
export function operandFor(source: ValueSource, current: Operand | undefined, sourceId = ''): Operand {
  switch (source) {
    case 'fixed': return current?.type === 'literal' ? current : { type: 'literal', value: '' };
    case 'entity': return { type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'string', missing: 'unavailable' };
    case 'control': return { type: 'control' };
    case 'viewer': return { type: 'viewer', field: 'userId' };
    case 'formula': return current && !['literal', 'read', 'control', 'viewer'].includes(current.type) ? current : { type: 'format', pattern: '{value}', args: { value: current ?? { type: 'literal', value: '' } } };
  }
}
/** How many levels of operands an operand tree has. */
export function operandDepth(operand: Operand): number {
  switch (operand.type) {
    case 'format': return 1 + Math.max(0, ...Object.values(operand.args).map(operandDepth));
    case 'map': return 1 + Math.max(operandDepth(operand.of), operandDepth(operand.otherwise), ...operand.cases.map(entry => operandDepth(entry.then)));
    case 'math': return 1 + Math.max(0, ...operand.args.map(operandDepth));
    case 'object': return 1 + Math.max(0, ...Object.values(operand.fields).map(operandDepth));
    case 'list': return 1 + Math.max(0, ...operand.items.map(operandDepth));
    default: return 1;
  }
}
/** The "When tapped" row's one-line summary for a service call: the service name and the first target. */
export const callSummary = (call: CallService) => `${call.domain}.${call.service}${(targetEntities(call) ?? [])[0] ? ` · ${(targetEntities(call) ?? [])[0]}` : ''}`;

/** The entity an on-or-off action switches: the one its data source reads. */
export const domainEntity = (document: CompositionDocument, sourceId: string): string | undefined => sourceEntity(document.dataSources.find(source => source.id === sourceId));
/** The "When tapped" summary of an on-or-off action: "Turn On or Off" and the entity's friendly name (its id when Home Assistant gives none). */
export function domainSummary(document: CompositionDocument, sourceId: string, names?: ReadonlyMap<string, string>): string {
  const entity = domainEntity(document, sourceId);
  return entity ? `${kindWords.domain} · ${names?.get(entity) ?? entity}` : kindWords.domain;
}
/** What Ask first starts with for a tile: a title naming the tile and the button that does it, so the alert reads as the question it asks. */
export const askFirstDefaults = (itemName: string) => ({ title: itemName ? `Turn Off ${itemName}?` : 'Turn Off?', confirmLabel: 'Turn Off' });

// MARK: Ask first

/** The alert a tap asks first with: the `additional` confirmation of a service call or an on-or-off action. */
export interface AskFirst { type: 'additional'; style: 'alert' | 'dialog'; title: string; message?: string; confirmLabel: string; cancelLabel: 'Cancel'; destructive: boolean }

/** The alert an action asks first with, when it does. */
export function askOf(action: Json | CompositionAction | undefined): AskFirst | undefined {
  const confirmation = action && typeof action === 'object' && !Array.isArray(action) ? (action as { confirmation?: { type?: string } }).confirmation : undefined;
  return confirmation?.type === 'additional' ? confirmation as unknown as AskFirst : undefined;
}
/** The "Ask first" row's summary: "Off", or the alert's title. */
export const askSummary = (action: Json | CompositionAction | undefined): string => { const ask = askOf(action); return ask ? ask.title || 'On' : 'Off'; };
/** What is missing from an alert, in words, or undefined when it can be saved. */
export function askProblem(action: Json | CompositionAction | undefined): string | undefined {
  const byRule = action && typeof action === 'object' && !Array.isArray(action) && (action as { type?: string }).type === 'conditional' ? (action as unknown as { cases: { when?: unknown }[] }) : undefined;
  if (byRule) return byRule.cases.some(entry => !entry.when) ? 'Every rule needs a condition.' : undefined;
  const ask = askOf(action);
  if (!ask) return undefined;
  if (!ask.title.trim()) return 'Add a title.';
  if (!ask.confirmLabel.trim()) return 'Add a button label.';
  return undefined;
}
/**
 * An action with its alert turned on, off, or changed. Turning it on fills the defaults for the tile; turning it off removes the
 * confirmation (an on-or-off action keeps the `policy` the contract requires).
 */
export function withAsk<T extends Record<string, unknown> & { type: string }>(action: T, change: Partial<AskFirst> | 'off' | 'on', itemName = ''): T {
  const { confirmation: _was, ...rest } = action as Record<string, unknown>;
  if (change === 'off') return (action.type === 'domain' ? { ...rest, confirmation: { type: 'policy' } } : rest) as unknown as T;
  const current = askOf(action as unknown as Json) ?? { type: 'additional', style: 'alert', ...askFirstDefaults(itemName), cancelLabel: 'Cancel', destructive: false };
  const next: Record<string, unknown> = { ...current, ...(change === 'on' ? {} : change), cancelLabel: 'Cancel' };
  if (!next.message) delete next.message;
  return { ...rest, confirmation: next } as unknown as T;
}
