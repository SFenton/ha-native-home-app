/**
 * The corpus cases of the four ids the edge-logic lane `ne-operands` adds, all generic (nothing here is named for a card): `sh.entity-time@1` (the
 * `last-changed` operand: when an entity's state last changed), `sh.countdown@1` (the `date` operation `seconds-between` and the `clock` part
 * `now-second`), `sh.duration-format@1` (the `duration` format spec: compact, clock, minutes-seconds, span) and `sh.math-truncate@1` (the `math`
 * operation `truncate`). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-<family>-*`
 * (the Studio compiles them: while the app lacks the id, that file is the proof that a phone without it refuses the document) and `<family>-*` (the Studio
 * refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the generator fails when the compiler disagrees.
 *
 * The evaluation answers are worked out by hand from the production code the ids reproduce, never computed by the modules under test: the alarm panel's
 * "Since 9:30 PM" (`UKServerUISecurityViews.swift:40-48`), the humidifier's `30m` and `1h 30m` (`HumidifierController.formatMinutes`, `formatSeconds`), the
 * fan's `05:00` and `01:00:00` (`BathroomFanController.formatRemaining`), the bed's `4:30` (`BedFormat.countdown`), a chore's "3 days" (`TodoItem.dueLabel`)
 * and the room overview's one-decimal temperature (`RoomOverview.truncatedOneDecimal`, `(v*10).rounded(.towardZero)/10`).
 */
type J = Record<string, any>;

export interface NeCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface NeEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const neFamilies = ['entity-time', 'countdown', 'duration-format', 'math-truncate'];
/** Capability ids by the short names the cases use. */
export const neNeeds: Record<string, string> = {
  'entity-time': 'sh.entity-time@1', countdown: 'sh.countdown@1', 'duration-format': 'sh.duration-format@1', 'math-truncate': 'sh.math-truncate@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const exprText = (operand: J, fallback?: string): J[] => [node('t', 'text', { props: { value: { type: 'expr', value: operand, ...(fallback ? { fallback } : {}) }, style: 'body', unavailableText: 'None' } })];
const when = (predicate: J): J[] => [node('t', 'text', { props: { value: lit('Shown'), style: 'body', unavailableText: 'None' }, visibleWhen: predicate })];
const changed = (sourceId: string): J => ({ type: 'last-changed', sourceId });
const today: J = { type: 'clock', part: 'today' }, now: J = { type: 'clock', part: 'now' }, nowSecond: J = { type: 'clock', part: 'now-second' };
const between = (from: J, to: J, op = 'days-between'): J => ({ type: 'date', op, from, to });
const seconds = (from: J, to: J): J => between(from, to, 'seconds-between');
const math = (op: string, ...args: J[]): J => ({ type: 'math', op, args });
const duration = (style: string, unit?: string): J => ({ duration: { style, ...(unit ? { unit } : {}) } });
const digits = (maximumFractionDigits: number, minimumFractionDigits?: number): J => ({ number: { maximumFractionDigits, ...(minimumFractionDigits === undefined ? {} : { minimumFractionDigits }) } });
/** The generator adds the app-state sources to a case that is not one of its own; these cases use none, so they are dropped (keeps the first refusal the case's own). */
const noAppState: NeCase['tweak'] = envelope => { envelope.document.dataSources = envelope.document.dataSources.filter((entry: J) => entry.model !== 'app-state@1'); };

export const neCases: NeCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[]) => neCases.push({ name, note, needs, components, tweak: noAppState, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: NeCase['expect']) =>
  neCases.push({ name, note, needs, components, tweak: noAppState, reject: true, expect });
// The sources the generator gives every case: `temp` (a sensor), `guest-fan` (a fan) and `lights` (a home status model).
const FLOW_VALUE = '/document/dataSources/5/inputs/request/value';
const at = (rest: string) => `/document/pages/2/components/0${rest}`;

// MARK: Entity time (`sh.entity-time@1`)
const since = choose([[cmp('eq', between(changed('temp'), today), lit(0)), fmt('Since {t}', { t: changed('temp') }, { t: { date: { style: 'time' } } })]],
  fmt('Since {d}', { d: changed('temp') }, { d: { date: { style: 'short-date' } } }));
accept('pending-entity-time-since-line', 'The alarm panel\'s line: "Since 9:30 PM" when the state changed today, "Since Oct 14, 2025" on an earlier day.', ['entity-time', 'pipeline-operands', 'rules', 'conditions'], exprText(since));
accept('pending-entity-time-condition', 'A node shown while the last change lies after a fixed moment: a date and time compares as an instant.', ['entity-time', 'conditions'],
  when(cmp('after', changed('temp'), lit('2026-01-01T00:00:00Z'))));
/** A flow whose one value is `value`: a `none` request, so nothing but the operand is under test. */
const flowOf = (value: J): NeCase['tweak'] => envelope => {
  noAppState(envelope);
  envelope.document.dataSources.push({ id: 'flow', kind: 'model', model: 'pipeline@1', inputs: { title: 'Edge Flow', parameters: [], request: { type: 'none', value }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'string' } } });
};
const flowReject = (name: string, note: string, needs: string[], value: J, expect: NeCase['expect']) =>
  neCases.push({ name, note, needs: [...needs, 'pipeline', 'pipeline-operands'], components: [], tweak: flowOf(value), reject: true, expect });
