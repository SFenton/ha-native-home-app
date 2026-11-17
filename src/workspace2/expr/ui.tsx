import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, MoreHorizontal, Zap } from 'lucide-react';
import type { Marker as MarkerKind } from './condition';

/** A segmented control: a `radiogroup`. A dimmed segment keeps its place in the tab order and says why through `describedBy` (spec "Accessibility"). */
export function Segmented<T extends string>({ label, value, options, onChange, describedBy, className = '' }: {
  label: string; value: T; options: readonly { value: T; label: string; dimmed?: boolean }[]; onChange: (value: T) => void; describedBy?: string; className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, at: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (at + step + options.length) % options.length;
    group.current?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
    if (!options[next].dimmed) onChange(options[next].value);
  };
  return <div ref={group} className={`w2-expr-seg ${className}`} role="radiogroup" aria-label={label}>
    {options.map((option, at) => <button type="button" key={option.value} role="radio" aria-checked={option.value === value} aria-disabled={option.dimmed || undefined}
      aria-describedby={option.dimmed ? describedBy : undefined} data-dimmed={option.dimmed || undefined} tabIndex={option.value === value ? 0 : -1} onKeyDown={event => move(event, at)}
      onClick={() => { if (!option.dimmed && option.value !== value) onChange(option.value); }}>{option.label}</button>)}
  </div>;
}

/** The marker of a result: a shape, never color alone (HIG, Accessibility). It is `aria-hidden`; its word is in the name beside it. */
export function Marker({ kind, size = 22 }: { kind: MarkerKind; size?: number }) {
  return <svg className="w2-marker" data-marker={kind} width={size} height={size} viewBox="0 0 22 22" aria-hidden focusable="false">
    {kind === 'check' && <><circle cx="11" cy="11" r="9" fill="currentColor"/><path d="M6.8 11.4l2.9 2.9 5.5-6" fill="none" stroke="var(--w2-card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>}
    {kind === 'ring' && <><circle cx="11" cy="11" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M7 11h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></>}
    {kind === 'unknown' && <><path d="M11 1.8l9.2 9.2-9.2 9.2L1.8 11z" fill="currentColor"/><text x="11" y="14.8" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--w2-card)">?</text></>}
    {kind === 'problem' && <><path d="M11 2.6l9 15.6H2z" fill="currentColor"/><path d="M11 8v5" stroke="var(--w2-card)" strokeWidth="1.8" strokeLinecap="round"/><circle cx="11" cy="15.4" r="1" fill="var(--w2-card)"/></>}
  </svg>;
}

/** One command of a {@link MoreMenu}. */
export interface MenuCommand { label: string; run: () => void; disabled?: boolean; danger?: boolean; separatorBefore?: boolean }
/** A More button and its menu of commands (Edit, Duplicate, Move Up, Remove). */
export function MoreMenu({ label, commands, size = 16 }: { label: string; commands: readonly MenuCommand[]; size?: number }) {
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button w2-expr-more" aria-label={label}><MoreHorizontal size={size} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={4} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      {commands.map(command => <span key={command.label}>
        {command.separatorBefore && <Menu.Separator className="w2-menu-sep"/>}
        <Menu.Item className={`w2-menu-item ${command.danger ? 'w2-danger-item' : ''}`} disabled={command.disabled} onClick={command.run}>{command.label}</Menu.Item>
      </span>)}
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The value button (D2): 28 by 36, 44 by 44 on coarse pointers, a bolt in the muted color at a row's trailing edge. A pop-up button of
 * mutually exclusive modes; it is named "Title value: Fixed".
 */
export function ValueButton<T extends string>({ label, mode, choices, onPick }: { label: string; mode: T; choices: readonly { value: T; label: string }[]; onPick: (mode: T) => void }) {
  const current = choices.find(choice => choice.value === mode)?.label ?? '';
  return <Menu.Root>
    <Menu.Trigger className="w2-expr-valuebtn" aria-label={`${label} value: ${current}`} aria-haspopup="menu" title={`${label} value: ${current}`}><Zap size={15} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={4} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <Menu.RadioGroup value={mode} onValueChange={next => { if (next !== mode) onPick(next as T); }}>
        {choices.map(choice => <Menu.RadioItem key={choice.value} value={choice.value} closeOnClick className="w2-menu-item w2-expr-radio">
          <span className="w2-expr-check"><Menu.RadioItemIndicator><Check size={14} aria-hidden/></Menu.RadioItemIndicator></span>{choice.label}
        </Menu.RadioItem>)}
      </Menu.RadioGroup>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/** A labelled group of a page: "When", "If", "Then" (12 px, weight 600, muted). */
export function GroupLabel({ children, id }: { children: ReactNode; id?: string }) {
  return <h3 className="w2-expr-grouplabel" id={id}>{children}</h3>;
}
