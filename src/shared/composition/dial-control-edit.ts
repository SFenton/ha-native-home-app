import type { Json } from '../types';
import { DIAL_CONTROL_MAX_STEPS, DIAL_CONTROL_MAX_TICKS, snapToStep } from './dial-control-math';

/**
 * What the Studio's Dial Control editor does to a document: the starting points ("Start From"), adding and removing a stopper, the rule between two, the form
 * of the call, the Thermostat view over `climate-control` kind `dial`, and the checks that need no house. It works on plain JSON and returns new values; it
 * never draws, and the contract's own rules stay in `dial-control.ts` and the compiler.
 *
 * A person sees **stopper**, **Can Pass Each Other**, **Stop at Each Other** and **Stay Apart**; the file keeps the contract's names (`between.rule`, `gap`).
 */
type Obj = Record<string, Json>;
const literal = (value: Json): Obj => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): Obj => ({ type: 'solid-rgb', red, green, blue });
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The words of the Start From row, and what each starts. */
export type DialStart = 'blank' | 'one' | 'range' | 'thermostat';
/** The order and words of the Start From menu. */
export const dialStarts: readonly { value: DialStart; label: string }[] = [
  { value: 'blank', label: 'Blank' }, { value: 'one', label: 'One Value' }, { value: 'range', label: 'Range' }, { value: 'thermostat', label: 'Thermostat' },
];
/** The three words the rule between two stoppers shows as. */
export type BetweenChoice = 'free' | 'stop' | 'apart';
/** The Between Stoppers menu, in the order the mockup lists it. */
export const betweenChoices: readonly { value: BetweenChoice; label: string }[] = [
  { value: 'free', label: 'Can Pass Each Other' }, { value: 'stop', label: 'Stop at Each Other' }, { value: 'apart', label: 'Stay Apart' },
];
/** The two ways a release sends its call. */
export type CallForm = 'dial' | 'stopper';
/** The words of the When Released menu. */
export const callForms: readonly { value: CallForm; label: string }[] = [{ value: 'dial', label: 'One Call for the Dial' }, { value: 'stopper', label: 'One Call per Stopper' }];

const pair = (light: Obj, dark: Obj): Obj => ({ type: 'solid-appearance', light, dark });
/**
 * The ink of the first and second stopper in a new dial: one colour for each appearance, picked so each holds 3 to 1 against the track in its own appearance
 * (deep blue and amber, then deep red and mint). The two differ by hue as well as by position and label.
 */
export const stopperInks = [pair(solid(0, 60, 150), solid(255, 200, 60)), pair(solid(120, 30, 0), solid(140, 255, 200))] as const;
/** The thermostat's trails (heat orange, cool teal), the shipped colours. */
export const heatInk = solid(205, 84, 1), coolInk = solid(44, 142, 152);

/** What a new node needs from the document: its id, title and layout. */
export interface DialBase { id: string; title: string; layout: Obj }

const oneCall = (domain: string, service: string, fields: Obj): Obj => ({ type: 'call-service', domain, service, data: { type: 'object', fields } });
const ofStopper = (id: string): Obj => ({ type: 'control', stopper: id });

/** A stopper with an authored value and its words. */
function newStopper(id: string, value: number, label: string, ink: Obj, trail?: 'from-start' | 'to-end'): Obj {
  return { id, value: literal(value), label: literal(label), ink, ...(trail ? { trail, trailInk: ink } : {}) };
}

/**
 * A new dial control for a starting point other than the thermostat. Blank is one stopper at 50 with a call that names nothing yet (Checks says so); One Value
 * is one stopper with a trail from the start; Range is two stoppers that stop at each other, each with a trail, and one call that reads both.
 */
