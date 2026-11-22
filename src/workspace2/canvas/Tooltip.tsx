import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export default function Tooltip({ children, text }: { children: ReactElement<HTMLAttributes<HTMLElement>>; text: ReactNode }) {
  const id = useId(), timer = useRef<ReturnType<typeof setTimeout>>(undefined), trigger = useRef<HTMLElement | null>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const dismissed = useRef(false), popupHovered = useRef(false);
  const hide = () => { clearTimeout(timer.current); popupHovered.current = false; setOpen(false); };
  const show = (element: HTMLElement, delay: number) => {
    trigger.current = element;
    clearTimeout(timer.current);
    if (dismissed.current) return;
    const reveal = () => {
      const rect = element.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)), top: rect.bottom + 8 });
      setOpen(true);
    };
    if (delay) timer.current = setTimeout(reveal, delay);
    else reveal();
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); dismissed.current = true; hide(); } };
    document.addEventListener('keydown', escape, true);
    const rect = popup.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 12) setPosition(held => ({ ...held, top: Math.max(12, (trigger.current?.getBoundingClientRect().top ?? 12) - rect.height - 8) }));
    return () => document.removeEventListener('keydown', escape, true);
  }, [open]);
  const leave = () => { dismissed.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 80); };
  return <>{cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: event => { children.props.onMouseEnter?.(event); show(event.currentTarget, 300); },
    onMouseLeave: event => { children.props.onMouseLeave?.(event); leave(); },
    onFocus: event => { children.props.onFocus?.(event); show(event.currentTarget, 0); },
    onBlur: event => { children.props.onBlur?.(event); dismissed.current = false; if (!popupHovered.current) hide(); },
    onClick: event => { hide(); children.props.onClick?.(event); },
  })}{open && createPortal(<div ref={popup} id={id} role="tooltip" className="w2-canvas-tooltip" style={{
    ...position,
    ...inheritedVariables(trigger.current),
  }} onMouseEnter={() => { popupHovered.current = true; clearTimeout(timer.current); }} onMouseLeave={() => { popupHovered.current = false; leave(); }}>{text}</div>, document.body)}</>;
}

function inheritedVariables(element: HTMLElement | null): Record<string, string> {
  const surface = element?.closest<HTMLElement>('.w2-canvas');
  return surface ? Object.fromEntries(Array.from({ length: surface.style.length }, (_, i) => surface.style.item(i)).filter(key => key.startsWith('--')).map(key => [key, surface.style.getPropertyValue(key)])) : {};
}