flowReject('entity-time-in-a-flow', 'A flow reads no entity\'s last change: it runs on what it was given, so last-changed is refused there.', ['entity-time'], changed('temp'), { code: 'invalid_combination', pointer: FLOW_VALUE });
flowReject('countdown-now-second-in-a-flow', 'A flow runs once on the minute clock it is given: there is no second clock for it.', ['countdown'], nowSecond, { code: 'invalid_combination', pointer: FLOW_VALUE });
flowReject('countdown-seconds-between-now-second-in-a-flow', 'seconds-between is fine in a flow, but the second clock inside it is not.', ['countdown'], seconds(nowSecond, lit('2026-11-15T10:00:00')), { code: 'invalid_combination', pointer: `${FLOW_VALUE}/from` });
reject('entity-time-model-source', 'The last change is an entity\'s: a model source has none.', ['entity-time'], exprText(changed('lights')), { code: 'binding_type', pointer: at('/props/value/value/sourceId') });
reject('entity-time-unknown-source', 'The source must be declared.', ['entity-time'], exprText(changed('nowhere')), { code: 'invalid_reference', pointer: at('/props/value/value/sourceId') });
reject('entity-time-with-path', 'The operand names a source only: the time is the entity\'s, not an attribute\'s.', ['entity-time'], exprText({ type: 'last-changed', sourceId: 'temp', path: ['state'] }), { code: 'unknown_field', pointer: at('/props/value/value/path') });
reject('entity-time-source-missing', 'A source id is required.', ['entity-time'], exprText({ type: 'last-changed' }), { code: 'missing_required', pointer: at('/props/value/value/sourceId') });

// MARK: Countdown (`sh.countdown@1`)
const finish = read('guest-fan', ['attributes', 'finishes_at']);
accept('pending-countdown-clock-text', 'A timer\'s remaining time as the fan draws it: the seconds from now (to the second) to when the timer finishes, as 05:00.', ['countdown', 'duration-format', 'pipeline-operands'],
  exprText(fmt('Off in {s}', { s: seconds(nowSecond, finish) }, { s: duration('clock') })));
accept('pending-countdown-until-attribute', 'The same timer as a minutes and seconds readout: the seconds from now to the fan\'s finishes_at attribute, drawn as 4:30.', ['countdown', 'duration-format', 'pipeline-operands'],
  exprText(fmt('{s} left', { s: seconds(nowSecond, read('guest-fan', ['attributes', 'finishes_at'])) }, { s: duration('minutes-seconds') }), 'None'));
accept('pending-countdown-condition', 'A node shown while the timer has not finished: now, to the second, before the finish time.', ['countdown', 'conditions', 'pipeline-operands'],
  when(cmp('before', nowSecond, finish)));
accept('pending-countdown-seconds-number', 'The seconds themselves, as a number.', ['countdown', 'pipeline-operands'], exprText(seconds(nowSecond, finish)));
reject('countdown-date-unknown-operation', 'The date operations are days-between, progress and seconds-between.', ['countdown', 'pipeline-operands'], exprText(between(nowSecond, finish, 'minutes-between')), { code: 'unknown_variant', pointer: at('/props/value/value/op') });
reject('countdown-clock-unknown-part', 'The clock parts are today, now and now-second.', ['countdown', 'pipeline-operands'], exprText({ type: 'clock', part: 'now-minute' }), { code: 'unknown_variant', pointer: at('/props/value/value/part') });
reject('countdown-seconds-between-without-to', 'Both moments are required.', ['countdown', 'pipeline-operands'], exprText({ type: 'date', op: 'seconds-between', from: nowSecond }), { code: 'missing_required', pointer: at('/props/value/value/to') });