export function newDialControl(start: Exclude<DialStart, 'thermostat'>, base: DialBase, range: { min: number; max: number; step: number } = { min: 0, max: 100, step: 1 }): Obj {
  const mid = snapToStep(range, (range.min + range.max) / 2);
  const props: Obj = {
    range: { ...range }, size: 'page',
    stoppers: [] as Json[],
    center: { value: { shows: 'target', fractionDigits: 0, unit: '' } },
    unavailableText: 'Unavailable', failureText: 'Couldn’t set {value}.',
  };
  let action: Obj;
  if (start === 'range') {
    const span = range.max - range.min;
    props.stoppers = [newStopper('low', snapToStep(range, range.min + span / 4), 'Low', stopperInks[0], 'from-start'), newStopper('high', snapToStep(range, range.min + span * 3 / 4), 'High', stopperInks[1], 'to-end')];
    props.between = { rule: 'stop' };
    (props.center as Obj).value = { shows: 'low', fractionDigits: 0, unit: '' };
    props.center = { ...(props.center as Obj), caption: 'stoppers' };
    action = oneCall('input_number', 'set_value', { low: ofStopper('low'), high: ofStopper('high') });
  } else {
    props.stoppers = [newStopper('target', mid, 'Target', stopperInks[0], start === 'one' ? 'from-start' : undefined)];
    action = oneCall('input_number', 'set_value', { value: ofStopper('target') });
  }
  return { ...base, type: 'dial-control', props, action, a11y: { label: literal(base.title) } };
}

// MARK: Reading the node

/** The node's shape as these helpers read it. */
export interface DialNodeShape { id: string; title: string; layout: Obj; type: 'dial-control'; props: Obj; action?: Obj; a11y: Obj; [key: string]: Json | undefined }
/** The stoppers of a dial control. */
export const stoppersOf = (node: { props: Obj }): Obj[] => (Array.isArray(node.props.stoppers) ? node.props.stoppers.filter(isObject) : []);
/** The id of each stopper. */
export const stopperIds = (node: { props: Obj }): string[] => stoppersOf(node).map(stopper => String(stopper.id));

/** Which of the three words the rule between two stoppers is: a gap above 0, or a gap read from somewhere, is Stay Apart. */
export function betweenOf(node: { props: Obj }): BetweenChoice {
  const between = isObject(node.props.between) ? node.props.between : undefined;
  if (!between || between.rule === 'free') return 'free';
  const gap = isObject(between.gap) ? between.gap : undefined;
  if (!gap) return 'stop';
  return gap.type === 'literal' && gap.value === 0 ? 'stop' : 'apart';
}
/** Which form the release sends: the dial's own call, or one on each stopper. */
export const callFormOf = (node: { props: Obj; action?: Obj }): CallForm => (node.action !== undefined || stoppersOf(node).every(stopper => stopper.action === undefined) ? 'dial' : 'stopper');

// MARK: Changing the node

/** Replaces `control` operands anywhere in a value (a call's data), keeping everything else. */
function mapControls(value: Json, replace: (control: Obj) => Json): Json {
  if (Array.isArray(value)) return value.map(item => mapControls(item, replace));
  if (!isObject(value)) return value;
  if (value.type === 'control') return replace(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapControls(item, replace)]));
}
const withoutKey = (value: Obj, key: string): Obj => { const { [key]: _gone, ...rest } = value; void _gone; return rest; };

/** The node with its `props` changed by `change`. */
export function withProps<T extends { props: Obj }>(node: T, change: (props: Obj) => Obj): T { return { ...node, props: change(node.props) }; }

/** The rule between two stoppers set to one of the three words. Stay Apart starts at one step; the other two drop the gap. */
export function withBetween<T extends { props: Obj }>(node: T, choice: BetweenChoice): T {
  if (stoppersOf(node).length < 2) return node;
  const range = node.props.range as { step: number };
  const between: Obj = choice === 'free' ? { rule: 'free' } : choice === 'stop' ? { rule: 'stop' } : { rule: 'stop', gap: literal(range.step) };
  return withProps(node, props => ({ ...props, between }));
}

/**
 * Adds the second stopper: it takes the other end of the ring, stops at the first, and a one-call dial reads it in its call. `null` when there are two already.
 * A per-stopper dial gives it a copy of the first stopper's call.
 */
