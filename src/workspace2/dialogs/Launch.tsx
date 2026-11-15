import { Field, TextField } from '../../ui';
import { replaceAt } from '../../composition-editor';
import { useRows } from '../rows';
import { FieldRow } from './parts';

/** The texts a new launch block starts with. */
const starting = {
  type: 'native-bootstrap@1' as const, arrivalAnnouncement: 'Your home is ready.',
  recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable', unavailableMessage: 'Try again in a moment.', retryLabel: 'Try Again' },
  setup: [
    { permission: 'notifications' as const, explanation: 'Choose whether this device can receive home alerts.' },
    { permission: 'time-sensitive' as const, explanation: 'Review how urgent home alerts reach this device.' },
    { permission: 'location' as const, explanation: 'Choose whether to share this device location with Home Assistant.' },
  ],
};
const permissionWords = { notifications: 'Notifications', 'time-sensitive': 'Time Sensitive', location: 'Location' } as const;
const recoveryRows = [['loadingTitle', 'Loading title'], ['unavailableTitle', 'Unavailable title'], ['unavailableMessage', 'Unavailable message'], ['retryLabel', 'Retry button']] as const;

/** Project > App Launch (spec 5.7): a switch for custom launch text and, when on, its rows. */
export default function Launch() {
  const { document, onChange } = useRows();
  const launch = document.bootstrap;
  const toggle = (on: boolean) => {
    const next = structuredClone(document);
    if (on) next.bootstrap = structuredClone(starting); else delete next.bootstrap;
    onChange(next);
  };
  const text = (path: (string | number)[], label: string, long = false) => <FieldRow path={['bootstrap', ...path]} key={path.join('/')}>
    {long ? <Field label={label}><textarea rows={3} value={String(path.reduce<unknown>((value, key) => (value as Record<string | number, unknown>)[key], launch) ?? '')} maxLength={2000}
      onChange={event => onChange(replaceAt(document, ['bootstrap', ...path], event.target.value))}/></Field>
      : <TextField label={label} value={String(path.reduce<unknown>((value, key) => (value as Record<string | number, unknown>)[key], launch) ?? '')} maxLength={160}
        onChange={value => onChange(replaceAt(document, ['bootstrap', ...path], value))}/>}
  </FieldRow>;
  return <>
    <FieldRow path={['bootstrap']}><label className="w2-switch-row"><span className="w2-row-label">Custom launch text</span>
      <input type="checkbox" role="switch" checked={Boolean(launch)} onChange={event => toggle(event.target.checked)}/></label></FieldRow>
    {launch && <>
      {text(['arrivalAnnouncement'], 'Ready announcement')}
      {recoveryRows.map(([key, label]) => text(['recovery', key], label, key === 'unavailableMessage'))}
      <section aria-label="Why we ask" className="w2-group"><h3 className="w2-group-title">Why we ask</h3>
        {launch.setup.map((item, at) => <div key={item.permission}>
          <span hidden data-field-path={`bootstrap/setup/${at}/permission`}/>
          {text(['setup', at, 'explanation'], permissionWords[item.permission], true)}
        </div>)}
      </section>
    </>}
  </>;
}
