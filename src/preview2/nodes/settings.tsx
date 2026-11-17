import { Check, ChevronRight, CircleCheck, Circle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRender } from '../render-context';
import type { SettingsKind } from '../../shared/composition/settings';
import { Switch, UseButton, unavailableText, useEntity, usePreviewValue, useSharedPreview, useSimulate, stateText } from './device-shared';
import { Glyph, Pressable, type NodeOf } from './shared';

/** The kinds whose native row carries the document's glyph; the rest are plain rows the schema fills with a stand-in symbol. */
const glyphKinds: readonly SettingsKind[] = ['household-toggle', 'household-recovery', 'household-read-only', 'presence-room', 'presence-choice', 'vacation-toggle', 'solo-toggle',
  'solo-traveler', 'location-account', 'location-action', 'sign-out', 'app-icon-choice', 'away-restore', 'profile-person', 'ha-web'];
const appIcons: Record<string, [string, string]> = {
  navySky: ['#1B2A5C', '#5AB0FF'], tealMint: ['#0E5E63', '#7FE8C8'], plumLilac: ['#4B1F5E', '#C9A0F0'], forestGreen: ['#14461F', '#6FCB7A'],
  burgundyRose: ['#5C1428', '#F08AA6'], indigoPeriwinkle: ['#2A1F73', '#9FA8FF'], espressoAmber: ['#3A2418', '#F0A94A'], midnightGold: ['#0E1230', '#E8C35A'],
};