export function addStopper<T extends { props: Obj; action?: Obj }>(node: T): T | null {
  const stoppers = stoppersOf(node);
  if (stoppers.length !== 1) return null;
  const range = node.props.range as { min: number; max: number; step: number };
  const first = stoppers[0], taken = String(first.id);
  const id = taken === 'high' ? 'low' : 'high';
  const value = isObject(first.value) && typeof first.value.value === 'number' ? first.value.value : (range.min + range.max) / 2;
  const added: Obj = newStopper(id, snapToStep(range, Math.min(range.max, value + (range.max - range.min) / 4)), id === 'high' ? 'High' : 'Low', stopperInks[1], 'to-end');
  const place = id === 'high' ? [first, added] : [added, first];
  const next = { ...node, props: { ...node.props, stoppers: place.map(stopper => stopper.id === taken && isObject(stopper.value) ? { ...stopper, trail: stopper.trail ?? 'from-start' } : stopper), between: { rule: 'stop' } } } as T;
  if (callFormOf(node) === 'stopper' && isObject(first.action)) {
    const stoppersWithCalls = (next.props.stoppers as Obj[]).map(stopper => (stopper.id === id ? { ...stopper, action: mapControls(first.action as Json, () => ({ type: 'control' })) } : stopper));
    return { ...next, props: { ...next.props, stoppers: stoppersWithCalls } };
  }
  if (isObject(node.action)) {
    const fields = isObject(node.action.data) && isObject(node.action.data.fields) ? node.action.data.fields : {};
    const key = Object.hasOwn(fields, id) ? `${id}_value` : id;
    const data = { type: 'object', fields: { ...fields, [key]: ofStopper(id) } };
    return { ...next, action: { ...node.action, data } };
  }
  return next;
}

/** Removes a stopper (the dial keeps at least one). What read it follows: the middle shows the one that is left, and the rule between goes. */
export function removeStopper<T extends { props: Obj; action?: Obj }>(node: T, id: string): T | null {
  const stoppers = stoppersOf(node);
  if (stoppers.length < 2 || !stoppers.some(stopper => stopper.id === id)) return null;
  const left = stoppers.filter(stopper => stopper.id !== id);
  const center = node.props.center as Obj, value = center.value as Obj;
  const props = withoutKey({ ...node.props, stoppers: left, center: { ...center, value: { ...value, shows: value.shows === id ? String(left[0].id) : value.shows } } }, 'between');
  let action = node.action;
  if (isObject(action)) {
    const data = isObject(action.data) && isObject(action.data.fields)
      ? { type: 'object', fields: Object.fromEntries(Object.entries(action.data.fields).filter(([, item]) => !(isObject(item) && item.type === 'control' && item.stopper === id))) } : action.data;
    action = { ...action, data };
  }
  return { ...node, props, ...(action ? { action } : {}) } as T;
}

/** The form of the release changed. Per stopper to one call takes the first stopper's call; one call to per stopper gives each stopper a copy, reading its own value. */
export function withCallForm<T extends { props: Obj; action?: Obj }>(node: T, form: CallForm): T {
  if (callFormOf(node) === form) return node;
  const stoppers = stoppersOf(node);
  if (form === 'stopper') {
    const call = (isObject(node.action) ? node.action : oneCall('input_number', 'set_value', {})) as Obj;
    const next = stoppers.map(stopper => ({ ...stopper, action: mapControls(call, () => ({ type: 'control' })) }));
    return withoutAction({ ...node, props: { ...node.props, stoppers: next } } as T);
  }
  const first = stoppers[0]?.action;
  const call = (isObject(first) ? first : oneCall('input_number', 'set_value', {})) as Obj;
  const own = String(stoppers[0]?.id ?? 'target');
  const next = stoppers.map(stopper => withoutKey(stopper, 'action'));
  return { ...node, props: { ...node.props, stoppers: next }, action: mapControls(call, () => ofStopper(own)) } as T;
}
const withoutAction = <T extends { action?: Obj }>(node: T): T => withoutKey(node as unknown as Obj, 'action') as unknown as T;

/**
 * A start applied to an existing dial control: the node keeps its id, title, layout and range, and the rest is what the start gives. The thermostat is not
 * one of these: it is a different node (`toThermostat`).
 */
export function restart(node: DialNodeShape, start: Exclude<DialStart, 'thermostat'>): Obj {
  const range = node.props.range as { min: number; max: number; step: number };
  const fresh = newDialControl(start, { id: node.id, title: node.title, layout: node.layout }, range) as Obj;
  return { ...fresh, props: { ...(fresh.props as Obj), size: node.props.size }, ...(node.a11y ? { a11y: node.a11y } : {}), ...(node.visibleWhen ? { visibleWhen: node.visibleWhen } : {}) };
}

// MARK: The Thermostat view

