import { useState } from 'react';
import { request } from '../../api';
import type { StateRequest } from '../../shared/composition/state-styles';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import { useStyle } from './useStyle';

type Check = boolean | 'checking' | 'failed';

/**
 * One number of the request, in seconds. A number out of its range still goes into the draft and the simulator, so the next edit
 * is never held up; the caption then says what to use, Checks lists it, and Save and Publish wait.
 */
function Seconds({ label, value, min, max, disabled, onSet }: { label: string; value: number; min: number; max: number; disabled?: boolean; onSet: (next: number) => void }) {
  const outside = !Number.isInteger(value) || value < min || value > max;
  return <div className="w2-row"><div className="field"><span>{label}</span>
    <TextInput label={label} number value={String(value)} disabled={disabled} onCommit={text => { const next = Number(text); if (text.trim() !== '' && Number.isFinite(next)) onSet(next); }}/></div>
    <p className={outside ? 'w2-caption w2-error-text' : 'w2-caption'} data-field-problem={outside ? label : undefined}>Seconds, {min} to {max}.</p></div>;
}

/**
 * How a tap ends, for every tile that uses the style: the waits, what happens when the answer never arrives, the words, and the
 * Home Assistant script and error timer the lifecycle reads (the Studio checks they exist and installs neither). The sending words are
 * read-only.
 */
export function RequestPage({ id }: { id: string }) {
  const { style, readOnly, edit } = useStyle(id);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  if (!style) return <p className="w2-empty">This style is no longer in the project.</p>;
  const settings = style.request;
  if (!settings) return <div className="w2-row"><p className="w2-caption">This style has no request phase: a tap shows no sending words and no wait.</p>
    {!readOnly && <button type="button" onClick={() => edit({ ...style, request: { lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 4, onTimeout: 'error' } })}>Add a Request Phase</button>}</div>;
  const update = (change: Partial<StateRequest>, group = `request:${id}`) => {
    const next = { ...settings, ...change };
    for (const key of Object.keys(next) as (keyof typeof next)[]) if (next[key] === undefined || (next[key] as unknown) === '') delete next[key];
    edit({ ...style, request: next }, group);
  };
  const check = async (value: string) => {
    setChecks(old => ({ ...old, [value]: 'checking' }));
    try { const { exists } = await request<{ exists: boolean }>(`/native/api/ha/exists?id=${encodeURIComponent(value)}`); setChecks(old => ({ ...old, [value]: exists })); }
    catch { setChecks(old => ({ ...old, [value]: 'failed' })); }
  };
  const lifecycle = (label: string, kind: 'script' | 'timer', value: string | undefined, set: (next: string | undefined) => void) => {
    const result = value ? checks[value] : undefined;
    return <div className="w2-row"><div className="field"><span>{label}</span>
      <div className="w2-layer-control"><TextInput label={label} value={value ?? ''} placeholder={`${kind}.name`} disabled={readOnly} onCommit={next => set(next || undefined)}/>
        {value && !readOnly && <button type="button" onClick={() => void check(value)} disabled={result === 'checking'}>Check</button>}</div></div>
      {result === true && <p role="status" className="w2-caption w2-ok-text">{value} exists in Home Assistant.</p>}
      {result === false && <p role="alert" className="w2-caption w2-warn-line">{value} does not exist in Home Assistant. Create it there; the Studio installs nothing.</p>}
      {result === 'failed' && <p role="alert" className="w2-caption w2-warn-line">Home Assistant could not be asked whether {value} exists.</p>}
    </div>;
  };
  const oneMissing = Boolean(settings.script) !== Boolean(settings.errorTimer);
  return <div className="w2-request-page">
    <Seconds label="Ignore taps for" value={settings.lockoutSeconds} min={0} max={60} disabled={readOnly} onSet={lockoutSeconds => update({ lockoutSeconds })}/>
    <Seconds label="Wait for an answer" value={settings.ackTimeoutSeconds} min={1} max={120} disabled={readOnly} onSet={ackTimeoutSeconds => update({ ackTimeoutSeconds })}/>
    <Seconds label="Wait for the new state" value={settings.settleTimeoutSeconds} min={0} max={600} disabled={readOnly} onSet={settleTimeoutSeconds => update({ settleTimeoutSeconds })}/>
    <Seconds label="Keep the error up" value={settings.errorHoldSeconds} min={0} max={60} disabled={readOnly} onSet={errorHoldSeconds => update({ errorHoldSeconds })}/>
    <div className="w2-row"><div className="field"><span>If it never arrives</span>
      <SelectMenu label="If it never arrives" value={settings.onTimeout} disabled={readOnly} options={[{ value: 'error', label: 'Show an Error' }, { value: 'revert', label: 'Go Back to the State' }]}
        onChange={onTimeout => update({ onTimeout: onTimeout as StateRequest['onTimeout'] }, `request-timeout:${id}`)}/></div></div>
    <div className="w2-row"><div className="field"><span>Error words</span>
      <TextInput label="Error words" value={settings.errorWords ?? ''} maxLength={80} disabled={readOnly} onCommit={errorWords => update({ errorWords })}/></div></div>
    <section aria-label="Sending words"><h3 className="w2-group-title">Sending words</h3>
      {settings.pendingWords?.length ? <ul className="w2-pending-words">{settings.pendingWords.map(item => <li key={item.service}><span className="w2-readonly">{item.service}: {item.text}</span></li>)}</ul> : <p className="w2-caption">None.</p>}
      <p className="w2-caption">These words come with the style.</p></section>
    {lifecycle('Script', 'script', settings.script, script => update({ script }))}
    {lifecycle('Error timer', 'timer', settings.errorTimer, errorTimer => update({ errorTimer }))}
    {oneMissing && <p role="alert" className="w2-caption w2-warn-line">Name the script and the error timer together, or neither.</p>}
    <p className="w2-caption">The lifecycle asks for a script and an error timer that already exist in Home Assistant. The Studio checks that they exist and warns when one is missing. It installs nothing.</p>
  </div>;
}