// MARK: Duration format (`sh.duration-format@1`)
accept('pending-duration-format-styles', 'Every style in one sentence: the compact, clock, minutes-seconds and span drawings.', ['duration-format'],
  exprText(fmt('{a} {b} {c} {d}', { a: read('temp', ['state'], 'number'), b: read('temp', ['state'], 'number'), c: read('temp', ['state'], 'number'), d: read('temp', ['state'], 'number') },
    { a: duration('compact', 'minutes'), b: duration('clock'), c: duration('minutes-seconds'), d: duration('span') })));
accept('pending-duration-format-off-fallback', 'The humidifier\'s timer: 30m, 1h 30m, and "Off" when there is none (a compact duration of 0 has no text, so the fallback draws).', ['duration-format'],
  exprText(fmt('{m}', { m: read('temp', ['state'], 'number') }, { m: duration('compact', 'seconds') }), 'Off'));
reject('duration-format-text-argument', 'A duration draws a number: a text argument is refused.', ['duration-format'], exprText(fmt('{m}', { m: lit('soon') }, { m: duration('clock') })), { code: 'binding_type', pointer: at('/props/value/value/formats/m') });
reject('duration-format-unit-on-clock', 'Only a compact duration says its unit: the others are always seconds.', ['duration-format'], exprText(fmt('{m}', { m: lit(5) }, { m: duration('clock', 'minutes') })), { code: 'invalid_combination', pointer: at('/props/value/value/formats/m/duration/unit') });
reject('duration-format-unknown-style', 'The styles are compact, clock, minutes-seconds and span.', ['duration-format'], exprText(fmt('{m}', { m: lit(5) }, { m: duration('verbose') })), { code: 'unknown_variant', pointer: at('/props/value/value/formats/m') });
reject('duration-format-unknown-unit', 'The units are seconds and minutes.', ['duration-format'], exprText(fmt('{m}', { m: lit(5) }, { m: duration('compact', 'hours') })), { code: 'unknown_variant', pointer: at('/props/value/value/formats/m') });
reject('duration-format-two-formats', 'One argument has one format.', ['duration-format'], exprText(fmt('{m}', { m: lit(5) }, { m: { duration: { style: 'clock' }, number: { maximumFractionDigits: 1 } } })), { code: 'unknown_variant', pointer: at('/props/value/value/formats/m') });

// MARK: Math truncate (`sh.math-truncate@1`)
accept('pending-math-truncate-one-decimal', 'The room overview\'s temperature: truncated toward zero to one decimal and drawn with its zero, 71.99 reads 71.9.', ['math-truncate', 'pipeline-operands'],
  exprText(fmt('{t}°', { t: math('truncate', read('temp', ['state'], 'number'), lit(1)) }, { t: digits(1, 1) })));
accept('pending-math-truncate-whole', 'One argument truncates to a whole number.', ['math-truncate'], exprText(math('truncate', read('temp', ['state'], 'number'))));
reject('math-truncate-three-arguments', 'Truncate takes a number and, optionally, the places.', ['math-truncate'], exprText(math('truncate', lit(1), lit(1), lit(1))), { code: 'invalid_combination', pointer: at('/props/value/value/args') });
reject('math-truncate-no-arguments', 'Truncate takes a number.', ['math-truncate'], exprText(math('truncate')), { code: 'invalid_combination', pointer: at('/props/value/value/args') });