/** A thermostat dial as the Studio shows it: the range, the unit, the size and the data it reads. */
export interface ThermostatView { sourceId: string; minimum: number; maximum: number; step: number; unit: '°F' | '°C'; size: 'page' | 'modal' | 'compact' }
/** Whether a node is a thermostat dial (`climate-control` kind `dial`), which the Studio shows as a Dial Control. */
export function isThermostatDial(node: { type?: string; props?: unknown } | undefined): boolean { return node?.type === 'climate-control' && isObject(node.props) && node.props.kind === 'dial'; }
/** The Thermostat view of a thermostat dial. */
export function thermostatView(node: { props: Obj }): ThermostatView {
  const dial = node.props.dial as Obj;
  return { sourceId: String(node.props.sourceId), minimum: Number(dial.minimum), maximum: Number(dial.maximum), step: Number(dial.step), unit: dial.unit as '°F' | '°C', size: dial.size as ThermostatView['size'] };
}
/** The thermostat dial with its view written back: only `props.dial` changes, so the node publishes as it did. Reading the view and writing it back changes nothing. */
export function withThermostatView<T extends { props: Obj }>(node: T, view: Partial<Omit<ThermostatView, 'sourceId'>>): T {
  const dial = node.props.dial as Obj;
  const next: Obj = { ...dial };
  if (view.minimum !== undefined) next.minimum = view.minimum;
  if (view.maximum !== undefined) next.maximum = view.maximum;
  if (view.step !== undefined) next.step = view.step;
  if (view.unit !== undefined) next.unit = view.unit;
  if (view.size !== undefined) next.size = view.size;
  return { ...node, props: { ...node.props, dial: next } };
}

/** The data source a new thermostat reads, when the document has none: a `climate@1` model for an entity the person chooses next. */
export function newClimateSource(id: string, entityId = 'climate.example'): Obj {
  return { id, kind: 'model', model: 'climate@1', inputs: { entityId, rangeCommitEntityIds: [entityId] } };
}
/** A thermostat dial reading `sourceId`, as the app's own pages author it. */
export function newThermostat(base: DialBase, sourceId: string, range: { minimum: number; maximum: number; step: number } = { minimum: 45, maximum: 95, step: 0.5 }): Obj {
  return {
    ...base, type: 'climate-control',
    props: { sourceId, icon: 'thermometer.medium', hint: '', loadingText: 'Loading', unavailableText: 'Unavailable', errorText: 'Didn’t Respond', kind: 'dial', dial: { ...range, unit: '°F', size: 'modal' } },
  };
}
/** A Range dial control made from a thermostat dial: its range and size carry over, and the trails take the thermostat's colours. */
export function fromThermostat(node: { id: string; title: string; layout: Obj; props: Obj }): Obj {
  const view = thermostatView(node);
  const made = newDialControl('range', { id: node.id, title: node.title, layout: node.layout }, { min: view.minimum, max: view.maximum, step: view.step }) as Obj;
  const props = made.props as Obj;
  const [low, high] = props.stoppers as Obj[];
  return { ...made, props: { ...props, size: view.size, stoppers: [{ ...low, ink: heatInk, trailInk: heatInk, label: literal('Heat to') }, { ...high, ink: coolInk, trailInk: coolInk, label: literal('Cool to') }],
    center: { ...(props.center as Obj), value: { shows: 'low', fractionDigits: 0, unit: view.unit } } } };
}

/**
 * What the Studio remembers of a thermostat that became a Range, by node id, so choosing Thermostat again gives the same thermostat back (its source, icon, texts,
 * unit and range) instead of binding some other one. It lives for the session; a node with no memory asks which thermostat.
 */
const thermostatMemory = new Map<string, { node: Obj; entityId: unknown }>();
const entityOf = (sources: readonly Obj[], sourceId: string): unknown => { const found = sources.find(source => source.id === sourceId); return isObject(found?.inputs) ? found.inputs.entityId : undefined; };
/** Remembers a thermostat dial before it is changed into something else, with the entity its source reads now. */
export const rememberThermostat = (node: { id: string; props: Obj }, sources: readonly Obj[]): void => {
  thermostatMemory.set(node.id, { node: structuredClone(node) as unknown as Obj, entityId: entityOf(sources, String(node.props.sourceId)) });
};
/**
 * The remembered thermostat for a node, only while its source is still there and still reads the entity it read then. A source rewritten in between (another node
 * changed its entity) is not the same thermostat, so nothing is restored and the Studio asks which one.
 */
