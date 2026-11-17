import { createContext, useContext } from 'react';
import type { StatePreview } from '../../preview2/render-context';
import {
  builtInStyles, ruleFor, stateClasses, stateIndicators, type StateClass, type StateFallback, type StateIndicator, type StateRule, type StateStyleDefinition,
} from '../../shared/composition/state-styles';
import { titleCase } from '../../shared/composition/state-style-preview';

// MARK: Words

/** A class in the app's words. The unknown class is "Unavailable": the person never sees "unknown". */
export const classWord: Record<StateClass, string> = { resting: 'Resting', 'in-progress': 'In Progress', warning: 'Warning', error: 'Error', unknown: 'Unavailable' };
/** The same words in a sentence. */
export const classSentence: Record<StateClass, string> = { resting: 'Resting', 'in-progress': 'In progress', warning: 'Warning', error: 'Error', unknown: 'Unavailable' };
/** The classes an author may pick for a state: the unknown class is fixed for `unavailable` and `unknown` only. */
export const pickableClasses: readonly StateClass[] = stateClasses.filter(item => item !== 'unknown');
/** An indicator's name as the menus show it. */
export const indicatorWord: Record<StateIndicator, string> = { none: 'None', 'arc-spinner': 'Arc Spinner', pulse: 'Pulse', breathe: 'Breathe', bounce: 'Bounce', wiggle: 'Wiggle' };
export const indicatorChoices: readonly StateIndicator[] = stateIndicators;
/** What the menus call the words of a state: Home Assistant's name read as words (`armed_home` is "Armed Home"). */
export const stateName = (state: string): string => state === 'unavailable' ? 'Unavailable' : state === 'unknown' ? 'Unknown' : titleCase(state);

/** The two phases that follow a tap, which the style cannot name as states. */
export const phaseWords = { sending: 'Sending', failed: 'Didn’t Respond' } as const;

// MARK: States of a style

/** One state a style names, with the rule it falls under (the fallback for a state no rule names). */
export interface StateEntry { state: string; rule: StateRule | StateFallback; index: number }

/** Every state a style names, in rule order, then `unavailable` when no rule names it (the style still draws it). */
export function styleStates(style: Pick<StateStyleDefinition, 'rules' | 'fallback'>): StateEntry[] {
  const found: StateEntry[] = [];
  style.rules.forEach((rule, index) => rule.states.forEach(state => { if (!found.some(item => item.state === state)) found.push({ state, rule, index }); }));
  if (!found.some(item => item.state === 'unavailable')) found.push({ state: 'unavailable', rule: ruleFor(style, 'unavailable'), index: -1 });
  return found;
}

/** Whether any state of the style has a tap, so "After a Tap" has something to show. */
export const hasTap = (style: Pick<StateStyleDefinition, 'rules' | 'fallback'>): boolean => [...style.rules, style.fallback].some(rule => Boolean(rule.action));

/** What a tap does in a state, in words. */
export const tapWords = (rule: StateRule | StateFallback): string => rule.action ? `Tap: ${rule.action.verb}` : 'No tap';

/** The words under a state's menu: its class and what a tap does. "In progress. A tap says Stop." */
export function stateNote(rule: StateRule | StateFallback, unavailable: boolean): string {
  const stateClass: StateClass = unavailable ? 'unknown' : rule.class;
  return `${classSentence[stateClass]}. ${rule.action && !unavailable ? `A tap says ${rule.action.verb}.` : 'A tap does nothing.'}`;
}

/** The built-in styles for a domain, and which of them is built in. */
export const builtInsFor = (domain: string): StateStyleDefinition[] => builtInStyles.filter(style => style.domain === domain);

// MARK: What "Show state" holds

/** The state of "Show state" and its setter, provided where the simulator is beside the editor. */
export interface StatePreviewApi { preview?: StatePreview; set(next: StatePreview | undefined): void }
/** Carries "Show state" from the States group to the simulator. */
export const StatePreviewContext = createContext<StatePreviewApi | undefined>(undefined);
/** The simulator's state choice, or undefined where no simulator is beside the editor. */
export const useStatePreview = () => useContext(StatePreviewContext);
