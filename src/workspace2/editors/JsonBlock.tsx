import { useEffect, useId, useState } from 'react';
import type { Json } from '../../shared/types';

/**
 * A JSON editor for the part the builders do not draw (a rule or formula deeper than two levels, a row they cannot express).
 * It applies on blur when the text parses and `validate` accepts it; until then the value stays as it was, so it survives unchanged.
 */
export default function JsonBlock({ label, value, onChange, validate }: { label: string; value: Json; onChange: (value: Json) => void; validate?: (value: Json) => string | undefined }) {
  const id = useId();
  const text = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(text); }, [text, editing]);
  return <div className="w2-editor-section">
    <label htmlFor={id} className="w2-row-label">{label}</label>
    <textarea id={id} className="w2-json" spellCheck={false} value={draft} aria-invalid={Boolean(error)} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft === text) { setError(''); return; }
        try {
          const parsed = JSON.parse(draft) as Json;
          const problem = validate?.(parsed);
          if (problem) { setError(problem); return; }
          setError(''); onChange(parsed);
        } catch { setError('That is not valid JSON.'); }
      }}/>
    {error && <p role="alert" className="w2-error-text">{error}</p>}
  </div>;
}
