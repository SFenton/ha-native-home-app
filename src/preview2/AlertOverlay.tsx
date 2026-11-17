import { useEffect, useRef, useState } from 'react';
import type { AlertSpec } from './alert';

/** How long the alert fades in and out, in ms. */
export const ALERT_FADE_MS = 150;

/** The alert itself, 270 pt wide: title, message and two buttons, Cancel leading and the confirm button trailing. Buttons do nothing unless given handlers. */
export function AlertBox({ alert, onCancel, onConfirm, cancelRef }: { alert: AlertSpec; onCancel?: () => void; onConfirm?: () => void; cancelRef?: React.Ref<HTMLButtonElement> }) {
  return <div className="sh-alert-box" data-testid="sim-alert-box">
    <div className="sh-alert-text">
      <h2 className="sh-alert-title" id="sh-alert-title">{alert.title}</h2>
      {alert.message ? <p className="sh-alert-message">{alert.message}</p> : null}
    </div>
    <div className="sh-alert-buttons">
      <button type="button" className="sh-alert-button" ref={cancelRef} tabIndex={onCancel ? 0 : -1} onClick={onCancel}>{alert.cancelLabel}</button>
      <button type="button" className="sh-alert-button sh-alert-confirm" data-destructive={alert.destructive ? '' : undefined} tabIndex={onConfirm ? 0 : -1} onClick={onConfirm}>{alert.confirmLabel}</button>
    </div>
  </div>;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The alert drawn over the simulated screen. As a preview (`live` false) it is hidden from assistive technology and ignores
 * the pointer; in Use mode it is an `alertdialog` with focus on Cancel, and Escape cancels. It fades for 150 ms, and with
 * Reduce Motion it comes and goes at once.
 */
export function AlertOverlay({ alert, live, onCancel, onConfirm }: { alert?: AlertSpec; live: boolean; onCancel(): void; onConfirm(): void }) {
  // The last alert stays on screen while it fades out.
  const [held, setHeld] = useState<AlertSpec>();
  const [leaving, setLeaving] = useState(false);
  if (alert && held !== alert) { setHeld(alert); setLeaving(false); }
  if (!alert && held && !leaving) {
    if (reduced()) setHeld(undefined); else setLeaving(true);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => { setHeld(undefined); setLeaving(false); }, ALERT_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (live && alert) cancel.current?.focus({ preventScroll: true }); }, [live, alert]);
  if (!held) return null;
  const shown = leaving ? held : alert ?? held;
  return <div className="sh-alert-scrim" data-testid="sim-alert" data-leaving={leaving ? '' : undefined} data-live={live ? '' : undefined}
    {...(live ? { role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': 'sh-alert-title', onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } } } : { 'aria-hidden': true })}>
    <AlertBox alert={shown} cancelRef={cancel} onCancel={live ? onCancel : undefined} onConfirm={live ? onConfirm : undefined}/>
  </div>;
}