export function recallThermostat(id: string, sources: readonly Obj[]): Obj | undefined {
  const found = thermostatMemory.get(id);
  if (!found) return undefined;
  const entity = entityOf(sources, String((found.node.props as Obj).sourceId));
  return entity !== undefined && entity === found.entityId ? found.node : undefined;
}

/** The parts of a document these helpers read: its data sources, and the rest as JSON. */
interface DocumentShape { dataSources: Obj[] }
/** Whether anything in the document other than the data source itself and the node at `path` names the source: another node, an action, a flow. */
export function sourceUsedElsewhere(document: DocumentShape & Obj, path: (string | number)[], sourceId: string): boolean {
  const without = structuredClone(document) as Obj;
  let holder: any = without;
  for (const key of path.slice(0, -1)) holder = holder[key];
  holder[path[path.length - 1]] = null;
  without.dataSources = (without.dataSources as Obj[]).filter(source => source.id !== sourceId);
  return JSON.stringify(without).includes(`"${sourceId}"`);
}
const freshId = (taken: ReadonlySet<string>, base: string): string => { let id = base, count = 1; while (taken.has(id)) id = `${base}-${++count}`; return id; };

/**
 * A thermostat dial for `entityId`, made from a node that has no thermostat of its own: it reads a `climate@1` source for exactly that entity (an existing one,
 * or a new one), so the person chose it and nothing is picked silently. Returns the sources to write and the node.
 */
export function thermostatFor(document: DocumentShape, base: DialBase, entityId: string): { dataSources: Obj[]; node: Obj } {
  const existing = document.dataSources.find(source => source.kind === 'model' && source.model === 'climate@1' && isObject(source.inputs) && source.inputs.entityId === entityId);
  if (existing) return { dataSources: document.dataSources, node: newThermostat(base, String(existing.id)) };
  const id = freshId(new Set(document.dataSources.map(source => String(source.id))), `climate-${entityId.replace(/[^A-Za-z0-9_-]/g, '-')}`);
  return { dataSources: [...document.dataSources, newClimateSource(id, entityId)], node: newThermostat(base, id) };
}

/**
 * Points the thermostat at `path` at another entity, changing this node's binding only. A source that nothing else names changes in place: its `entityId`
 * moves, and the old entity id inside `rangeCommitEntityIds` and `actionEntityId` moves with it; the rest of the list stays. A source another node reads is
 * forked for this node, so no other thermostat moves.
 */
export function rebindThermostat(document: DocumentShape & Obj, path: (string | number)[], node: { props: Obj }, entityId: string): { dataSources: Obj[]; sourceId: string } {
  const sourceId = String(node.props.sourceId);
  const source = document.dataSources.find(item => item.id === sourceId);
  if (!source || !isObject(source.inputs)) return { dataSources: document.dataSources, sourceId };
  const old = source.inputs.entityId;
  const swap = (inputs: Obj): Obj => ({
    ...inputs, entityId,
    ...(Array.isArray(inputs.rangeCommitEntityIds) ? { rangeCommitEntityIds: inputs.rangeCommitEntityIds.map(item => (item === old ? entityId : item)) } : {}),
    ...(inputs.actionEntityId === old ? { actionEntityId: entityId } : {}),
  });
  if (!sourceUsedElsewhere(document, path, sourceId)) return { dataSources: document.dataSources.map(item => (item.id === sourceId ? { ...item, inputs: swap(source.inputs as Obj) } : item)), sourceId };
  const id = freshId(new Set(document.dataSources.map(item => String(item.id))), `${sourceId}-copy`);
  return { dataSources: [...document.dataSources, { ...source, id, inputs: swap(source.inputs as Obj) }], sourceId: id };
}

// MARK: Checks

/** A note the Checks list shows: where it is, relative to the document, and what it says. */
export interface DialWarning { pointer: string; message: string }

const channel = (value: number) => { const share = value / 255; return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4; };
const luminance = (red: number, green: number, blue: number) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
/** The contrast of two colours as a ratio, 1 to 21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [light, dark] = [luminance(...a), luminance(...b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
/** The track as the app draws it: the label colour at 43% over the page's ground, so mid grey, in the light appearance then the dark one. */
const tracks: readonly [number, number, number][] = [[145, 145, 145], [110, 110, 110]];
const ruleNumber = (operand: unknown): number | undefined => (isObject(operand) && operand.type === 'literal' && typeof operand.value === 'number' ? operand.value : undefined);
/**
 * Each colour of a fixed ink with the track it is seen against: a single colour against both tracks, a light and dark pair each against its own. A ruled look
 * (`conditional`) is the rule's business and gives none.
 */
