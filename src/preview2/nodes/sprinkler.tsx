import { BatteryFull, CalendarClock, ChevronRight, History, Minus, Plus, Radio, Square, TriangleAlert } from 'lucide-react';
import { useRender } from '../render-context';
import { Switch, UseButton, unavailableText, useDevice, useSharedPreview, type Device } from './device-shared';
import { Glyph, Pressable, type NodeOf } from './shared';

const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const presets = [5, 10, 15, 20, 30];
const words = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const lineOf = (device: Device) => device.phase === 'loading' ? 'Loading' : device.phase === 'unavailable' ? unavailableText
  : `${device.flag('watering') ? 'Watering' : words(device.text('mode') ?? 'Auto')}${device.text('next') ? ` · Next ${device.text('next')}` : ''}`;

/** `sprinkler-control`: the sprinkler card, status grid and the water and schedule pages' controls. */
export function SprinklerControlNode({ node }: { node: NodeOf<'sprinkler-control'> }) {
  const { props } = node;
  const device = useDevice(props.sourceId);
  const { run } = useRender();
  const zone = 'zone' in props ? props.zone : 0;
  const [local, setLocal] = useSharedPreview<Record<string, number | boolean | number[]>>(`${props.sourceId}:${zone}`, {});
  const num = (key: string, fallback: number) => typeof local[key] === 'number' ? local[key] as number : fallback;
  const flag = (key: string, fallback: boolean) => typeof local[key] === 'boolean' ? local[key] as boolean : fallback;
  const put = (key: string, value: number | boolean | number[]) => setLocal({ ...local, [key]: value });
  const off = device.phase !== 'ready';
  const row = (children: React.ReactNode, className = '') => <div className={`sh-row sh-dv-row ${className}`.trim()} data-state={off ? 'unavailable' : undefined}>{children}</div>;
  const action = (tone: 'prominent' | 'accent' | 'danger', icon?: string) => <div className="sh-row sh-dv-row sh-dv-center"><UseButton className={`sh-dv-button sh-dv-${tone}`} onPress={() => undefined} disabled={off}>
    {icon && <Glyph symbol={{ name: icon }} size={18}/>}{node.title}</UseButton></div>;

  switch (props.kind) {
    case 'card': {
      const watering = device.flag('watering');
      return <div className={`sh-dv-card-tile ${watering ? 'sh-dv-lit' : ''}`.trim()} data-state={off ? 'unavailable' : undefined}>
        <Pressable action={props.action} className="sh-dv-card-face"><span className="sh-dv-card-glyph"><Glyph symbol={{ name: 'sprinkler.and.droplets' }} size={22}/></span>
          <span className="sh-row-copy"><strong>{node.title}</strong><span>{lineOf(device)}</span></span></Pressable>
        <UseButton className="sh-dv-disc" label={`Stop ${node.title}`} onPress={() => undefined} disabled={!watering}><Square size={14} fill="currentColor"/></UseButton>
        <UseButton className="sh-dv-chev" label={`Open ${node.title}`} onPress={() => run(props.action)}><ChevronRight size={16}/></UseButton></div>;
    }
    case 'status': {
      const battery = device.number('batteryPercent'), hub = device.get('hubConnected');
      const cell = (icon: React.ReactNode, label: string, value: string | undefined, tone?: string) => <div className="sh-dv-stat" data-tone={tone}><span>{icon}{label}</span><strong>{value ?? unavailableText}</strong></div>;
      return <div className="sh-dv-stats" role="group" aria-label={node.title}>
        {cell(<BatteryFull size={14}/>, 'Battery', battery === undefined ? undefined : `${Math.round(battery)}%`, device.flag('batteryLow') ? 'warn' : undefined)}
        {cell(<CalendarClock size={14}/>, 'Next Watering', device.text('next'))}
        {cell(<History size={14}/>, 'Last Watering', device.text('last'))}
        {cell(<Radio size={14}/>, 'Hub', hub === undefined ? undefined : hub ? 'Connected' : 'Disconnected', hub === true ? 'ok' : hub === false ? 'warn' : undefined)}</div>;
    }
    case 'zone': case 'program': return <Pressable action={props.action} className="sh-row sh-dv-row sh-pressable"><span className="sh-row-primary">{node.title}</span><ChevronRight size={16} aria-hidden="true"/></Pressable>;
    case 'rain-delay': return row(<><span className="sh-row-primary">{node.title}</span><Switch on={flag('rain', device.flag('rainDelay'))} label={node.title} onChange={next => put('rain', next)} disabled={off}/></>);
    case 'smart-watering': return row(<><span className="sh-row-primary">{node.title}</span><Switch on={flag('smart', device.flag('smart'))} label={node.title} onChange={next => put('smart', next)} disabled={off}/></>);
    case 'program-enabled': {
      const live = device.get<{ program: string | null }[]>('zones')?.[zone]?.program === 'on';
      return row(<><span className="sh-row-primary">{node.title}</span><Switch on={flag('enabled', live)} label={node.title} onChange={next => put('enabled', next)} disabled={off}/></>);
    }
    case 'duration': {
      const minutes = num('minutes', 10);
      return row(<><span className="sh-row-primary">{node.title}</span><span className="sh-stepper"><UseButton className="sh-dv-step" label={`Decrease ${node.title}`} onPress={() => put('minutes', Math.max(1, minutes - 1))}><Minus size={16}/></UseButton>
        <output>{minutes} min</output><UseButton className="sh-dv-step" label={`Increase ${node.title}`} onPress={() => put('minutes', Math.min(120, minutes + 1))}><Plus size={16}/></UseButton></span></>);
    }
    case 'presets': return <div className="sh-dv-card" data-state={off ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span>
      <span className="sh-segments" role="radiogroup" aria-label={node.title}>{presets.map(minutes => <button key={minutes} type="button" role="radio" aria-checked={num('minutes', 10) === minutes} onClick={() => put('minutes', minutes)}>{minutes}</button>)}</span></div>;
    case 'days': {
      const chosen = (local.days as number[] | undefined) ?? [0, 1, 2, 3, 4, 5, 6];
      return <div className="sh-dv-card" data-state={off ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span>
        <span className="sh-dv-days" role="group" aria-label={node.title}>{weekdays.map((letter, day) => <UseButton key={day} className="sh-dv-day" label={weekdayNames[day]}
          onPress={() => put('days', chosen.includes(day) ? chosen.filter(item => item !== day) : [...chosen, day])}><span data-on={chosen.includes(day) ? '' : undefined}>{letter}</span></UseButton>)}</span></div>;
    }
    case 'times': return row(<><span className="sh-row-primary">{node.title}</span><span className="sh-row-value">6:00 AM</span></>);
    case 'budget': {
      const percent = num('budget', 100);
      return <div className="sh-row sh-dv-row sh-dv-stack" data-state={off ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span><span className="sh-row-value">{percent}%</span>
        <input type="range" aria-label={node.title} className="sh-slider sh-dv-wide" min={0} max={200} step={10} value={percent} onChange={event => put('budget', Number(event.currentTarget.value))}/></div>;
    }
    case 'start': case 'start-program': case 'apply': return action('prominent');
    case 'stop': return action('danger', 'stop.fill');
    case 'reload': return action('accent', 'arrow.clockwise');
    case 'water-blocker': {
      const reason = device.flag('fault') ? 'a controller fault' : device.flag('rainDelay') ? 'a rain delay' : undefined;
      return <div className={`sh-info ${reason ? 'sh-tone-warning' : ''}`.trim()} role="note" data-state={off ? 'unavailable' : undefined}>
        {reason ? <><TriangleAlert size={16} aria-hidden="true"/> {node.title} is blocked by {reason}.</> : off ? unavailableText : `${node.title} is allowed.`}</div>;
    }
  }
}
