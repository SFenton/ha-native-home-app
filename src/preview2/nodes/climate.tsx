import { Check, ChevronRight, ChevronsUpDown, Circle, CircleCheck } from 'lucide-react';
import type { ClimateProps } from '../../shared/composition/climate';
import { Switch, UseButton, useDevice, usePreviewValue, useSimulate, type Device } from './device-shared';
import { PullDownMenu } from './PullDownMenu';
import { Glyph, Pressable, type NodeOf } from './shared';

type Props = ClimateProps;
type Status = Extract<Props, { status: unknown }>['status'];
/** Tile fills for `room-tile`, by palette index (the Rooms grid's colours). */
const palette = ['#8A6D3F', '#00849B', '#4E7A14', '#0D8A57', '#9C5B45', '#B05A00', '#3F7C70', '#6A4C93', '#9A3E5C', '#3B6EA5', '#7A7A2E'];
const temp = (value: number | undefined, unit: string) => value === undefined ? undefined : `${Math.round(value * 10) / 10}${unit}`;
const words = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

/** The text a `status` shows: the matching state text, else a simple reading, else the fallback. */
function statusText(status: NonNullable<Status>, device: Device, props: Props): string {
  const unit = status.unit;
  const map = (state: string | undefined) => state === undefined ? undefined : status.states.find(item => item.state === state)?.text ?? words(state);
  if (device.phase === 'loading') return props.loadingText;
  if (device.phase === 'unavailable') return props.unavailableText;
  switch (status.projection) {
    case 'state': return map(device.text('state')) ?? status.fallbackText;
    case 'predictive': return map(device.text('state')) ?? status.fallbackText;
    case 'action': return map(device.text('hvacAction')) ?? status.fallbackText;
    case 'temperature': case 'indoor': return temp(device.number('current') ?? device.number('target'), unit) ?? status.fallbackText;
    case 'comfortLow': return temp(device.number('low'), unit) ?? status.fallbackText;
    case 'comfortHigh': return temp(device.number('high'), unit) ?? status.fallbackText;
    default: return status.fallbackText;
  }
}

