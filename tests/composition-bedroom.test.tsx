// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { bedroomKinds, bedroomProviders, bedroomPropsSchema, bedroomWeekdays, bedroomRamps, bedroomHolds } from '../src/shared/composition/bedroom';
import { compositionNodeSchema, type CompositionNode } from '../src/shared/composition/schema';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { compositionEditorSchema, defaultField, fieldVariants, variantName } from '../src/composition-editor';
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
    const nodeSchema = compositionEditorSchema.definitions?.__schema0;
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
