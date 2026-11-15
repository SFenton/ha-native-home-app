// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { bedroomKinds, bedroomProviders, bedroomPropsSchema, bedroomWeekdays, bedroomRamps, bedroomHolds } from '../src/shared/composition/bedroom';
import { compositionNodeSchema, type CompositionNode } from '../src/shared/composition/schema';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { compositionEditorSchema, defaultField, fieldVariants, variantName, nodeDefinition } from '../src/composition-editor';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import CompositionFields from '../src/CompositionFields';

afterEach(cleanup);
const question = { title: 'Confirm?', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel' };
const scope = { title: 'Apply level?', message: '', tonightLabel: 'Tonight', allNightsLabel: 'All nights', cancelLabel: 'Cancel' };
function props(control: typeof bedroomKinds[number]): Extract<CompositionNode, { type: 'bedroom-control' }>['props'] {
  const options = control === 'alarm-weekdays' ? bedroomWeekdays : control === 'alarm-kind' ? ['weekly', 'once']
    : control === 'wake-hold' ? bedroomHolds : bedroomRamps;
  const value = {
    control, sourceId: 'source-bedroom', label: 'Synthetic control', unavailableText: 'Unavailable',
    ...(['bed-mode', 'bed-power'].includes(control) ? { activeLabel: 'Stop' } : {}),
    ...(control === 'bed-mode' ? { icon: { type: 'sf-symbol', name: 'snowflake', rendering: 'canonical', unavailable: 'reject' },
      family: 'cooling', inactiveLabel: 'Inactive', countdownSuffix: 'remaining' } : {}),
    ...(control === 'bed-stage' ? { parameter: 'asleep' } : {}),
    ...(control === 'alarm-bed-target' ? { parameter: 'left' } : {}),
    ...(control === 'alarm-feedback' ? { parameter: 'error' } : {}),
    ...(['bed-tile', 'wake-tile', 'alarm-add'].includes(control) ? { action: { type: 'push', pageId: 'page-editor', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } } : {}),
    ...(control === 'bed-reading' ? { parameter: 'pump-status', activeLabel: 'Check synthetic pump', inactiveLabel: 'Synthetic pump ready' } : {}),
    ...(['wake-ramp', 'wake-hold', 'alarm-weekdays', 'alarm-kind', 'alarm-ramp'].includes(control)
      ? { options: [...options].reverse().map(value => ({ value, label: `Choice ${value}` })) } : {}),
    ...(['bed-power', 'alarm-delete'].includes(control) ? { confirmation: question } : {}),
    ...(['bed-target', 'bed-stage'].includes(control) ? { scope } : {}),
  };
  const node = compositionNodeSchema.parse({ id: 'test', title: 'Test', type: 'bedroom-control', layout: { span: 1 }, props: value });
  if (node.type !== 'bedroom-control') throw new Error('bedroom fixture');
  return node.props;
}
function fixture(control: typeof bedroomKinds[number]) {
  const document = createCompositionDocument('synthetic-bedroom');
  document.pages[0].id = 'page-editor';
  document.navigation.initialPageId = 'page-editor';
  document.dataSources = [{ id: 'source-bedroom', kind: 'model', model: 'bedroom-provider@1',
    inputs: { providerId: 'synthetic-provider', kind: z.enum(['bed-side', 'wake-light', 'bed-alarm-draft', 'wake-alarm-draft']).parse(bedroomProviders(control)[0]) } }];
  document.pages[0].components = [{ id: 'bedroom-atom', title: 'Synthetic control', type: 'bedroom-control', layout: { span: 1 }, props: props(control) }];
  return document;
}
describe('bedroom atomic contract', () => {
  it('authors negotiated wake confirmation fields and rejects unknown fields or another provider kind', () => {
    const document = fixture('alarm-delete');
    const node = document.pages[0].components[0];
    if (node.type !== 'bedroom-control' || node.props.control !== 'alarm-delete') throw new Error('fixture');
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.wake-alarm-confirmation@1');
    node.props.confirmation = { ...question, message: 'Set for {time} on {schedule}.', messageFormat: 'wake-alarm' };
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    document.dataSources[0] = { id: 'source-bedroom', kind: 'model', model: 'bedroom-provider@1',
      inputs: { providerId: 'synthetic-provider', kind: 'wake-alarm-draft' } };
    expect(compileCompositionDocument(document).capabilities).toContain('sh.wake-alarm-confirmation@1');
    expect(bedroomPropsSchema.safeParse({ ...props('bed-power'), confirmation: node.props.confirmation }).success).toBe(false);
    for (const message of ['At {unknown}.', 'At {time.']) {
      node.props.confirmation.message = message;
      expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    }
    node.props.confirmation.message = 'Set for {time} on {schedule}.';
    const bedroom = fieldVariants(nodeDefinition()).find(variant =>
      variant.properties?.type?.const === 'bedroom-control')!;
    const schema = fieldVariants(bedroom.properties!.props).find(variant => variantName(variant) === 'alarm-delete')!;
    let updated = document;
    render(<CompositionFields schema={schema} value={node.props} path={['pages', 0, 'components', 0, 'props']}
      label="Delete" document={document} onChange={next => { updated = next; }} onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '{schedule}, at {time}.' } });
    expect(updated.pages[0].components[0]).toMatchObject({
      props: { confirmation: { message: '{schedule}, at {time}.', messageFormat: 'wake-alarm' } },
    });
    expect(compileCompositionDocument(updated).capabilities).toContain('sh.wake-alarm-confirmation@1');
  });

  it('negotiates optional field headings and editable visible/spoken weekday labels', () => {
    const document = fixture('alarm-name');
    const node = document.pages[0].components[0];
    if (node.type !== 'bedroom-control' || node.props.control !== 'alarm-name') throw new Error('fixture');
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.bedroom-field-headings@1');
    node.props.showsHeading = true;
    expect(compileCompositionDocument(document).capabilities).toContain('sh.bedroom-field-headings@1');
    expect(bedroomPropsSchema.safeParse({ ...props('alarm-enabled'), showsHeading: true }).success).toBe(false);
    const days = fixture('alarm-weekdays');
    const picker = days.pages[0].components[0];
    if (picker.type !== 'bedroom-control' || picker.props.control !== 'alarm-weekdays') throw new Error('fixture');
    picker.props.options[0].accessibilityLabel = 'Saturday';
    picker.props.options[0].label = 'Sat';
    expect(compileCompositionDocument(days).capabilities).toContain('sh.weekday-accessibility-labels@1');
    const bedroom = fieldVariants(nodeDefinition()).find(variant =>
      variant.properties?.type?.const === 'bedroom-control')!;
    const schema = fieldVariants(bedroom.properties!.props).find(variant => variantName(variant) === 'alarm-weekdays')!;
    let updated = days;
    render(<CompositionFields schema={schema} value={picker.props} path={['pages', 0, 'components', 0, 'props']}
      label="Days" document={days} onChange={next => { updated = next; }} onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByDisplayValue('Saturday'), { target: { value: 'Spoken Saturday' } });
    const updatedPicker = updated.pages[0].components[0];
    if (updatedPicker.type !== 'bedroom-control' || updatedPicker.props.control !== 'alarm-weekdays') throw new Error('fixture');
    expect(updatedPicker.props.options[0]).toMatchObject({ label: 'Sat', accessibilityLabel: 'Spoken Saturday' });
  });

  it('admits a surface title only from its own typed editor, not a live or unowned source', () => {
    const document = fixture('alarm-name');
    document.pages[0].titleSourceId = 'source-bedroom';
    expect(compileCompositionDocument(document).capabilities).toContain('sh.surface-title-source@1');
    document.pages[0].titleSourceId = 'unowned-source';
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    const live = fixture('wake-stop');
    live.pages[0].titleSourceId = 'source-bedroom';
    expect(() => compileCompositionDocument(live)).toThrow(CompositionValidationError);
  });

  it('negotiates the complete active-episode presentation only when authored', () => {
    const document = fixture('wake-stop');
    const node = document.pages[0].components[0];
    if (node.type !== 'bedroom-control' || node.props.control !== 'wake-stop') throw new Error('fixture');
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.wake-episode@1');
    node.props.episode = { heading: 'Wake In Progress', detail: 'End this wake.', pendingLabel: 'Ending Wake' };
    expect(compileCompositionDocument(document).capabilities).toContain('sh.wake-episode@1');
    expect(bedroomPropsSchema.safeParse({ ...props('wake-ramp'), episode: node.props.episode }).success).toBe(false);
    expect(bedroomPropsSchema.safeParse({ ...node.props, episode: { heading: 'Wake In Progress', detail: 'End this wake.' } }).success).toBe(false);
    const bedroom = fieldVariants(nodeDefinition()).find(variant =>
      variant.properties?.type?.const === 'bedroom-control');
    const stop = fieldVariants(bedroom!.properties!.props).find(variant => variantName(variant) === 'wake-stop')!;
    let updated = document;
    render(<CompositionFields schema={stop} value={node.props} path={['pages', 0, 'components', 0, 'props']}
      label="Wake Stop" document={document} onChange={next => { updated = next; }}
      onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'My Active Wake' } });
    expect(updated.pages[0].components[0]).toMatchObject({ props: { episode: { heading: 'My Active Wake' } } });
    expect(screen.getByLabelText('Pending Label')).toBeTruthy();
  });

  it('negotiates an optional canonical hold explanation without changing existing controls', () => {
    const document = fixture('wake-hold');
    const node = document.pages[0].components[0];
    if (node.type !== 'bedroom-control' || node.props.control !== 'wake-hold') throw new Error('fixture');
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.wake-hold-explanation@1');
    node.props.showsExplanation = true;
    expect(compileCompositionDocument(document).capabilities).toContain('sh.wake-hold-explanation@1');
    expect(bedroomPropsSchema.safeParse({ ...props('wake-ramp'), showsExplanation: true }).success).toBe(false);
  });

  it('negotiates authored linked-bed routes and rejects duplicate sides or non-row templates', () => {
    const document = fixture('wake-tile');
    const value = compositionNodeSchema.parse({ id: 'linked-schedule', title: 'Wake Alarms', type: 'collection', layout: { span: 1 },
      props: { providerId: 'synthetic-provider.alarms', template: 'rows', loadingText: 'Loading', emptyText: 'No alarms',
        bedroomLinks: [{ side: 'left', label: 'Open Linked-Device Alarm Editor',
          action: { type: 'push', pageId: 'page-editor', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }] } });
    if (value.type !== 'collection' || !value.props.bedroomLinks) throw new Error('fixture');
    document.pages[0].components = [value];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.bedroom-collection-links@1');
    value.props.bedroomLinks.push({ ...value.props.bedroomLinks[0] });
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    value.props.bedroomLinks.pop();
    value.props.template = 'inventory';
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
  });

  it.each(bedroomKinds)('compiles %s with exact capability closure and authored order', control => {
    const document = fixture(control);
    expect(compileCompositionDocument(document).capabilities).toEqual([
      'sh.backdrop@1', 'sh.bedroom-sources@1', 'sh.bindings@1', 'sh.chrome@1', 'sh.composition@1',
      'sh.page@1', 'sh.shell@1', 'sh.symbols@1', `sh.${control}@1`,
      ...(['bed-tile', 'wake-tile', 'alarm-add'].includes(control) ? ['sh.actions.navigation@1'] : []),
    ].sort());
    expect(compositionNodeSchema.parse(document.pages[0].components[0])).toEqual(document.pages[0].components[0]);
  });
  it('rejects source mismatches, missing mandatory power confirmation and duplicate/incomplete days', () => {
    const document = fixture('bed-power');
    document.dataSources[0] = { id: 'source-bedroom', kind: 'model', model: 'bedroom-provider@1',
      inputs: { providerId: 'synthetic-wake', kind: 'wake-light' } };
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    const power = props('bed-power');
    expect(bedroomPropsSchema.safeParse({ ...power, confirmation: undefined }).success).toBe(false);
    const days = fixture('alarm-weekdays');
    const node = days.pages[0].components[0];
    if (node.type !== 'bedroom-control' || node.props.control !== 'alarm-weekdays') throw new Error('fixture');
    node.props.options = [{ value: 'monday', label: 'M' }, { value: 'monday', label: 'M' }];
    expect(() => compileCompositionDocument(days)).toThrow(CompositionValidationError);
  });
  it('does not accept unsupported hold/ramp values or unauthored scope choices', () => {
    expect(bedroomPropsSchema.safeParse({ ...props('wake-hold'), options: [{ value: '0', label: 'None' }] }).success).toBe(false);
    expect(bedroomPropsSchema.safeParse({ ...props('bed-target'), scope: undefined }).success).toBe(false);
  });
  it('offers named domain variants and ordinary inspector fields without raw JSON', () => {
    const document = fixture('bed-power');
    const nodeSchema = nodeDefinition();
    expect(nodeSchema).toBeDefined();
    const bedroom = fieldVariants(nodeSchema!).find(variant => variant.properties?.type?.const === 'bedroom-control');
    const variants = fieldVariants(bedroom!.properties!.props);
    expect(variants.map(variantName).sort()).toEqual([...bedroomKinds].sort());
    expect(defaultField(bedroom!, document)).toMatchObject({ type: 'bedroom-control', props: { control: 'bed-target' } });
    let updated = document;
    render(<CompositionFields schema={variants.find(variant => variantName(variant) === 'bed-power')!}
      value={props('bed-power')} path={['pages', 0, 'components', 0, 'props']} label="Power"
      document={document} onChange={next => { updated = next; }} onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Active Label'), { target: { value: 'Power off this side' } });
    expect(updated.pages[0].components[0]).toMatchObject({ props: { activeLabel: 'Power off this side' } });
    expect(screen.getByLabelText('Confirm Label')).toBeTruthy();
  });
});
