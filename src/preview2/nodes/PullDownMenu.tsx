import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRender } from '../render-context';

/** One entry of a {@link PullDownMenu}. */
export interface PullDownOption {
  value: string;
  label: string;
}

/** Props of {@link PullDownMenu}. */
export interface PullDownMenuProps {
  /** The menu's name for VoiceOver and the trigger: the setting it changes ("Mode"). */
  title: string;
  options: readonly PullDownOption[];
  /** The value that carries the check, or undefined when none does. */
  selected?: string;
  /** Called with the chosen value. A simulated change only; the menu never reaches a service. */
  onSelect(value: string): void;
  disabled?: boolean;
  className: string;
  /** The face of the trigger: the current value and its chevrons. */
  children: ReactNode;
}

/** Where an open menu sits inside the screen, in the screen's own unscaled points. */
type Anchor = { style: CSSProperties };

/** Height of one menu row in points, for the flip-above decision before the menu is measured. */
const ROW = 44;
const EDGE = 8;

/**
 * An iOS pull-down menu (`UIMenu` on a button with `showsMenuAsPrimaryAction`, as the vacuum's Mode, Fan and Water rows and the
 * thermostat's hub use it): the trigger shows the current value; a press lists the options in a floating card with a check
 * beside the current one; a pick calls `onSelect` and closes, and a press anywhere else or Esc closes without a pick.
 * Use opens it; Edit leaves the press to the selection layer. The card is drawn into the screen's layer, so the sheet and
 * the page's scroll never clip it, and it scales with the preview.
 */
export function PullDownMenu({ title, options, selected, onSelect, disabled, className, children }: PullDownMenuProps) {
  const { mode } = useRender();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ layer: HTMLElement; anchor: Anchor }>();
  const id = useId();
  useEffect(() => { if (mode !== 'use') setOpen(undefined); }, [mode]);
  const close = (refocus: boolean) => { setOpen(undefined); if (refocus) trigger.current?.focus({ preventScroll: true }); };

  const show = () => {
    const button = trigger.current, layer = button?.closest<HTMLElement>('.sh-layer');
    if (!button || !layer) return;
    const box = button.getBoundingClientRect(), frame = layer.getBoundingClientRect();
    const scale = layer.offsetWidth > 0 && frame.width > 0 ? frame.width / layer.offsetWidth : 1;
    const left = (box.left - frame.left) / scale, right = (box.right - frame.left) / scale, top = (box.top - frame.top) / scale, bottom = (box.bottom - frame.top) / scale;
    const width = layer.offsetWidth, height = layer.offsetHeight;
    const style: CSSProperties = { maxHeight: Math.max(ROW * 3, height - 2 * EDGE) };
    // Trailing-aligned when the trigger sits on the right half, as the system aligns a menu to its button's near edge.
    if ((left + right) / 2 > width / 2) style.right = Math.max(EDGE, width - right); else style.left = Math.max(EDGE, left);
    const needed = options.length * ROW + 16;
    if (bottom + 6 + needed > height - EDGE && top - 6 - needed > EDGE) style.bottom = height - top + 6; else style.top = Math.min(bottom + 6, Math.max(EDGE, height - EDGE - needed));
    setOpen({ layer, anchor: { style } });
  };

  const choose = (value: string) => { onSelect(value); close(true); };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=menuitemradio]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return <>
    <button ref={trigger} type="button" className={className} aria-label={title} aria-haspopup="menu" aria-expanded={open !== undefined} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={event => { if (mode !== 'use') return; event.stopPropagation(); if (open) close(false); else show(); }}>{children}</button>
    {open && createPortal(<>
      <div className="sh-menu-scrim" data-passthrough="" onClick={() => close(true)}/>
      <div id={id} className="sh-menu" role="menu" aria-label={title} style={open.anchor.style} onKeyDown={move}>
        {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === selected} className="sh-menu-item"
          autoFocus={option.value === selected || (selected === undefined && option === options[0])} onClick={() => choose(option.value)}>
          <span className="sh-menu-check" aria-hidden="true">{option.value === selected && <Check size={16} strokeWidth={3}/>}</span><span>{option.label}</span></button>)}
      </div>
    </>, open.layer)}
  </>;
}
