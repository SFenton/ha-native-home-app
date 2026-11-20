import { useId } from 'react';

/** A switch row with an optional caption under it. The caption describes the switch (a disabled row says why there). */
export function SwitchRow({ label, checked, onChange, disabled, caption, path }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; caption?: string; path?: string }) {
  const captionId = useId();
  return <>
    <label className="w2-switch-row" data-field-path={path}><span className="w2-row-label w2-wide-label">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={caption ? captionId : undefined} onChange={event => onChange(event.target.checked)}/></label>
    {caption && <p id={captionId} className="w2-caption">{caption}</p>}
  </>;
}
