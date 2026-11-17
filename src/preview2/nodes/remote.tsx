import { ChevronRight, Pause, Play, Power, SkipBack, SkipForward } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useRender } from '../render-context';
import { Switch, UseButton, useDevice, usePreviewValue, type Device } from './device-shared';
import { Glyph, type NodeOf } from './shared';

type Remote = NodeOf<'remote-control'>['props'];
type Key = Extract<Remote, { kind: 'keys' }>['keys'][number];
type Entry = { title: string; key: string | null; state: string | null; text: string | null; active: boolean };
const slotGlyphs = { power: Power, previous: SkipBack, next: SkipForward, play: Play, pause: Pause };

/** A round key: the document's glyph, turned by its rotation. */
function KeyButton({ item, lit }: { item: Key; lit?: boolean }) {
  return <UseButton className={`sh-dv-key ${lit ? 'sh-dv-key-on' : ''}`.trim()} label={item.label} onPress={() => undefined}>
    {item.icon.type === 'sf-symbol' ? <span style={{ display: 'inline-flex', transform: `rotate(${item.rotation}deg)` }}><Glyph symbol={{ name: item.icon.name }} size={22}/></span> : null}</UseButton>;
}
const entryFor = (device: Device, list: 'devices' | 'cards', key: string, title: string): Entry | undefined =>
  device.get<Entry[]>(list)?.find(item => list === 'cards' ? item.key === key : item.title === key || item.title === title);

