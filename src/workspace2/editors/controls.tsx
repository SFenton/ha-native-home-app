import { useEffect, useState } from 'react';

// MARK: Small controls

/** A text or number input that keeps what is being typed until it is valid. `multiline` draws a text area that grows to three lines. */
export function TextInput({ value, onCommit, label, number, placeholder, maxLength, multiline, disabled }: {
  value: string; onCommit: (value: string) => void; label: string; number?: boolean; placeholder?: string; maxLength?: number; multiline?: boolean; disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  const common = {
    'aria-label': label, value: text, placeholder, maxLength, disabled, onFocus: () => setFocused(true), onBlur: () => setFocused(false),
  };
  const change = (next: string) => { setText(next); onCommit(next); };
  return multiline
    ? <textarea {...common} rows={1} className="w2-grow-text" onChange={event => change(event.target.value)}/>
    : <input {...common} type={number ? 'number' : 'text'} onChange={event => change(event.target.value)}/>;
}
/** A labelled row: label leading, control trailing. */
export function LabeledRow({ label, keyName, children, trailing }: { label: string; keyName?: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return <div className="w2-field-row" data-field-key={keyName}><span className="w2-field-label"><span>{label}</span>{keyName && <code>{keyName}</code>}</span><div className="w2-field-control">{children}</div>{trailing}</div>;
}
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <label className="w2-switch-row"><span className="w2-row-label">{label}</span><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)}/></label>;
}