/** `climate-control`: the thermostat dial, switches, mode pickers, status lines, notices and room tiles. */
export function ClimateControlNode({ node }: { node: NodeOf<'climate-control'> }) {
  const { props } = node;
  const device = useDevice(props.sourceId);
  const send = useSimulate();
  const entityId = device.text('entityId');
  const unavailable = device.phase === 'unavailable' ? props.unavailableText : device.phase === 'loading' ? props.loadingText : undefined;
  const hint = props.hint ? <span className="sh-row-secondary">{props.hint}</span> : null;
  const on = device.flag('isOn');
  const [choice, setChoice] = usePreviewValue<string | undefined>(undefined);
  const [fanChoice, setFanChoice] = usePreviewValue<string | undefined>(undefined);

  switch (props.kind) {
    case 'dial': return <Dial node={node} props={props} device={device}/>;
    case 'toggle': case 'explicit-switch': {
      const line = props.kind === 'explicit-switch' && props.status ? statusText(props.status, device, props) : unavailable;
      return <div className="sh-row sh-dv-row" data-state={unavailable ? 'unavailable' : undefined}><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>{(line || hint) && <span className="sh-row-secondary">{line ?? props.hint}</span>}</span>
        <Switch on={on} label={node.title} disabled={!!unavailable} onChange={next => send(entityId, next ? 'turn_on' : 'turn_off')}/></div>;
    }
    case 'check': return <UseButton className="sh-row sh-dv-row sh-pressable" onPress={() => send(entityId, 'toggle')}>
      <span className="sh-row-primary">{node.title}</span>{on ? <CircleCheck className="sh-dv-check" size={24} aria-label="On"/> : <Circle className="sh-dv-off" size={24} aria-label="Off"/>}</UseButton>;
    case 'mode': case 'fan': case 'preset': {
      const live = props.kind === 'mode' ? device.text('state') : props.kind === 'fan' ? device.text('fan') : device.text('preset');
      const current = props.choices.find(item => item.value === (choice ?? live));
      // The app draws a row: the title, and the current choice as a menu (`UKHubPicker` in a `UKRowView`), not a heading over buttons.
      return <div className="sh-row sh-dv-row" data-state={unavailable ? 'unavailable' : undefined} title={props.hint || undefined}><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>{unavailable && <span className="sh-row-secondary">{unavailable}</span>}</span>
        <PullDownMenu title={node.title} className="sh-dv-pulldown" disabled={Boolean(unavailable) || props.choices.length === 0} selected={current?.value} options={props.choices.map(item => ({ value: item.value, label: item.label }))}
          onSelect={next => { setChoice(next); if (props.kind === 'mode') send(entityId, 'set_hvac_mode', { hvac_mode: next }); }}>
          <span className="sh-row-value">{current?.label ?? '–'}</span><ChevronsUpDown size={14} aria-hidden="true"/></PullDownMenu></div>;
    }
    case 'options': {
      const current = choice ?? device.text('state');
      // The app draws only the choices; the node's title is the row of the fallback that stands in when there are none to offer (`UKServerUIClimateControl`).
      if (unavailable || props.choices.length === 0) return <div className="sh-row sh-dv-row" data-state="unavailable"><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>
        <span className="sh-row-secondary">{unavailable ?? props.unavailableText}</span></span></div>;
      return <div className="sh-dv-card"><div className="sh-dv-options" role="radiogroup" aria-label={node.title}>{props.choices.map(item => <UseButton key={item.value} className="sh-dv-option" onPress={() => setChoice(item.value)}>
          <span className="sh-row-copy"><span className="sh-row-primary">{item.label}</span>{item.detail && <span className="sh-row-secondary">{item.detail}</span>}</span>{current === item.value && <Check size={18} className="sh-dv-check" aria-label="Selected"/>}</UseButton>)}</div></div>;
    }
    case 'hub': {
      const mode = props.hub.modes.find(item => item.value === (choice ?? device.text('state'))), fan = props.hub.fans.find(item => item.value === (fanChoice ?? device.text('fan')));
      // The menu's label is its VoiceOver name (`UKHubPicker.accessibilityLabel`); the face is the option's glyph, the value and the chevron.
      const menu = (kind: 'mode' | 'fan', label: string, current: { value: string; label: string; icon?: string } | undefined, options: readonly { value: string; label: string }[]) =>
        <PullDownMenu title={label} className="sh-dv-menu" disabled={Boolean(unavailable) || options.length === 0} selected={current?.value} options={options}
          onSelect={next => { (kind === 'mode' ? setChoice : setFanChoice)(next); if (kind === 'mode') send(entityId, 'set_hvac_mode', { hvac_mode: next }); else send(entityId, 'set_fan_mode', { fan_mode: next }); }}>
          {current?.icon && <Glyph symbol={{ name: current.icon }} size={18}/>}<span className="sh-dv-menu-value">{current?.label ?? '–'}</span><ChevronsUpDown size={12} aria-hidden="true"/></PullDownMenu>;
      return <div className="sh-dv-hub" data-state={unavailable ? 'unavailable' : undefined}><span className="sh-row-glyph"><Glyph symbol={{ name: props.icon }} size={20}/></span>
        <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{unavailable ?? [mode?.label, fan?.label].filter(Boolean).join(' · ')}</span></span>
        <span className="sh-dv-menus">{menu('mode', props.hub.modeLabel, mode, props.hub.modes)}{props.hub.fans.length > 0 && menu('fan', props.hub.fanLabel, fan, props.hub.fans)}</span></div>;
    }
    case 'notice': {
      const n = props.notice, mode = (device.text('homeMode') ?? '').toLowerCase();
      const text = unavailable ? n.unavailableModeText : mode.includes('vacation') ? n.vacationText : mode.includes('away') || mode.includes('eco') ? n.awayText : n.unknownText;
      return <div className={`sh-info ${n.isWarning ? 'sh-tone-warning' : ''}`.trim()} role="note" data-state={unavailable ? 'unavailable' : undefined}>{text}</div>;
    }
    case 'status': {
      const text = props.status ? statusText(props.status, device, props) : unavailable ?? '';
      switch (props.presentation) {
        case 'headline': return <p className="sh-text sh-text-headline sh-dv-headline">{text}</p>;
        case 'paragraphs': return <div className="sh-dv-paragraphs">{text.split(/\n+/).map((line, index) => <p key={index} className="sh-text">{line}</p>)}</div>;
        default: return <div className="sh-row sh-dv-row"><span className="sh-row-primary">{node.title}</span><span className="sh-row-value" data-state={unavailable ? 'unavailable' : undefined}>{text}</span></div>;
      }
    }
    case 'link': return <Pressable action={node.action} className="sh-row sh-dv-row sh-pressable"><span className="sh-row-glyph"><Glyph symbol={{ name: props.icon }} size={20}/></span>
      <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{statusText(props.status, device, props)}</span></span><ChevronRight size={16} aria-hidden="true"/></Pressable>;
    case 'room-tile': {
      const unit = device.text('unit') ?? '°F', reading = device.number('sensor'), occupied = ['on', 'occupied', 'detected'].includes(device.text('occupancy') ?? '');
      const line = unavailable ?? temp(reading, unit) ?? props.unavailableText, second = device.text('occupancy') === undefined ? undefined : occupied ? 'Occupied' : 'Inactive';
      return <Pressable action={node.action} className={`sh-tile ${occupied ? 'sh-lit' : ''} ${node.action ? 'sh-pressable' : ''}`.trim()}
        style={{ '--fill': palette[(props.paletteIndex ?? 0) % palette.length], '--glyph': '#fff' } as React.CSSProperties}>
        <span className="sh-tile-glyph"><Glyph symbol={{ name: props.icon }} size={24}/></span><span className="sh-tile-title">{node.title}</span>
        <span className="sh-tile-line">{line}</span>{second && <span className="sh-tile-line">{second}</span>}{node.action && <ChevronRight className="sh-tile-chevron" size={16} aria-hidden="true"/>}</Pressable>;
    }
  }
}