// MARK: Evaluation
export const neEvaluations: NeEvaluation[] = [];
const value = (v: unknown): J => ({ status: 'value', value: v });
const LOADING: J = { status: 'loading' }, UNAVAILABLE: J = { status: 'unavailable' };
const operand = (name: string, note: string, subject: J, expected: J, env: J = {}) => neEvaluations.push({ name, note, subject: { operand: subject }, env, expected });
const condition = (name: string, note: string, subject: J, expected: 'yes' | 'no' | 'unknown', env: J = {}) => neEvaluations.push({ name, note, subject: { condition: subject }, env, expected: { tri: expected } });
const text = (name: string, note: string, subject: J, expected: J, env: J = {}) => neEvaluations.push({ name, note, subject: { text: subject }, env, expected });
/** `changed` maps a source id to what `readChanged` gives; a source not listed has no entity. */
const time = (sourceId: string, what: J): J => ({ changed: { [sourceId]: what } });
const reads = (map: Record<string, J>): J => ({ reads: map });
/** The wall clock the cases pin: `now` is wall time on the clock's own offset. */
const at2130 = { now: '2026-11-17T23:10:05', utcOffsetMinutes: 0 };

// Entity time. Evening of 17 November 2026 on an offset of 0 unless a case says otherwise.
operand('entity-time-value', 'The time is the entity\'s `last_changed` as Home Assistant reports it, to the millisecond, in UTC.', changed('sensor'), value('2026-11-17T21:30:00.000Z'), time('sensor', value('2026-11-17T21:30:00.000Z')));
operand('entity-time-loading', 'Before the first states arrive the time is loading.', changed('sensor'), LOADING, time('sensor', LOADING));
operand('entity-time-no-entity-is-unavailable', 'A source with no entity has no time.', changed('sensor'), UNAVAILABLE);
operand('entity-time-not-text-is-unavailable', 'A time that is not text is no time.', changed('sensor'), UNAVAILABLE, time('sensor', value(5)));
operand('entity-time-in-a-flow-is-null', 'A flow never reads an entity\'s time: the gap is null there.', changed('sensor'), value(null), { ...time('sensor', value('2026-11-17T21:30:00.000Z')), flow: true });
operand('entity-time-since-today', 'Changed today: "Since 9:30 PM" (the alarm panel\'s line).', since, value('Since 9:30 PM'), { ...time('temp', value('2026-11-17T21:30:00.000Z')), clock: at2130 });
operand('entity-time-since-yesterday', 'Changed yesterday: the short date, "Since Nov 16" (the clock\'s own year draws no year).', since, value('Since Nov 16'), { ...time('temp', value('2026-11-16T21:30:00.000Z')), clock: at2130 });
operand('entity-time-since-older-year', 'Changed in another year: the short date draws the year, "Since Oct 14, 2025".', since, value('Since Oct 14, 2025'), { ...time('temp', value('2025-10-14T08:05:00.000Z')), clock: at2130 });
operand('entity-time-since-moved-to-clock-zone', 'The time is moved to the clock\'s wall: 02:30 UTC on the 18th is 9:30 PM on the 17th at an offset of -300 minutes, so it is today.', since, value('Since 9:30 PM'),
  { ...time('temp', value('2026-11-18T02:30:00.000Z')), clock: { now: '2026-11-17T22:00:00', utcOffsetMinutes: -300 } });
operand('entity-time-since-a-later-day', 'A change dated after today (a clock behind Home Assistant\'s) is not today: the short date, "Since Nov 18".', since, value('Since Nov 18'), { ...time('temp', value('2026-11-18T09:00:00.000Z')), clock: at2130 });
operand('entity-time-absent-line-is-loading', 'With no time the rule cannot decide: it is loading, so the line keeps what it showed.', since, LOADING, { clock: at2130 });
operand('entity-time-absent-format-is-unavailable', 'A format with no time has no text.', fmt('Since {t}', { t: changed('temp') }, { t: { date: { style: 'time' } } }), UNAVAILABLE, { clock: at2130 });
condition('entity-time-future-after-clock', 'A change later than the clock is "after" it: how an author hides a time in the future.', cmp('after', changed('temp'), now), 'yes', { ...time('temp', value('2026-11-17T23:12:00.000Z')), clock: at2130 });
condition('entity-time-past-after-clock', 'A change before the clock is not after it.', cmp('after', changed('temp'), now), 'no', { ...time('temp', value('2026-11-17T21:30:00.000Z')), clock: at2130 });
condition('entity-time-absent-compare-is-unknown', 'Without a time a comparison cannot be answered.', cmp('after', changed('temp'), now), 'unknown', { clock: at2130 });

