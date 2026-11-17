/** Edit and Use. */
export function ModeSegment({ mode, onChange }: { mode: 'edit' | 'use'; onChange: (mode: 'edit' | 'use') => void }) {
  return <div className="w2-segment-pill" role="group" aria-label="Mode">
    {(['edit', 'use'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => onChange(item)}>{item === 'edit' ? 'Edit' : 'Use'}</button>)}
  </div>;
}
