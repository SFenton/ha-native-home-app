import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Activity, AirVent, AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Bolt, BookOpen, Bug, CalendarDays, Camera, Carrot, Check, ChevronRight, Circle, CircleCheck, CircleGauge, Cloud, Code2, Coffee, CookingPot, Database, DoorOpen, Download, Ellipsis, Eye, Fan, FileText, Film, Flame, Folder, GalleryHorizontal, Grid2X2, Heart, HelpCircle, Home, Image, Info, Lamp, Layers, Leaf, Lightbulb, List, Lock, Mail, MessageSquare, Milk, Moon, Music, Play, Plus, Radio, Search, Settings, Shield, ShieldCheck, ShoppingBasket, SlidersHorizontal, Smartphone, Snowflake, Space, Sparkles, Sun, Thermometer, ToggleLeft, Trash2, Tv, Type, User, Users, Video, Volume2, WashingMachine, Wifi, Wrench, X, type LucideIcon } from 'lucide-react';
import type { Json, Primitive } from './shared/types';
import { Apple, Bath, Bed, Car, CloudSun, Computer, DoorClosed, Droplets, Dumbbell, Gamepad2, Guitar, Heater, ListChecks, Microwave, PanelTop, Projector, Server, ShieldOff, ShowerHead, Sofa, SprayCan, Sunrise, Utensils, Vault, Wind } from 'lucide-react';
import { Armchair, Brush, ChevronDown, ChevronLeft, ChevronUp, createLucideIcon, DropletOff, Keyboard, Laptop, Paintbrush, Pause, Percent, Plane, PlugZap, Power, Radar, Refrigerator, Shirt, Volume1, VolumeX } from 'lucide-react';

const WalkingPerson = createLucideIcon('WalkingPerson', [
  ['circle', { cx: '14', cy: '4', r: '2', key: 'head' }],
  ['path', { d: 'm12 7-2 8 5 3v4', key: 'body' }],
  ['path', { d: 'm10 15-4 7', key: 'back-leg' }],
  ['path', { d: 'm12 7 4 5h4', key: 'front-arm' }],
  ['path', { d: 'm12 7-4 2-2 4', key: 'back-arm' }],
]);