// Countdown: seconds between two moments, and the second clock.
const clockAt = (second: string) => ({ now: `2026-11-17T10:00:${second}`, utcOffsetMinutes: 0 });
const timer = (extra: J = {}) => ({ ...reads({ 'timer/attributes/finishes_at': value('2026-11-17T10:05:00+00:00') }), ...extra });
const remaining = (style: string) => fmt('{s}', { s: seconds(nowSecond, read('timer', ['attributes', 'finishes_at'])) }, { s: duration(style) });
operand('countdown-seconds-between-whole', 'Five minutes is 300 seconds.', seconds(lit('2026-11-17T10:00:00'), lit('2026-11-17T10:05:00')), value(300));
operand('countdown-seconds-between-negative', 'Later to earlier is negative: the sign says it is past.', seconds(lit('2026-11-17T10:05:00'), lit('2026-11-17T10:00:00')), value(-300));
operand('countdown-seconds-between-across-days', 'Across midnight: 30 seconds before it to 10 seconds after is 40.', seconds(lit('2026-11-17T23:59:30'), lit('2026-11-18T00:00:10')), value(40));
operand('countdown-seconds-between-fraction-dropped', 'A fraction of a second is dropped, as in every date: 00.9 is 00 and 02.1 is 02.', seconds(lit('2026-11-17T10:00:00.900'), lit('2026-11-17T10:00:02.100')), value(2));
operand('countdown-seconds-between-date-is-midnight', 'A date alone is midnight.', seconds(lit('2026-11-17'), lit('2026-11-17T00:00:30')), value(30));
operand('countdown-seconds-between-offsets-moved-to-clock', '10:00 UTC and 12:00 at +02:00 are the same moment: 0 seconds.', seconds(lit('2026-11-17T10:00:00Z'), lit('2026-11-17T12:00:00+02:00')), value(0), { clock: clockAt('00') });
operand('countdown-seconds-between-invalid', 'Text that is not a date is unavailable.', seconds(lit('soon'), lit('2026-11-17T10:00:00')), UNAVAILABLE);
operand('countdown-seconds-between-number-is-unavailable', 'A number is not a moment.', seconds(lit(5), lit('2026-11-17T10:00:00')), UNAVAILABLE);
operand('countdown-seconds-between-loading', 'A read that is loading makes the whole loading.', seconds(read('timer', ['attributes', 'finishes_at']), lit('2026-11-17T10:00:00')), LOADING, reads({ 'timer/attributes/finishes_at': LOADING }));
operand('countdown-now-second-value', 'The second clock gives the wall time to the second.', nowSecond, value('2026-11-17T10:00:07'), { clock: clockAt('07') });
operand('countdown-now-second-without-clock-is-unavailable', 'Without a clock there is no now.', nowSecond, UNAVAILABLE);
operand('countdown-now-second-needs-seconds', 'A clock whose time has no seconds does not parse: unavailable.', nowSecond, UNAVAILABLE, { clock: { now: '2026-11-17T10:00', utcOffsetMinutes: 0 } });
operand('countdown-remaining-seconds', 'The seconds left to a timer: 10:00:07 to 10:05:00 is 293.', seconds(nowSecond, read('timer', ['attributes', 'finishes_at'])), value(293), { ...timer(), clock: clockAt('07') });
operand('countdown-remaining-text', 'The fan\'s text: 293 seconds is 04:53.', remaining('clock'), value('04:53'), { ...timer(), clock: clockAt('07') });
operand('countdown-remaining-text-next-second', 'One second later the same line says 04:52.', remaining('clock'), value('04:52'), { ...timer(), clock: clockAt('08') });
operand('countdown-remaining-text-at-zero', 'At the finish time: 00:00.', remaining('clock'), value('00:00'), { ...timer(), clock: { now: '2026-11-17T10:05:00', utcOffsetMinutes: 0 } });
operand('countdown-remaining-text-past-zero', 'After the finish time the clock never goes below 00:00.', remaining('clock'), value('00:00'), { ...timer(), clock: { now: '2026-11-17T10:05:09', utcOffsetMinutes: 0 } });
operand('countdown-remaining-minutes-seconds', 'The bed\'s text: 293 seconds is 4:53.', remaining('minutes-seconds'), value('4:53'), { ...timer(), clock: clockAt('07') });
operand('countdown-remaining-over-an-hour', 'A timer of an hour and a half: the fan draws hours from one hour.', fmt('{s}', { s: seconds(nowSecond, lit('2026-11-17T11:30:00')) }, { s: duration('clock') }), value('01:29:53'), { clock: clockAt('07') });
condition('countdown-before-finish', 'Now, to the second, before the finish: yes.', cmp('before', nowSecond, read('timer', ['attributes', 'finishes_at'])), 'yes', { ...timer(), clock: clockAt('07') });
condition('countdown-after-finish', 'Now, to the second, is not before a finish that has passed.', cmp('before', nowSecond, read('timer', ['attributes', 'finishes_at'])), 'no', { ...timer(), clock: { now: '2026-11-17T10:05:01', utcOffsetMinutes: 0 } });