function seenAgainst(ink: unknown): { rgb: [number, number, number]; track: [number, number, number] }[] {
  const rgb = (value: unknown): [number, number, number] | undefined => (isObject(value) && (value.type === 'solid-rgb' || value.type === 'rgba') ? [Number(value.red), Number(value.green), Number(value.blue)] : undefined);
  if (isObject(ink) && ink.type === 'solid-appearance') {
    const light = rgb(ink.light), dark = rgb(ink.dark);
    return [...(light ? [{ rgb: light, track: tracks[0] }] : []), ...(dark ? [{ rgb: dark, track: tracks[1] }] : [])];
  }
  const one = rgb(ink);
  return one ? tracks.map(track => ({ rgb: one, track })) : [];
}

/**
 * The notes for one dial control that need no house: a stopper with no value; two stoppers that stop at each other with the first above the second; a gap so
 * large that no two values fit; a ring that would draw more than 60 dots, or holds more than 2,000 steps; a rim under 3 to 1 against the track in either
 * appearance; and a speaker's volume, which the system volume view cannot reach. Problems the compiler refuses (a mixed call form, a literal gap past the
 * range) are the compiler's.
 */
export function dialControlWarnings(node: { id: string; props: Obj; action?: Obj }, pointer: string): DialWarning[] {
  const out: DialWarning[] = [];
  const add = (at: string, message: string) => out.push({ pointer: `${pointer}${at}`, message });
  const range = node.props.range as { min: number; max: number; step: number } | undefined;
  const stoppers = stoppersOf(node);
  stoppers.forEach((stopper, index) => {
    const at = `/props/stoppers/${index}`;
    const value = stopper.value;
    if (!isObject(value) || (value.type === 'literal' && (typeof value.value !== 'number' || !Number.isFinite(value.value)))) add(`${at}/value`, 'A stopper has no value, so it is not drawn. Choose its value.');
    if (seenAgainst(stopper.ink).some(seen => contrastRatio(seen.rgb, seen.track) < 3)) add(`${at}/ink`, 'A stopper’s rim is under 3 to 1 against the track in light or dark. Choose a stronger color.');
    if (seenAgainst(stopper.trailInk).some(seen => contrastRatio(seen.rgb, seen.track) < 3)) add(`${at}/trailInk`, 'A stopper’s trail is under 3 to 1 against the track in light or dark. Choose a stronger color.');
    const call = JSON.stringify(stopper.action ?? (index === 0 ? node.action : undefined) ?? '');
    if (/"entity_id":\{"type":"literal","value":"media_player\./.test(call)) add(`${at}/value`, 'A slider is not the way to set volume. Use a speaker’s own controls where you can.');
  });
  const props = node.props;
  if (range) {
    if ((range.max - range.min) / range.step > DIAL_CONTROL_MAX_STEPS + 1e-9) add('/props/range/step', `A dial holds at most ${DIAL_CONTROL_MAX_STEPS} steps. Raise Step.`);
    const ticks = isObject(props.ticks) ? Number(props.ticks.every) : undefined;
    if (ticks && Math.floor((range.max - range.min) / ticks + 1e-9) + 1 > DIAL_CONTROL_MAX_TICKS) add('/props/ticks/every', `A dial draws at most ${DIAL_CONTROL_MAX_TICKS} dots. Raise Every.`);
    const between = isObject(props.between) ? props.between : undefined;
    const gap = ruleNumber(between?.gap);
    if (between?.rule === 'stop' && gap !== undefined && gap > 0 && range.max - range.min - gap < range.step) add('/props/between/gap', 'The gap leaves no room for both stoppers. Make Stay Apart smaller.');
    if (between?.rule === 'stop' && stoppers.length === 2) {
      const [low, high] = stoppers.map(stopper => ruleNumber(stopper.value));
      if (low !== undefined && high !== undefined && low > high) add('/props/stoppers/0/value', 'The first stopper is above the second, and they stop at each other. Lower the first or raise the second.');
    }
  }
  return out;
}
