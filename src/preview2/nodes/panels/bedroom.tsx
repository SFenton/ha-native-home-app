import { Glyph, type NodeOf } from '../shared';

type Props = NodeOf<'bedroom-control'>['props'];
const hasOptions = (props: Props): props is Extract<Props, { options: readonly { label: string }[] }> => 'options' in props;

/** A labelled row with a value on the right, the bedroom's resting look until the provider reports. */
function ValueRow({ label, children }: { label: string; children?: React.ReactNode }) {
  return <div className="sh-control sh-control-row"><span className="sh-row-primary">{label}</span>{children ?? <span className="sh-row-value">--</span>}</div>;
}
const Switch = ({ label }: { label: string }) => <span className="sh-switch" role="switch" aria-checked={false} aria-label={label}><span/></span>;

/**
 * `bedroom-control`: one control of the bedroom screens (`UKServerUIBedroomControl`). The kinds draw by shape: tiles for
 * the bed, wake light and add-alarm entries, a segmented choice for ramps, holds, weekdays and kinds, a switch for power and
 * enabled, a field for the name, a button for the actions, and a line of text for readings and feedback. The bedroom
 * providers are not read in the preview, so values show as `--` until the app has them.
 */
export function BedroomControlNode({ node }: { node: NodeOf<'bedroom-control'> }) {
  const { props } = node;
  const label = props.label;
  if (props.control === 'bed-tile' || props.control === 'wake-tile' || props.control === 'alarm-add') {
    return <div className="sh-tile" role="group" aria-label={label}><span className="sh-tile-title">{label}</span><span className="sh-tile-line">{props.unavailableText}</span></div>;
  }
  if (props.control === 'bed-mode') {
    return <div className="sh-tile" role="group" aria-label={label}><span className="sh-tile-glyph"><Glyph symbol={props.icon} size={24}/></span>
      <span className="sh-tile-title">{label}</span><span className="sh-tile-line">{props.inactiveLabel}</span></div>;
  }
  if (hasOptions(props)) {
    const heading = 'showsHeading' in props && props.showsHeading === false ? null : <span className="sh-row-primary">{label}</span>;
    return <div className="sh-device">{heading}<span className={`sh-segments ${props.control === 'alarm-weekdays' ? 'sh-weekdays' : ''}`} role="radiogroup" aria-label={label}>
      {props.options.map(option => <span key={option.value} role="radio" aria-checked={false}>{option.label}</span>)}</span></div>;
  }
  switch (props.control) {
    case 'bed-power': case 'alarm-enabled': case 'alarm-wake-link': return <ValueRow label={label}><Switch label={label}/></ValueRow>;
    case 'alarm-save': return <span className="sh-primary-button" role="group" aria-label={label}>{label}</span>;
    case 'alarm-delete': return <span className="sh-primary-button sh-destructive" role="group" aria-label={label}>{label}</span>;
    case 'alarm-reload': case 'bed-snooze': case 'bed-stop': case 'wake-stop': return <span className="sh-secondary-button" role="group" aria-label={label}>{label}</span>;
    case 'alarm-name': return <div className="sh-device">{props.showsHeading === false ? null : <span className="sh-row-primary">{label}</span>}<span className="sh-field-box" aria-label={label}/></div>;
    case 'alarm-feedback': return <p className="sh-device-footnote" role="note">{label}</p>;
    case 'wake-summary': return <div className="sh-info" role="note">{label}</div>;
    default: return <ValueRow label={label}/>;
  }
}