// Duration format. Each case is a number of seconds (minutes where it says so) and the words production draws.
const dur = (name: string, note: string, style: string, number: number | string, expected: string | null, unit?: string) =>
  operand(`duration-format-${name}`, note, fmt('{n}', { n: lit(number) }, { n: duration(style, unit) }), expected === null ? UNAVAILABLE : value(expected));
dur('compact-seconds-zero', 'A compact duration of 0 has no text: the slot\'s fallback ("Off") draws (HumidifierController.formatSeconds).', 'compact', 0, null);
dur('compact-seconds-negative', 'Less than 0 has no text.', 'compact', -5, null);
dur('compact-seconds-one-second-is-a-minute', 'Seconds round up to whole minutes, at least 1: 1 second is 1m.', 'compact', 1, '1m');
dur('compact-seconds-sixty', '60 seconds is 1m.', 'compact', 60, '1m');
dur('compact-seconds-sixty-one-rounds-up', '61 seconds rounds up to 2m.', 'compact', 61, '2m');
dur('compact-seconds-an-hour', '3600 seconds is 1h.', 'compact', 3600, '1h');
dur('compact-seconds-an-hour-and-a-bit-rounds-up', '3601 seconds rounds up to 61 minutes: 1h 1m.', 'compact', 3601, '1h 1m');
dur('compact-seconds-ninety-minutes', '5400 seconds is 1h 30m.', 'compact', 5400, '1h 30m');
dur('compact-minutes-zero', 'Minutes: 0 has no text.', 'compact', 0, null, 'minutes');
dur('compact-minutes-rounds-down-to-nothing', '0.4 minutes rounds to 0: no text.', 'compact', 0.4, null, 'minutes');
dur('compact-minutes-half-rounds-away-from-zero', '0.5 minutes rounds to 1 (a tie goes away from zero).', 'compact', 0.5, '1m', 'minutes');
dur('compact-minutes-thirty', '30 minutes is 30m.', 'compact', 30, '30m', 'minutes');
dur('compact-minutes-fifty-nine', '59 minutes is 59m: the last before an hour.', 'compact', 59, '59m', 'minutes');
dur('compact-minutes-rounds-up-to-an-hour', '59.5 minutes rounds to 60: 1h.', 'compact', 59.5, '1h', 'minutes');
dur('compact-minutes-an-hour', '60 minutes is 1h.', 'compact', 60, '1h', 'minutes');
dur('compact-minutes-ninety', '90 minutes is 1h 30m.', 'compact', 90, '1h 30m', 'minutes');
dur('compact-minutes-negative', 'Less than 0 has no text.', 'compact', -3, null, 'minutes');
dur('compact-default-unit-is-seconds', 'A compact duration with no unit counts seconds: 90 is 2m.', 'compact', 90, '2m');
dur('clock-five-minutes', 'The fan\'s text: 300 seconds is 05:00.', 'clock', 300, '05:00');
dur('clock-an-hour', '3600 seconds is 01:00:00: hours only from one hour.', 'clock', 3600, '01:00:00');
dur('clock-just-under-a-minute', '59 seconds is 00:59.', 'clock', 59, '00:59');
dur('clock-just-under-an-hour', '3599 seconds is 59:59.', 'clock', 3599, '59:59');
dur('clock-zero', '0 is 00:00.', 'clock', 0, '00:00');
dur('clock-negative-is-zero', 'Never below 00:00.', 'clock', -10, '00:00');
dur('clock-fraction-rounds-down', '299.9 seconds is 04:59: whole seconds, rounded down.', 'clock', 299.9, '04:59');
dur('clock-hours-keep-their-digits', '100 hours draws all its digits: 100:00:00.', 'clock', 360000, '100:00:00');
dur('clock-hour-minute-second', '3661 seconds is 01:01:01.', 'clock', 3661, '01:01:01');
dur('clock-numeric-text-is-a-number', 'A numeric text is a number, as in every number format: "90" is 01:30.', 'clock', '90', '01:30');
dur('minutes-seconds-four-thirty', 'The bed\'s text: 270 seconds is 4:30.', 'minutes-seconds', 270, '4:30');
dur('minutes-seconds-zero', 'Zero seconds is 0:00.', 'minutes-seconds', 0, '0:00');
dur('minutes-seconds-minutes-are-unbounded', '4500 seconds is 75:00: there is no hours part.', 'minutes-seconds', 4500, '75:00');
dur('minutes-seconds-fraction-rounds-up', '269.1 seconds rounds up to 270: 4:30 (BedFormat.countdown rounds up).', 'minutes-seconds', 269.1, '4:30');
dur('minutes-seconds-negative-is-zero', 'Never below 0:00.', 'minutes-seconds', -3, '0:00');
dur('minutes-seconds-just-over-a-minute-rounds-up', '59.2 seconds rounds up to 60: 1:00.', 'minutes-seconds', 59.2, '1:00');
dur('span-an-hour', 'A chore due in 3600 seconds: 1 hour (TodoItem.dueLabel).', 'span', 3600, '1 hour');
dur('span-hours', '7200 seconds is 2 hours.', 'span', 7200, '2 hours');
dur('span-zero-is-one-hour', 'The amount is at least 1: 0 is 1 hour.', 'span', 0, '1 hour');
dur('span-half-hour-rounds-up', '1800 seconds is 0.5 hours: a tie goes away from zero, 1 hour.', 'span', 1800, '1 hour');
dur('span-an-hour-and-a-half-rounds-up', '5400 seconds is 1.5 hours: 2 hours.', 'span', 5400, '2 hours');
dur('span-just-under-a-day-is-24-hours', '86399 seconds rounds to 24 hours: the hours bucket ends at a whole day, not at 24 rounded hours.', 'span', 86399, '24 hours');
dur('span-a-day', '86400 seconds is 1 day: days begin at a day.', 'span', 86400, '1 day');
dur('span-a-day-and-a-bit', '1.4 days is 1 day.', 'span', 120960, '1 day');
dur('span-three-days', '259200 seconds is 3 days.', 'span', 259200, '3 days');
dur('span-twenty-days', '20 days is the last whole number of days: 20 days.', 'span', 1728000, '20 days');
dur('span-twenty-one-days-is-weeks', '21 days is where weeks begin: 3 weeks.', 'span', 1814400, '3 weeks');
dur('span-forty-five-days', '45 days is 6.4 weeks: 6 weeks.', 'span', 3888000, '6 weeks');
dur('span-fifty-nine-days', '59 days is 8.4 weeks: 8 weeks.', 'span', 5097600, '8 weeks');
dur('span-sixty-days-is-months', '60 days is where months begin: 2 months.', 'span', 5184000, '2 months');
dur('span-ninety-days', '90 days is 3 months of 30 days.', 'span', 7776000, '3 months');
dur('span-ignores-the-sign', 'A span is the size of the number: -7200 seconds is 2 hours (the sign is a rule\'s business).', 'span', -7200, '2 hours');
dur('span-numeric-text-is-a-number', 'A numeric text is a number: "86400" is 1 day.', 'span', '86400', '1 day');
dur('too-large-has-no-text', '1e13 seconds or more has no text (a number that large is not a duration).', 'clock', 1e13, null);
operand('duration-format-text-is-unavailable', 'Text that is not a number has no duration: the whole format is unavailable.', fmt('{n}', { n: lit('soon') }, { n: duration('clock') }), UNAVAILABLE);
operand('duration-format-null-is-unavailable', 'A null has no text.', fmt('{n}', { n: lit(null) }, { n: duration('clock') }), UNAVAILABLE);
operand('duration-format-in-a-sentence', 'The fan\'s line: "Off in 05:00".', fmt('Off in {n}', { n: lit(300) }, { n: duration('clock') }), value('Off in 05:00'));
operand('duration-format-due-in', 'A chore\'s line: "Due in 3 days".', fmt('Due in {n}', { n: lit(259200) }, { n: duration('span') }), value('Due in 3 days'));
operand('duration-format-loading', 'A number that is loading makes the line loading.', fmt('{n}', { n: read('timer', ['state'], 'number') }, { n: duration('clock') }), LOADING, reads({ 'timer/state': LOADING }));
text('duration-format-off-fallback', 'The humidifier\'s "Off": a compact duration of 0 has no text, so the slot\'s fallback draws.', { type: 'expr', value: fmt('{m}', { m: lit(0) }, { m: duration('compact', 'seconds') }), fallback: 'Off' }, value('Off'));
text('duration-format-compact-with-fallback-set', 'A compact duration with text ignores the fallback: 1800 seconds is 30m.', { type: 'expr', value: fmt('{m}', { m: lit(1800) }, { m: duration('compact', 'seconds') }), fallback: 'Off' }, value('30m'));