/**
 * The thermostat dial as the app draws it (`UKThermostatDial`): no card, it sits on the ground of the page or sheet; a 270 degree track, heat and cool
 * trails, the reading in the middle, a marker at the current temperature and a white knob for each set point, ringed in its colour (heat for the low
 * point, cool for the high one, the status colour for a single target). The app moves a handle by dragging it, which the preview cannot do, so it draws
 * the handles and has no step buttons: a nudge control would be the Studio's invention.
 */
function Dial({ node, props, device }: { node: NodeOf<'climate-control'>; props: Extract<Props, { kind: 'dial' }>; device: Device }) {
  const { minimum, maximum, unit, size } = props.dial;
  // Geometry in the app's 320 point square (`ThermostatDialGeometry`): ring radius 145, ring width 24, knob 24 with a 4 point rim, marker 18 with a 3 point rim.
  const px = size === 'compact' ? 200 : size === 'modal' ? 260 : 300, c = px / 2, unitPx = px / 320, r = 145 * unitPx, ring = 24 * unitPx;
  const low = device.number('low'), high = device.number('high'), target = device.number('target');
  const range = low !== undefined && high !== undefined;
  const fraction = (value: number) => Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const at = (f: number) => { const angle = (135 + 270 * f) * Math.PI / 180; return [c + r * Math.cos(angle), c + r * Math.sin(angle)] as const; };
  const arc = (from: number, to: number) => { const [x1, y1] = at(from), [x2, y2] = at(to); return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${(to - from) * 270 > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const action = (device.text('hvacAction') ?? '').toLowerCase(), mode = device.text('state');
  const heat = action === 'heating' || (!action && mode === 'heat'), shown = range ? (high! + low!) / 2 : target;
  const reading = device.number('current') ?? shown;
  const label = device.phase === 'unavailable' ? props.unavailableText : device.phase === 'loading' ? props.loadingText : action ? words(action) : mode ? words(mode) : '';
  const trail = (value: number | undefined, heatTrail: boolean) => value === undefined ? null : <path d={heatTrail ? arc(0, fraction(value)) : arc(fraction(value), 1)} className={heatTrail ? 'sh-dv-heat' : 'sh-dv-cool'} fill="none" strokeWidth={ring} strokeLinecap="round"/>;
  const handle = (value: number | undefined, kind: 'low' | 'high' | 'target') => {
    if (value === undefined) return null;
    const [x, y] = at(fraction(value));
    return <circle cx={x} cy={y} r={10 * unitPx} strokeWidth={4 * unitPx} className="sh-dv-handle" data-handle={kind} data-status={kind === 'target' ? heat ? 'heat' : 'idle' : undefined}/>;
  };
  const [mx, my] = reading === undefined ? [0, 0] : at(fraction(reading));
  return <div className={`sh-dv-dial sh-dv-dial-${size}`} role="group" aria-label={node.title} data-state={device.phase === 'ready' ? undefined : device.phase} style={{ '--dial-px': `${px}px` } as React.CSSProperties}>
    <svg viewBox={`0 0 ${px} ${px}`} width={px} height={px} aria-hidden="true">
      <path d={arc(0, 1)} className="sh-dv-track" fill="none" strokeWidth={ring} strokeLinecap="round"/>
      {range ? <>{trail(low, true)}{trail(high, false)}</> : shown === undefined ? null : trail(shown, heat)}
      {reading !== undefined && device.phase === 'ready' && <circle cx={mx} cy={my} r={7.5 * unitPx} strokeWidth={3 * unitPx} className="sh-dv-marker" data-status={heat ? 'heat' : 'idle'}/>}
      {range ? <>{handle(low, 'low')}{handle(high, 'high')}</> : handle(shown, 'target')}
    </svg>
    <div className="sh-dv-dial-face"><small>{label}</small><strong>{reading !== undefined ? Math.round(reading) : '–'}<sup>{unit}</sup></strong>
      {(range || shown !== undefined) && <span>{range ? `${low!.toFixed(1)} · ${high!.toFixed(1)}` : `Set to ${temp(shown, unit)}`}</span>}</div>
  </div>;
}