/** `remote-control`: keys, volume, keyboard, app and device tiles, light-sync controls and the media card. */
export function RemoteControlNode({ node }: { node: NodeOf<'remote-control'> }) {
  const { props } = node;
  const device = useDevice(node.binding.sourceId);
  const { run } = useRender();
  const [level, setLevel] = usePreviewValue<number | undefined>(undefined);
  const [text, setText] = usePreviewValue('');
  const [choice, setChoice] = usePreviewValue<string | undefined>(undefined);
  const [power, setPower] = usePreviewValue<boolean | undefined>(undefined);
  const off = device.phase !== 'ready';
  const on = device.flag('isOn');
  const hue = device.get<{ power: string | null; sync: string | null; mode: string | null; intensity: string | null; brightness: number | null; input: string | null; connected: (string | null)[] }>('hue');
  const row = (children: React.ReactNode, className = '') => <div className={`sh-row sh-dv-row ${className}`.trim()} data-state={off ? 'unavailable' : undefined}>{children}</div>;

  switch (props.kind) {
    case 'keys': {
      const grid = props.layout === 'pad';
      return <div className={`sh-dv-keys ${grid ? 'sh-dv-pad' : 'sh-dv-transport'}`} role="group" aria-label={props.label || node.title} data-state={off ? 'unavailable' : undefined}>
        {grid ? Array.from({ length: 9 }, (_, position) => { const item = props.keys.find(key => key.position === position); return item ? <KeyButton key={position} item={item} lit={item.slot === 'power' && (power ?? on)}/> : <span key={position}/>; })
          : [...props.keys].sort((a, b) => a.position - b.position).map(item => <KeyButton key={item.position} item={item}/>)}</div>;
    }
    case 'volume': {
      const volume = level ?? device.number('volume'), percent = volume === undefined ? undefined : Math.round(volume * 100), [mute, down, up] = props.keys;
      return <div className="sh-dv-volume" data-state={off ? 'unavailable' : undefined}><div className="sh-dv-volume-head"><strong>{node.title}</strong><span className="sh-row-value">{off ? props.unavailableText : `${percent ?? 0}%`}</span>
        <UseButton className="sh-dv-bare" label={mute?.label ?? 'Mute'} onPress={() => undefined}>{mute && <Glyph symbol={{ name: mute.icon.type === 'sf-symbol' ? mute.icon.name : 'speaker.slash.fill' }} size={18}/>}</UseButton></div>
        <div className="sh-dv-volume-slider"><UseButton className="sh-dv-bare" label={down?.label ?? 'Volume down'} onPress={() => setLevel(Math.max(0, (volume ?? 0) - .05))}>{down && <Glyph symbol={{ name: down.icon.type === 'sf-symbol' ? down.icon.name : 'speaker.minus.fill' }} size={16}/>}</UseButton>
          <input type="range" className="sh-slider" aria-label={node.title} min={0} max={100} value={percent ?? 0} onChange={event => setLevel(Number(event.currentTarget.value) / 100)}/>
          <UseButton className="sh-dv-bare" label={up?.label ?? 'Volume up'} onPress={() => setLevel(Math.min(1, (volume ?? 0) + .05))}>{up && <Glyph symbol={{ name: up.icon.type === 'sf-symbol' ? up.icon.name : 'speaker.plus.fill' }} size={16}/>}</UseButton></div></div>;
    }
    case 'keyboard': return <div className="sh-dv-card" data-state={off ? 'unavailable' : undefined}><span className="sh-row-primary">{props.label}</span>
      <input className="sh-field sh-dv-wide" aria-label={props.label} placeholder={props.placeholder} value={text} onChange={event => setText(event.currentTarget.value)}/>
      <div className="sh-dv-editor-actions"><UseButton className="sh-dv-button sh-dv-accent" onPress={() => setText('')}>{props.cancelLabel}</UseButton><UseButton className="sh-dv-button sh-dv-prominent" onPress={() => setText('')} disabled={!text}>{props.sendLabel}</UseButton></div></div>;
    case 'app': {
      const active = device.get<{ title: string; active: boolean }[]>('apps')?.find(app => app.title === props.key)?.active === true;
      return <UseButton className={`sh-tile sh-dv-app ${active ? 'sh-lit' : ''}`.trim()} onPress={() => undefined} style={{ '--fill': '#1f4f8f' } as CSSProperties}>
        <span className="sh-tile-glyph" style={props.whiteBackground ? { background: '#fff', borderRadius: 8, padding: 4, color: '#000' } : undefined}><Glyph symbol={props.icon} size={24}/></span>
        <span className="sh-tile-title">{node.title}</span><span className="sh-tile-line">{active ? props.activeText : ''}</span></UseButton>;
    }
    case 'device': {
      const entry = entryFor(device, 'devices', props.key, node.title) ?? entryFor(device, 'cards', props.key, node.title);
      const label = props.states.find(option => option.value === entry?.state)?.label ?? entry?.text ?? (entry?.state ? props.fallbackText : undefined);
      const line = off ? props.unavailableText : label ?? props.fallbackText, lit = entry?.active === true;
      if (props.presentation === 'row') return row(<><span className="sh-row-glyph"><Glyph symbol={props.icon} size={20}/></span><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{line}</span></span></>);
      return <div className={`sh-tile ${lit ? 'sh-lit' : ''}`.trim()} style={lit ? { '--fill': props.family === 'power' ? '#2A732E' : '#1f4f8f' } as CSSProperties : undefined} role="group" aria-label={node.title}>
        <span className="sh-tile-glyph"><Glyph symbol={props.icon} size={24}/></span><span className="sh-tile-title">{node.title}</span><span className="sh-tile-line">{line}</span></div>;
    }
    case 'hue-toggle': return row(<><span className="sh-row-glyph"><Glyph symbol={props.icon} size={20}/></span><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>
      <span className="sh-row-secondary">{off || !hue ? props.unavailableText : (power ?? hue[props.target === 'power' ? 'power' : 'sync'] === 'on') ? props.onText : props.offText}</span></span>
      <Switch on={power ?? (hue?.[props.target === 'power' ? 'power' : 'sync'] === 'on')} label={node.title} onChange={setPower} disabled={off || !hue}/></>);
    case 'hue-choice': {
      const current = choice ?? hue?.[props.target] ?? undefined;
      return <div className="sh-dv-card" data-state={off || !hue ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span>
        {off || !hue ? <span className="sh-row-secondary">{props.unavailableText}</span> : null}
        <span className="sh-segments" role="radiogroup" aria-label={node.title}>{props.options.map(option => <button key={option.value} type="button" role="radio" aria-checked={current === option.value} onClick={() => setChoice(option.value)}>{option.label}</button>)}</span></div>;
    }
    case 'hue-brightness': {
      const value = level !== undefined ? Math.round(level * 100) : hue?.brightness ?? undefined;
      return <div className="sh-row sh-dv-row sh-dv-stack" data-state={off || !hue ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span><span className="sh-row-value">{value === undefined ? props.unavailableText : `${value}%`}</span>
        <input type="range" aria-label={node.title} className="sh-slider sh-dv-wide" min={0} max={100} value={value ?? 0} onChange={event => setLevel(Number(event.currentTarget.value) / 100)}/></div>;
    }
    case 'hue-input': {
      const index = 0, selected = hue?.input === props.option;
      const line = off || !hue ? props.unavailableText : selected ? props.selectedText : hue.connected[index] === 'on' ? props.connectedText : props.disconnectedText;
      return <UseButton className={`sh-row sh-dv-row sh-pressable ${selected ? 'sh-dv-selected' : ''}`.trim()} onPress={() => undefined}><span className="sh-row-glyph"><Glyph symbol={props.icon} size={20}/></span>
        <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{line}</span></span></UseButton>;
    }
    case 'card': {
      const entry = entryFor(device, 'cards', props.key, node.title);
      const label = props.states.find(option => option.value === entry?.state)?.label ?? entry?.text;
      const line = off ? props.unavailableText : label ?? props.fallbackText;
      return <div className={`sh-dv-card-tile ${entry?.active ? 'sh-dv-lit' : ''}`.trim()} data-state={off ? 'unavailable' : undefined}>
        <UseButton className="sh-dv-card-face" onPress={() => run(props.action)}><span className="sh-dv-card-glyph"><Glyph symbol={props.icon} size={22}/></span>
          <span className="sh-row-copy"><strong>{node.title}</strong><span>{line}</span></span></UseButton>
        {props.actions.map(item => { const Slot = slotGlyphs[item.slot]; return <UseButton key={item.slot} className="sh-dv-disc" label={item.label} onPress={() => undefined}><Slot size={16}/></UseButton>; })}
        <UseButton className="sh-dv-chev" label={`Open ${node.title}`} onPress={() => run(props.action)}><ChevronRight size={16}/></UseButton></div>;
    }
  }
}
