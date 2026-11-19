import { Field, TextField } from '../../ui';
import { SegmentRow } from '../SegmentRow';
import { SelectMenu } from '../SelectMenu';
import { Tag } from '../kit';
import type { SimulationClock } from '../../shared/composition/graph/types';
import { editClock, localTime, type ValuePresentation } from './presentation';

export type PinChoice = 'live' | 'scenario' | 'number' | 'state' | 'typed';
export function SourceInspector({ name, presentation, choice, onChoice, live, scenario, numeric, onNumeric, state, onState, typed, onTyped, status, onStatus, onApply, source }: {
  name: string; presentation: ValuePresentation; choice: PinChoice; onChoice: (choice: PinChoice) => void;
  live: string; scenario?: { name: string; value: string }; numeric: string; onNumeric: (value: string) => void;
  state: string; onState: (value: string) => void; typed: string; onTyped: (value: string) => void;
  status: string; onStatus: (value: string) => void; onApply: () => void; source: boolean;
}) {
  const radio = (value: PinChoice, label: string, secondary: string, disabled = false) => <label className="w2-sim-radio">
    <input type="radio" name={`source-${name}`} value={value} checked={choice === value} onChange={() => onChoice(value)} disabled={disabled} />
    <span><span>{label}</span><small>{secondary}</small></span>
  </label>;
  const range = presentation.range ?? { min: 0, max: 40, step: 0.1 };
  return <section className="sec w2-group w2-sim-source" aria-label="Where its value comes from">
    <h3 className="w2-group-title">Where its value comes from</h3>
    <div role="radiogroup" aria-label={`Source for ${name}`}>
      {radio('live', 'Live from Home Assistant', live)}
      {radio('scenario', `From the scenario ${scenario ? `“${scenario.name}”` : ''}`, scenario?.value ?? 'Choose a scenario first', !scenario)}
      {source && <div>
        {radio('number', 'Pin a number', `${Number(numeric || 0).toFixed(1)}${presentation.unit ? ` ${presentation.unit}` : ''}`)}
        <div className="w2-sim-pin-control">
          <input className="w2-sim-slider" type="range" aria-label={`Pin ${name} number`} {...range} value={Number(numeric || 0)} onChange={event => { onChoice('number'); onNumeric(event.target.value); }} />
          {choice === 'number' && <TextField label={`Number for ${name}`} type="number" step={range.step} value={numeric} onChange={onNumeric} />}
        </div>
      </div>}
      {source && radio('state', 'Pin a state', 'Unavailable, Unknown, or any text')}
      {source && choice === 'state' && <div className="w2-sim-pin-control"><TextField label={`State for ${name}`} value={state} onChange={onState} /></div>}
      {!source && radio('typed', 'Pin a typed value', 'Override this output, without inventing its inputs')}
      {choice === 'typed' && <div className="w2-sim-pin-control">
        <Field label="Pin status"><SelectMenu label="Pin status" value={status} options={[{ value: 'value', label: 'Value' }, { value: 'loading', label: 'Loading' }, { value: 'unavailable', label: 'Unavailable' }]} onChange={onStatus} popupClassName="w2-simulation-surface" /></Field>
        <TextField label="Typed value (JSON)" value={typed} onChange={onTyped} />
      </div>}
      <label className="w2-sim-radio w2-sim-later"><input type="radio" disabled name={`source-${name}`} />
        <span><span>Replay from history</span><small>History replay is not available yet</small></span><Tag>Later</Tag>
      </label>
    </div>
    {['number', 'state', 'typed'].includes(choice) && <button type="button" className="w2-sim-apply w2-primary" onClick={onApply}>Apply pin</button>}
    <p className="w2-caption">Pins and scenarios stay in the Studio. They are never published.</p>
  </section>;
}
export function ClockInspector({ live, clock, zone, timeZone, onClock, onError }: {
  live: SimulationClock; clock?: SimulationClock; zone: string; timeZone?: string; onClock: (clock: SimulationClock | undefined) => void; onError: (message: string) => void;
}) {
  const current = clock ?? live;
  const change = (date: string, time: string) => {
    const clock = editClock(current, date, time, timeZone);
    if (!clock) { onError('Choose a valid date and time in the flow’s time zone. Daylight-saving gaps cannot be pinned.'); return; }
    onClock(clock);
  };
  const hours = Number(current.now.slice(11, 13)), minutes = Number(current.now.slice(14, 16));
  return <section className="sec w2-group w2-sim-clock" aria-label="Clock simulation">
    <h3 className="w2-group-title">Clock</h3>
    <SegmentRow label="Source" value={clock ? 'pinned' : 'live'} choices={[{ value: 'live', label: 'Live' }, { value: 'pinned', label: 'Pinned', ...(!timeZone ? { unavailable: 'Supply the home time zone in the host.' } : {}) }]} onPick={value => onClock(value === 'live' ? undefined : { ...live })} />
    <div className="kv2 w2-sim-time"><Field label="Time"><input aria-label="Pinned time" disabled={!timeZone} type="time" value={current.now.slice(11, 16)} onChange={event => change(current.now.slice(0, 10), event.target.value)} /><span className="w2-sim-live-time">live {localTime(live.now)}</span></Field></div>
    <input className="w2-sim-slider" disabled={!timeZone} type="range" min="0" max="1439" step="1" aria-label="Time of day" value={hours * 60 + minutes} onChange={event => {
      const minutes = Number(event.target.value);
      change(current.now.slice(0, 10), `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    }} />
    <div className="w2-sim-clock-ticks" aria-hidden><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
    <div className="w2-row"><TextField label="Date" type="date" disabled={!timeZone} value={current.now.slice(0, 10)} onChange={date => change(date, current.now.slice(11, 16))} /></div>
    <p className="w2-caption">{timeZone ? `Uses the flow’s ${zone} time zone (${timeZone}).` : 'The host must supply the home time zone before editing this clock.'}</p>
  </section>;
}