const icons: Record<string, LucideIcon> = { home: Home, house: Home, 'house.fill': Home, grid: Grid2X2, 'square.grid.2x2': Grid2X2, 'square.grid.2x2.fill': Grid2X2, settings: Settings, gear: Settings, gearshape: Settings, 'gearshape.fill': Settings, user: User, person: User, 'person.crop.circle': User, profile: User, users: Users, camera: Camera, 'camera.fill': Camera, video: Video, tv: Tv, film: Film, music: Music, speaker: Volume2, lightbulb: Lightbulb, 'lightbulb.fill': Lightbulb, light: Lightbulb, lights: Lightbulb, sun: Sun, 'sun.max': Sun, 'sun.max.fill': Sun, moon: Moon, 'moon.fill': Moon, thermometer: Thermometer, climate: Thermometer, snowflake: Snowflake, flame: Flame, fan: Fan, 'fan.fill': Fan, air: AirVent, lock: Lock, 'lock.fill': Lock, security: Shield, shield: Shield, bell: Bell, wifi: Wifi, bolt: Bolt, 'bolt.fill': Bolt, energy: Bolt, leaf: Leaf, 'leaf.fill': Leaf, heart: Heart, coffee: Coffee, door: DoorOpen, 'door.left.hand.open': DoorOpen, activity: Activity, 'waveform.path.ecg': Activity, radio: Radio, cloud: Cloud, play: Play, 'play.fill': Play, plus: Plus, check: Check, 'checkmark.circle.fill': Check, xmark: X, 'chevron.right': ChevronRight, 'arrow.right': ArrowRight, 'arrow.left': ArrowLeft, 'arrow.down': ArrowDown, info: Info, 'info.circle': Info, 'questionmark.circle': HelpCircle, help: HelpCircle, 'exclamationmark.bubble': MessageSquare, message: MessageSquare, 'bubble.left': MessageSquare, 'bubble.left.fill': MessageSquare, 'lightbulb.badge': Sparkles, sparkles: Sparkles, mail: Mail, envelope: Mail, list: List, 'list.bullet': List, layers: Layers, folder: Folder, text: FileText, document: FileText, book: BookOpen, eye: Eye, toggle: ToggleLeft, database: Database, image: Image, code: Code2, download: Download, smartphone: Smartphone, sliders: SlidersHorizontal, wrench: Wrench, trash: Trash2, search: Search, ellipsis: Ellipsis };
Object.assign(icons, { type: Type, alignleft: AlignLeft, zap: Bolt, arrowupright: ArrowUpRight, layoutgrid: Grid2X2, galleryhorizontal: GalleryHorizontal, userround: User, usersround: Users, toggleright: ToggleLeft, space: Space, bug: Bug, circlegauge: CircleGauge, circlecheck: CircleCheck, shieldcheck: ShieldCheck, carrot: Carrot, milk: Milk, shoppingbasket: ShoppingBasket, cookingpot: CookingPot, calendardays: CalendarDays, lamp: Lamp, washingmachine: WashingMachine, slidershorizontal: SlidersHorizontal });
Object.assign(icons, { cloudsun: CloudSun, listchecks: ListChecks, 'mdi:lightbulb-group': Lightbulb, 'mdi:lightbulb': Lightbulb, 'mdi:shield-outline': Shield, 'mdi:thermometer': Thermometer, 'mdi:motion-sensor': Activity, 'mdi:door': DoorOpen, 'mdi:door-closed': DoorOpen, 'mdi:air-filter': Wind, 'mdi:sofa': Sofa, 'mdi:bed': Bed, 'mdi:car': Car, 'mdi:lock': Lock, 'mdi:fan': Fan, 'mdi:camera': Camera, 'mdi:floor-plan': Grid2X2 });
Object.assign(icons, {
  wind: Wind, bed: Bed, sofa: Sofa, car: Car, shieldoff: ShieldOff, droplets: Droplets, sunrise: Sunrise, 'figure.walk': WalkingPerson,
  'lightbulb.2': Lightbulb, 'shield.slash': ShieldOff, 'person.walk': WalkingPerson, 'bed.double': Bed,
  'mdi:air-humidifier': Droplets, 'mdi:air-purifier': AirVent, 'mdi:apple': Apple, 'mdi:bathtub': Bath,
  'mdi:bed-king': Bed, 'mdi:blur': CircleGauge, 'mdi:controller': Gamepad2, 'mdi:desktop-tower': Computer,
  'mdi:dishwasher': WashingMachine, 'mdi:door-open': DoorOpen, 'mdi:door-closed': DoorClosed, 'mdi:dumbbell': Dumbbell,
  'mdi:food-fork-drink': Utensils, 'mdi:gamepad': Gamepad2, 'mdi:garage': Vault, 'mdi:grill': Flame,
  'mdi:guitar-electric': Guitar, 'mdi:heat-wave': Heater, 'mdi:microsoft-windows': Computer,
  'mdi:microsoft-xbox': Gamepad2, 'mdi:movie-open': Film, 'mdi:music': Music, 'mdi:projector': Projector,
  'mdi:remote': Radio, 'mdi:robot-vacuum': CircleGauge, 'mdi:server': Server, 'mdi:shower': ShowerHead,
  'mdi:silverware-fork-knife': Utensils, 'mdi:sprinkler-variant': SprayCan, 'mdi:stairs': Layers,
  'mdi:stove': Microwave, 'mdi:television': Tv, 'mdi:tumble-dryer': WashingMachine,
  'mdi:washing-machine': WashingMachine, 'mdi:weather-sunset-up': Sunrise, 'mdi:window-closed': PanelTop,
  calendar: CalendarDays, 'fork.knife': Utensils, 'person.2': Users, airplane: Plane, 'wrench.and.screwdriver': Wrench, 'slider.horizontal.3': SlidersHorizontal, chevronright: ChevronRight,
  'mdi:audio-video': Tv, 'mdi:bed-double': Bed, 'mdi:bottle-tonic': SprayCan, 'mdi:brush': Brush, 'mdi:brush-variant': Paintbrush,
  'mdi:car-defrost-front': Heater, 'mdi:car-door-lock': Lock, 'mdi:car-seat': Armchair, 'mdi:circle': Circle, 'mdi:cupboard': DoorClosed,
  'mdi:chevron-down': ChevronDown, 'mdi:chevron-left': ChevronLeft, 'mdi:chevron-right': ChevronRight, 'mdi:chevron-up': ChevronUp,
  'mdi:delete': Trash2, 'mdi:ev-station': PlugZap, 'mdi:fire': Flame, 'mdi:fridge': Refrigerator, 'mdi:gamepad-variant': Gamepad2,
  'mdi:home': Home, 'mdi:keyboard': Keyboard, 'mdi:laptop': Laptop, 'mdi:lock-clock': Lock, 'mdi:nintendo-switch': Gamepad2,
  'mdi:pause': Pause, 'mdi:percent': Percent, 'mdi:play': Play, 'mdi:power': Power, 'mdi:radar': Radar, 'mdi:remote-tv': Radio,
  'mdi:shaker-outline': CookingPot, 'mdi:shower-head': ShowerHead, 'mdi:smoke': Cloud, 'mdi:snowflake': Snowflake, 'mdi:string-lights': Lightbulb,
  'mdi:tire': CircleGauge, 'mdi:toggle-switch': ToggleLeft, 'mdi:triangle-down': ChevronDown, 'mdi:volume-minus': Volume1,
  'mdi:volume-mute': VolumeX, 'mdi:volume-plus': Volume2, 'mdi:wardrobe': Shirt, 'mdi:water': Droplets, 'mdi:water-off': DropletOff, 'mdi:weight-lifter': Dumbbell,
});
export function hasIcon(name: string): boolean {
  return !name.trim() || Boolean(icons[name.toLowerCase()] ?? icons[name.toLowerCase().replace(/\.fill$/, '')]);
}
export const iconNames = ['home', 'grid', 'settings', 'user', 'camera', 'video', 'music', 'lightbulb', 'sun', 'moon', 'thermometer', 'snowflake', 'flame', 'fan', 'lock', 'shield', 'bell', 'wifi', 'bolt', 'leaf', 'heart', 'door', 'activity', 'cloud', 'play', 'plus', 'info', 'help', 'message', 'sparkles', 'list', 'layers', 'database', 'Carrot', 'Milk', 'CookingPot', 'ShoppingBasket', 'WashingMachine'];
export function Icon({ name = 'grid', size = 18, className }: { name?: string; size?: number; className?: string }) {
  if (!name.trim()) return null;
  const known = hasIcon(name);
  const Glyph = icons[name.toLowerCase()] ?? icons[name.toLowerCase().replace(/\.fill$/, '')] ?? HelpCircle;
  return <Glyph size={size} strokeWidth={1.8} className={className} data-icon={name} data-icon-missing={known ? undefined : true} aria-hidden="true"/>;
}
export function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}>{children}</button>;
}
export function Field({ label, children, hint, hintId }: { label: string; children: ReactNode; hint?: string; hintId?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small id={hintId}>{hint}</small>}</label>;
}
export function TextField({ label, value, onChange, ...props }: { label: string; value?: string; onChange: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return <Field label={label}><input value={value ?? ''} onChange={event => onChange(event.target.value)} {...props}/></Field>;
}
export function NumberField({ label, value, onChange, min = 0, max = 100, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  const hintId = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(String(value)); setError(''); } }, [value]);
  return <Field label={label} hint={error} hintId={hintId}><input type="number" value={text} min={min} max={max} step={step} aria-invalid={Boolean(error)} aria-describedby={error ? hintId : undefined} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={event => {
    setText(event.target.value);
    const number = event.target.valueAsNumber;
    const steps = (number - min) / step;
    if (!Number.isFinite(number) || number < min || number > max || Math.abs(steps - Math.round(steps)) > 0.00001) {
      setError(`Use ${min} to ${max} in steps of ${step}.`);
      return;
    }
    setError(''); onChange(number);
  }}/></Field>;
}
export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: (string | { value: string; label: string })[]; onChange: (value: string) => void }) {
  return <Field label={label}><select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => typeof option === 'string' ? <option value={option} key={option}>{option}</option> : <option value={option.value} key={option.value}>{option.label}</option>)}</select></Field>;
}
export function IconField({ value, onChange, label = 'Icon' }: { value?: string; onChange: (value: string) => void; label?: string }) {
  const listId = useId();
  return <Field label={label} hint={value && !hasIcon(value) ? 'No matching icon. Choose a supported icon; the preview uses a question mark.' : undefined}><div className="icon-field"><Icon name={value}/><input aria-label={label} list={listId} value={value ?? ''} onChange={event => onChange(event.target.value)}/></div><datalist id={listId}>{iconNames.map(name => <option key={name} value={name}/>)}</datalist></Field>;
}
export function JsonField({ label, value, onChange, primitive = false, shape }: { label: string; value: Json; onChange: (value: Json) => void; primitive?: boolean; shape?: 'object' | 'primitive-record' }) {
  const hintId = useId();
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState('');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(serialized); }, [serialized]);
  return <Field label={label} hintId={hintId} hint={error || (primitive ? 'JSON string, number, boolean, or null.' : 'Valid JSON. Changes apply when you leave this field.')}><textarea className="code-input" value={text} aria-invalid={Boolean(error)} aria-describedby={hintId} onFocus={() => { focused.current = true; }} onChange={event => setText(event.target.value)} onBlur={() => {
    focused.current = false;
    try {
      const parsed = JSON.parse(text) as Json;
      if (primitive && parsed !== null && typeof parsed === 'object') throw new Error('Enter a primitive value, not an object or array.');
      if (shape && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Enter a JSON object with named keys.');
      if (shape === 'primitive-record' && typeof parsed === 'object' && parsed && Object.values(parsed).some(item => item !== null && typeof item === 'object')) throw new Error('Attribute values must be strings, numbers, booleans, or null.');
      onChange(parsed); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }}/></Field>;
}
export function PrimitiveField({ label, value, onChange }: { label: string; value: Primitive; onChange: (value: Primitive) => void }) {
  return <JsonField label={label} value={value} primitive onChange={value => onChange(value as Primitive)}/>;
}
export function EmptyState({ icon = 'layers', title, children }: { icon?: string; title: string; children: ReactNode }) {
  return <div className="empty-state"><span><Icon name={icon} size={25}/></span><strong>{title}</strong><p>{children}</p></div>;
}
export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const invoker = useRef<HTMLElement | undefined>(undefined);
  const active = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!invoker.current && document.activeElement instanceof HTMLElement) invoker.current = document.activeElement;
    const origin = invoker.current;
    active.current = true;
    dialog?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      active.current = false;
      dialog?.close();
      queueMicrotask(() => {
        if (document.querySelector('dialog[open]')) return;
        const destination = origin?.isConnected && !origin.closest('[hidden], [inert]') && !origin.matches(':disabled')
          ? origin : document.querySelector<HTMLElement>('[data-editor-focus-fallback]');
        destination?.focus({ preventScroll: true });
      });
    };
  }, []);
  // Strict Mode can reopen the dialog before a queued cleanup close is delivered.
  return <dialog ref={ref} aria-labelledby={titleId} className={`studio-dialog ${wide ? 'wide' : ''}`} onClose={event => { if (active.current && !event.currentTarget.open) onClose(); }} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}><div className="dialog-heading"><div><span className="eyebrow">NATIVE HOME STUDIO</span><h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2></div><IconButton label="Close dialog" onClick={onClose}><X size={18}/></IconButton></div><div className="dialog-content">{children}</div></dialog>;
}
