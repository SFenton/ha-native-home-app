import type { CompositionActionSlot, CompositionDocument } from '../shared/composition/schema';
import { asksFirst, resolveAction } from '../shared/composition/evaluator';
import { acceptsLocalValue } from '../shared/composition/shell';
import type { Json } from '../shared/types';
import { alertOf, type AlertSpec } from './alert';
import { evaluateOperand } from './evaluate';
import { isNavAction, type NavAction } from './navigation';
import { applyCall, applyLocal, createEnvironment, shownEntity, type House, type Overlay, type ResolvedCall, resolveCall } from './projections';

/** What an action does in the preview. Every field is optional: an action the preview does not simulate plans nothing. */
export interface ActionPlan {
  /** A navigation action for the reducer. */
  nav?: NavAction;
  /** The overlay after a simulated change, only when it differs from the one passed in. */
  overlay?: Overlay;
  /** The line for the Checks pill, such as `Kitchen light: turn on`. */
  simulated?: string;
  /** The resolved call behind `simulated`, handed to `deliverCall` (which only ever simulates it). */
  call?: ResolvedCall;
  /** The alert to show first, when the action asks first. Nothing else is planned until it is confirmed. */
  confirm?: AlertSpec;
}
/** What planning needs from the document and the house. */
export interface ActionInput {
  document: Pick<CompositionDocument, 'dataSources' | 'localState'>;
  house: House;
  overlay: Overlay;
  /** The new value of the control that sent the action. */
  control?: Json;
  /** The person already answered the alert: plan the action itself. */
  confirmed?: boolean;
  /** The cell of a repeat the action is in: `item` and `index` read it. */
  scope?: { item: Json; index: number };
}

/** `turn_on` as "turn on". */
const serviceWords = (service: string) => service.replace(/_/g, ' ');
const domainWords = (domain: string) => { const text = domain.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };

/**
 * The line for a simulated call, in words: the entity's friendly name and what happened to it ("Kitchen light: toggle").
 * Several entities read "Kitchen light and 2 more: turn off"; a call with no entity reads "Light: turn on".
 */
export function callSummary(call: ResolvedCall, house: House, overlay: Overlay): string {
  const names = call.entityIds.map(id => shownEntity(house, overlay, id)?.name || domainWords(id.split('.').slice(1).join(' ').replace(/_/g, ' ') || id));
  const who = names.length === 0 ? domainWords(call.domain) : names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
  return `${who}: ${serviceWords(call.service)}`;
}
const summary = (call: ResolvedCall, input: ActionInput) => callSummary(call, input.house, input.overlay);

/**
 * Plans what a Use-mode action does. A `call-service` resolves its operands through `resolveCall` and lays the result over
 * the house with `applyCall`; a power `domain` action toggles its source's entity the same way; `set-local` writes the scene
 * value if the field accepts it. Nothing here calls a real service.
 */
export function planAction(slot: CompositionActionSlot, input: ActionInput): ActionPlan {
  const env = createEnvironment(input.document, input.house, input.overlay, input.control);
  if (input.scope) { env.item = input.scope.item; env.index = input.scope.index; }
  // An action chosen by rule runs the case that holds now; a rule that is stalled, or whose answer is `none`, runs nothing (`sh.action-rules@1`).
  const action = resolveAction(slot, env);
  if (!action) return {};
  if (isNavAction(action)) return { nav: action };
  // An action that asks first plans only the alert; a `policy` confirmation is the app's own decision and shows none. A `when` that does not hold
  // holds the question back; one that cannot be answered asks (`sh.confirm-when@1`).
  if (!input.confirmed && (action.type === 'call-service' || action.type === 'domain')) {
    const alert = alertOf(action.confirmation);
    if (alert && asksFirst(action.confirmation?.type === 'additional' ? action.confirmation.when : undefined, env)) return { confirm: alert };
  }
  switch (action.type) {
    case 'call-service': {
      const resolved = resolveCall(action, env);
      if (!resolved) return {};
      const next = applyCall(input.house, input.overlay, resolved);
      return { simulated: summary(resolved, input), call: resolved, overlay: next === input.overlay ? undefined : next };
    }
    case 'domain': {
      const source = input.document.dataSources.find(item => item.id === action.sourceId);
      const operand = source && 'inputs' in source && source.inputs && 'entityId' in source.inputs ? source.inputs.entityId : undefined;
      const found = operand ? evaluateOperand(operand as Parameters<typeof evaluateOperand>[0], env) : undefined;
      if (found?.status !== 'value' || typeof found.value !== 'string') return {};
      const call: ResolvedCall = { domain: found.value.split('.')[0], service: 'toggle', entityIds: [found.value], data: {} };
      const next = applyCall(input.house, input.overlay, call);
      return { simulated: summary(call, input), call, overlay: next === input.overlay ? undefined : next };
    }
    case 'set-local': {
      const field = input.document.localState?.find(item => item.id === action.stateId);
      if (!field || !acceptsLocalValue(field, action.value)) return {};
      return { overlay: applyLocal(input.overlay, action.stateId, action.value) };
    }
    default: return {};
  }
}
