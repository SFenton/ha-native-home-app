import type { CompositionNode } from '../../shared/composition/schema';

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What each dial-control field the inspector draws is called, by its path below the node, as the inspector's own row says it. */
const rows: Record<string, string> = {
  'props/range/min': 'Lowest', 'props/range/max': 'Highest', 'props/range/step': 'Step', 'props/size': 'Size',
  'props/between': 'Rule', 'props/between/gap': 'Gap', 'action': 'Call',
  'props/reading/value': 'Reading', 'props/reading/ink': 'Reading Color',
  'props/ticks': 'Ticks', 'props/ticks/every': 'Every',
  'props/center/top': 'Top Line', 'props/center/value/shows': 'Large Value', 'props/center/value/unit': 'Unit', 'props/center/value/fractionDigits': 'Decimals', 'props/center/caption': 'Caption',
  'props/dimmedWhen': 'Dimmed When', 'enabledWhen/condition': 'Enabled When', 'props/unavailableText': 'Unavailable Text', 'props/failureText': 'Failure Text',
};
/** A stopper's fields, and a band's, by the key below the stopper or the band. */
const stopperRows: Record<string, string> = {
  value: 'Value', label: 'Name for VoiceOver', spokenValue: 'Spoken As', ink: 'Color', trail: 'Trail', trailInk: 'Trail Color',
  'limit/min': 'Lowest', 'limit/max': 'Highest', action: 'When Released',
};
const bandRows: Record<string, string> = { from: 'From', to: 'To', ink: 'Color' };

/**
 * The name of a dial control's field as its inspector row says it, for the Choose Fields box and the Set Per Place words of a template: "Highest",
 * "Value of Low" (a stopper, by its name), "Color of Band 2". A field the inspector does not draw has none, and the generated label stands.
 */
export function dialRowLabel(node: CompositionNode, steps: readonly string[]): string | undefined {
  const field = steps.join('/');
  if (rows[field]) return rows[field];
  const props = (node as unknown as { props?: Obj }).props;
  const stopper = /^props\/stoppers\/(\d+)\/(.+)$/.exec(field);
  if (stopper && stopperRows[stopper[2]]) {
    const held = isObject(props) && Array.isArray(props.stoppers) ? props.stoppers[Number(stopper[1])] : undefined;
    const name = isObject(held) ? (isObject(held.label) && typeof held.label.value === 'string' ? held.label.value : String(held.id ?? Number(stopper[1]) + 1)) : String(Number(stopper[1]) + 1);
    return `${stopperRows[stopper[2]]} of ${name}`;
  }
  const band = /^props\/bands\/(\d+)\/(.+)$/.exec(field);
  if (band && bandRows[band[2]]) return `${bandRows[band[2]]} of Band ${Number(band[1]) + 1}`;
  return undefined;
}