/** `settings-control`: one row of the Settings, Household, Vacation, Feedback, Profile or Performance pages. */
export function SettingsControlNode({ node }: { node: NodeOf<'settings-control'> }) {
  const { props } = node, kind = props.kind;
  const entityId = props.item.split('/')[0];
  const entity = useEntity(entityId.includes('.') ? entityId : undefined);
  const send = useSimulate();
  const { house } = useRender();
  const [local, setLocal] = usePreviewValue<boolean | undefined>(undefined);
  const [slider, setSlider] = usePreviewValue(50);
  const [draft, setDraft] = usePreviewValue('');
  const [picked, setPicked] = useSharedPreview<string | undefined>(`${props.sourceId}:${kind}`, undefined);
  const glyph = glyphKinds.includes(kind) ? <span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span> : null;
  const subtitle = props.subtitle ? <span className="sh-row-secondary">{props.subtitle}</span> : null;
  const copy = (extra?: ReactNode) => <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>{subtitle}{extra}</span>;
  const row = (children: ReactNode, options: { className?: string; action?: typeof props.destination; onPress?: () => void } = {}) => options.onPress
    ? <UseButton className={`sh-row sh-dv-row sh-pressable ${options.className ?? ''}`.trim()} onPress={options.onPress}>{children}</UseButton>
    : <Pressable action={options.action} className={`sh-row sh-dv-row ${options.className ?? ''} ${options.action ? 'sh-pressable' : ''}`.trim()}>{children}</Pressable>;
  const value = (text: string | undefined, chevron = false) => <>{<span className="sh-row-value" data-state={text ? undefined : 'unavailable'}>{text ?? unavailableText}</span>}{chevron && <ChevronRight size={16} aria-hidden="true"/>}</>;
  const toggle = (on: boolean, change?: (next: boolean) => void, disabled?: boolean) => <Switch on={on} label={node.title} onChange={change} disabled={disabled}/>;
  const button = (tone: 'accent' | 'danger' | 'prominent', glyphOn = true) => row(<>
    {glyphOn && glyphKinds.includes(kind) && <span className="sh-row-glyph"><Glyph symbol={node.icon} size={20}/></span>}
    <UseButton className={`sh-dv-button sh-dv-${tone}`} onPress={() => undefined}>{node.title}</UseButton></>, { className: 'sh-dv-center' });

  switch (kind) {
    case 'household-toggle': {
      const on = entity?.state === 'on';
      return row(<>{glyph}{copy()}{toggle(on, next => send(entityId, next ? 'turn_on' : 'turn_off'), !entity || entity.state === 'unavailable')}</>);
    }
    case 'household-recovery': return row(<>{glyph}{copy()}{toggle(local ?? false, setLocal)}</>);
    case 'app-badge': return row(<>{copy()}{toggle(local ?? true, setLocal)}</>);
    case 'performance-recording': return row(<>{copy()}{toggle(local ?? false, setLocal)}</>);
    case 'household-relay-warning': return <div className="sh-row sh-dv-row sh-dv-warning" role="note"><TriangleAlert size={20} aria-hidden="true"/><span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span>{subtitle}</span></div>;
    case 'household-read-only': return row(<>{glyph}{copy()}{value(stateText(entity))}</>);
    case 'presence-room': return row(<>{glyph}{copy()}{value(stateText(entity), true)}</>, { action: props.destination });
    case 'presence-choice': {
      const selected = (props.item.split('/')[1] === 'enabled') === (local ?? entity?.state === 'on');
      return row(<>{glyph}{copy()}{selected && <Check size={18} className="sh-dv-check" aria-label="Selected"/>}</>, { className: selected ? 'sh-dv-selected' : '', onPress: () => setLocal(props.item.split('/')[1] === 'enabled' ? true : false) });
    }
    case 'vacation-status': case 'away-status': case 'location-status': case 'feedback-status': return row(<>{copy()}{value(undefined)}</>);
    case 'vacation-toggle': case 'solo-toggle': return row(<>{glyph}{copy()}{toggle(local ?? false, setLocal)}</>, { action: props.destination });
    case 'vacation-check': {
      const on = local ?? entity?.state === 'on';
      return row(<>{copy()}{on ? <CircleCheck className="sh-dv-check" size={24} aria-label="Done"/> : <Circle size={24} aria-label="Not done" className="sh-dv-off"/>}</>);
    }
    case 'solo-traveler': {
      const on = local ?? false;
      return row(<>{glyph}{copy()}{on ? <CircleCheck className="sh-dv-check" size={24} aria-label="Selected"/> : <Circle size={24} aria-label="Not selected" className="sh-dv-off"/>}</>);
    }
    case 'vacation-dates': case 'solo-dates': case 'solo-return': return row(<>{copy()}<span className="sh-dv-date">Choose a date</span></>);
    case 'vacation-confirm': case 'solo-confirm': case 'feedback-submit': case 'location-action': return button('prominent');
    case 'reset-background-blur': return row(<UseButton className="sh-dv-button sh-dv-accent" onPress={() => setSlider(50)} disabled={slider === 50}>{node.title}</UseButton>, { className: 'sh-dv-center' });
    case 'feedback-stop': return button('danger', false);
    case 'sign-out': return button('danger');
    case 'performance-action': return button(['reset', 'clear-images'].includes(props.item) ? 'danger' : 'accent', false);
    case 'background-blur': return <div className="sh-row sh-dv-row sh-dv-stack"><span className="sh-row-primary">{node.title}</span><span className="sh-row-value">{slider}%</span>
      <input type="range" aria-label={node.title} className="sh-slider sh-dv-wide" min={0} max={100} step={5} value={slider} onChange={event => setSlider(Number(event.currentTarget.value))}/></div>;
    case 'app-version': return row(<>{copy()}{value(undefined)}</>);
    case 'app-icon-choice': {
      const [from, to] = appIcons[props.item] ?? appIcons.navySky;
      const selected = (picked ?? 'navySky') === props.item;
      return row(<><span className="sh-dv-appicon" style={{ background: `linear-gradient(160deg, ${from}, ${to})` }} aria-hidden="true"/>{copy()}{selected && <Check size={18} className="sh-dv-check" aria-label="Selected"/>}</>,
        { className: selected ? 'sh-dv-selected' : '', onPress: () => setPicked(props.item) });
    }
    case 'away-restore': return row(<>{glyph}{copy()}{(picked ?? 'keep_current') === props.item && <Check size={18} className="sh-dv-check" aria-label="Selected"/>}</>, { onPress: () => setPicked(props.item) });
    case 'feedback-field': {
      const long = props.item !== 'title';
      return <label className="sh-row sh-dv-row sh-dv-stack"><span className="sh-row-primary">{node.title}</span>
        {long ? <textarea className="sh-field sh-dv-wide" rows={3} value={draft} onChange={event => setDraft(event.currentTarget.value)}/> : <input className="sh-field sh-dv-wide" value={draft} onChange={event => setDraft(event.currentTarget.value)}/>}</label>;
    }
    case 'feedback-media': return row(<><span className="sh-row-glyph"><Glyph symbol={{ name: 'paperclip' }} size={20}/></span>{copy()}<ChevronRight size={16} aria-hidden="true"/></>, { className: 'sh-pressable' });
    case 'location-account': return row(<>{glyph}{copy()}{value(undefined, true)}</>, { action: props.destination });
    case 'profile-person': return row(<>{glyph}<span className="sh-avatar sh-dv-avatar" aria-hidden="true">{node.title.charAt(0).toUpperCase()}</span>{copy()}</>);
    case 'profile-people': {
      const home = [...(house.states?.values() ?? [])].filter(state => state.entityId.startsWith('person.') && state.state === 'home');
      return row(<>{copy()}<span className="sh-dv-people">{home.map(person => <span key={person.entityId} className="sh-avatar sh-dv-avatar" title={person.name}>{(person.name || person.entityId).charAt(0).toUpperCase()}</span>)}
        {home.length === 0 && <span className="sh-row-value">Nobody</span>}</span></>);
    }
    case 'ha-settings': case 'ha-web': return row(<>{glyph}{copy()}<ChevronRight size={16} aria-hidden="true"/></>, { className: 'sh-pressable' });
    case 'ha-value': return row(<>{copy()}{value(props.item === 'connection' && house.states ? 'Connected' : props.item === 'role' && house.viewer ? house.viewer.isAdmin ? 'Administrator' : 'Resident' : undefined)}</>);
    default: return row(<>{copy()}</>);
  }
}