// Math truncate. Toward zero, by the place; the answer is a number, drawn by a number format.
const trunc = (name: string, note: string, args: J[], expected: J) => operand(`math-truncate-${name}`, note, math('truncate', ...args), expected);
trunc('positive-one-decimal', 'RoomOverview.truncatedOneDecimal: 71.99 to one place is 71.9, never 72.0.', [lit(71.99), lit(1)], value(71.9));
trunc('negative-one-decimal', 'Toward zero for a negative too: -71.99 is -71.9.', [lit(-71.99), lit(1)], value(-71.9));
trunc('tie-one-decimal', '71.25 to one place is 71.2: it cuts, it does not round.', [lit(71.25), lit(1)], value(71.2));
trunc('small-positive-is-zero', '0.04 to one place is 0.', [lit(0.04), lit(1)], value(0));
trunc('small-negative-is-zero-not-negative-zero', '-0.04 to one place is 0, not -0 (the authored draws "0.0").', [lit(-0.04), lit(1)], value(0));
trunc('whole-without-places', 'One argument truncates to a whole number: 2.9 is 2.', [lit(2.9)], value(2));
trunc('whole-negative-without-places', '-2.9 is -2.', [lit(-2.9)], value(-2));
trunc('tie-whole', '2.5 is 2 and -2.5 is -2: it cuts.', [lit(-2.5)], value(-2));
trunc('places-zero', 'Zero places is the same as none.', [lit(2.9), lit(0)], value(2));
trunc('two-places', '1.2399 to two places is 1.23.', [lit(1.2399), lit(2)], value(1.23));
trunc('six-places', 'Six places is the most: 0.1234567 is 0.123456.', [lit(0.1234567), lit(6)], value(0.123456));
trunc('seven-places-is-unavailable', 'More than six places is refused, as for round.', [lit(1.5), lit(7)], UNAVAILABLE);
trunc('negative-places-is-unavailable', 'Places are 0 or more.', [lit(1.5), lit(-1)], UNAVAILABLE);
trunc('fractional-places-is-unavailable', 'Places are whole.', [lit(1.5), lit(1.5)], UNAVAILABLE);
trunc('binary-fraction-cuts-the-double', '0.57 to two places is 0.56: 0.57 * 100 is 56.99999999999999 in doubles, which both sides cut (the shipped helper is the same arithmetic).', [lit(0.57), lit(2)], value(0.56));
trunc('text-is-unavailable', 'A text that is not a number is unavailable.', [lit('hot'), lit(1)], UNAVAILABLE);
trunc('loading', 'A number that is loading makes the result loading.', [read('temp', ['state'], 'number'), lit(1)], LOADING);
neEvaluations[neEvaluations.length - 1].env = reads({ 'temp/state': LOADING });
operand('math-truncate-read-and-draw', 'The room overview\'s line: a state of "71.99" truncated to one place and drawn with its zero is 71.9; 72 is 72.0.', fmt('{t}°', { t: math('truncate', read('temp', ['state'], 'number'), lit(1)) }, { t: digits(1, 1) }), value('72.0°'), reads({ 'temp/state': value('72') }));
operand('math-truncate-read-and-draw-below', 'The same line for 71.99 is 71.9°.', fmt('{t}°', { t: math('truncate', read('temp', ['state'], 'number'), lit(1)) }, { t: digits(1, 1) }), value('71.9°'), reads({ 'temp/state': value('71.99') }));
