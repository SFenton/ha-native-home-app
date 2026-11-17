// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, valueAt, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { climateCapabilities, type ClimateProps } from '../src/shared/composition/climate';
import { CompositionValidationError } from '../src/shared/composition/json';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';

const common = {
  sourceId: 'source-zone', icon: 'thermometer', hint: 'Authored hint',
  loadingText: 'Reading climate', unavailableText: 'Climate unavailable', errorText: 'Command failed',
};
const choice = { value: 'eco', label: 'Economy', icon: 'leaf', detail: 'Authored explanation' };
const props: ClimateProps[] = [
  { ...common, kind: 'dial', dial: { minimum: 5, maximum: 35, step: 0.5, unit: '°C', size: 'modal' } },
  { ...common, kind: 'toggle' }, { ...common, kind: 'explicit-switch' },
  { ...common, kind: 'mode', choices: [choice] }, { ...common, kind: 'fan', choices: [choice] },
  { ...common, kind: 'preset', choices: [choice] }, { ...common, kind: 'options', choices: [choice] },
  { ...common, kind: 'status', status: { projection: 'indoor', unit: '°C', states: [], fallbackText: 'No prediction' } },
  { ...common, kind: 'hub', hub: { modeLabel: 'Zone Mode', fanLabel: 'Zone Fan', modes: [choice], fans: [] } },
  { ...common, kind: 'notice', notice: {
    useEffectiveMode: true, isWarning: false, awayText: 'Away active', vacationText: 'Vacation active',
    unknownText: 'Unknown mode', unavailableModeText: 'No mode', reasonFallback: 'No reason', separator: ' / ',
  } },
  { ...common, kind: 'check' },
  { ...common, kind: 'link', status: { projection: 'state', unit: '°C', states: [], fallbackText: 'Unknown' } },
  { ...common, kind: 'room-tile', paletteIndex: 2 },
];
function fixture() {
  const document = createCompositionDocument('synthetic-climate');
  document.pages[0].components = props.map((props, i): CompositionNode => {
    const sourceId = `source-${i}`;
    const domain = props.kind === 'toggle' || props.kind === 'check' || props.kind === 'explicit-switch' ? 'switch' : props.kind === 'options' ? 'select' : 'climate';
    document.dataSources.push({
      id: sourceId, kind: 'model', model: 'climate@1',
      inputs: { entityId: `${domain}.demo_zone`, rangeCommitEntityIds: [], ...(props.kind === 'notice' ? { homeAway: {
        modeEntityId: 'sensor.demo_mode', reasonEntityId: 'sensor.demo_reason',
        fallbackEntityId: 'binary_sensor.demo_away', vacationEntityId: 'input_boolean.demo_vacation',
      } } : {}), ...(props.kind === 'room-tile' ? { sensorEntityId: 'sensor.demo_temperature', occupancyEntityId: 'sensor.demo_occupancy' } : {}) },
    });
    return { id: `control-${i}`, title: `Zone ${i}`, type: 'climate-control', layout: { span: 1 }, props: { ...props, sourceId },
      ...(['link', 'room-tile'].includes(props.kind) ? { action: { type: 'push' as const, pageId: document.pages[0].id,
        arguments: {}, origin: 'sender' as const, duplicate: 'reuse-nearest' as const } } : {}) };
  });
  return document;
}
function issue(document: unknown, code: string, pointer: string) {
  try { compileCompositionDocument(document); throw Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    expect((error as CompositionValidationError).issues).toContainEqual(expect.objectContaining({ code, pointer }));
  }
}
afterEach(cleanup);
describe('climate composition contract', () => {
  it('negotiates the exact atomic closure and leaves the first slice unchanged', () => {
    const compiled = compileCompositionDocument(fixture());
    expect(compiled.capabilities.filter(value => value.startsWith('sh.climate-'))).toEqual([...climateCapabilities].sort());
    expect(compileCompositionDocument(createCompositionDocument('empty')).capabilities.some(value => value.startsWith('sh.climate-'))).toBe(false);
  });
  it('rejects wrong model references, bounds, duplicate choices and executable fields', () => {
    const document = fixture(), dial = document.pages[0].components[0], mode = document.pages[0].components[3];
    if (dial.type !== 'climate-control' || dial.props.kind !== 'dial' || mode.type !== 'climate-control' || mode.props.kind !== 'mode') throw Error('Fixture');
    dial.props.dial.maximum = 4;
    issue(document, 'invalid_combination', '/document/pages/0/components/0/props/dial');
    dial.props.dial.maximum = 35; dial.props.sourceId = 'source-1';
    issue(document, 'binding_type', '/document/pages/0/components/0/props/sourceId');
    dial.props.sourceId = 'missing';
    issue(document, 'invalid_reference', '/document/pages/0/components/0/props/sourceId');
    dial.props.sourceId = 'source-0'; mode.props.choices.push(choice);
    issue(document, 'invalid_combination', '/document/pages/0/components/3/props/choices');
    mode.props.choices.pop();
    const unknown = { ...document, pages: [{ ...document.pages[0], components: [{ ...dial, props: { ...dial.props, expression: 'run()' } }] }] };
    issue(unknown, 'unknown_field', '/document/pages/0/components/0/props/expression');
  });
  it('validates explicit range targets, tracking gates and nonpublishable sibling capabilities', () => {
    const document = fixture(), source = document.dataSources[0];
    if (source.kind !== 'model' || source.model !== 'climate@1') throw Error('Fixture');
    source.inputs.rangeCommitEntityIds = ['light.demo_other'];
    issue(document, 'invalid_combination', '/document/dataSources/0/inputs/rangeCommitEntityIds/0');
    source.inputs.rangeCommitEntityIds = [];
    source.inputs.trackingGate = { selectedEntityId: 'switch.demo_enabled', criticalEntityId: 'select.demo_policy' };
    issue(document, 'invalid_combination', '/document/dataSources/0/inputs/trackingGate');
    delete source.inputs.trackingGate;
    issue({ ...document, pages: [{ ...document.pages[0], components: [{ id: 'panes', title: 'Split sections', type: 'section-sides' }] }] },
      'unsupported_capability', '/document/pages/0/components/0');
  });
  it('requires injected away inputs and distinct typed tracking targets', () => {
    const document = fixture(), source = document.dataSources[9];
    if (source?.kind !== 'model' || source.model !== 'climate@1') throw Error('Fixture');
    delete source.inputs.homeAway;
    issue(document, 'binding_type', '/document/pages/0/components/9/props/sourceId');
    const tracking = document.dataSources[1];
    if (tracking.kind !== 'model' || tracking.model !== 'climate@1') throw Error('Fixture');
    document.pages[0].components.splice(9, 1); document.dataSources.splice(9, 1);
    tracking.inputs.tracking = { policyEntityId: 'select.demo_policy', criticalOption: 'Critical', rooms: [{
      selectedEntityId: 'switch.demo_selected', criticalEntityId: 'switch.demo_critical', occupiedOnlyEntityId: 'switch.demo_occupied',
    }] };
    expect(() => compileCompositionDocument(document)).not.toThrow();
    tracking.inputs.tracking.rooms[0].criticalEntityId = 'switch.demo_selected';
    issue(document, 'invalid_combination', '/document/dataSources/1/inputs/tracking/rooms/0/criticalEntityId');
  });
  it('authors dial bounds, units, targets and ordered choices through generated controls', () => {
    const document = fixture();
    const nodeSchema = nodeDefinition();
    if (!nodeSchema) throw Error('Missing component schema');
    const climate = fieldVariants(nodeSchema).find(variant => variant.properties?.type?.const === 'climate-control');
    const schema = climate?.properties?.props;
    if (!schema) throw Error('Missing climate inspector');
    let updated: CompositionDocument | undefined;
    render(<CompositionFields schema={schema} value={JSON.parse(JSON.stringify((document.pages[0].components[0] as { props: unknown }).props))}
      path={['pages', 0, 'components', 0, 'props']} label="Climate" document={document}
      onChange={next => { updated = next; }} onError={message => { throw Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: '°F' } });
    expect(valueAt(updated, ['pages', 0, 'components', 0, 'props', 'dial', 'unit'])).toBe('°F');
    expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Minimum').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Size').tagName).toBe('SELECT');
  });
  it('authors notice copy and optional tracking inputs without raw JSON', () => {
    const document = fixture(), sourceSchema = compositionEditorSchema.properties!.dataSources.items;
    if (!sourceSchema || Array.isArray(sourceSchema)) throw Error('Missing source schema');
    const source = fieldVariants(sourceSchema).find(variant => variant.properties?.model?.const === 'climate@1');
    if (!source?.properties?.inputs) throw Error('Missing climate source inspector');
    const sourceValue = document.dataSources[1];
    if (sourceValue.kind !== 'model' || sourceValue.model !== 'climate@1') throw Error('Fixture');
    let updated: CompositionDocument | undefined;
    render(<CompositionFields schema={source.properties.inputs} value={JSON.parse(JSON.stringify(sourceValue.inputs))}
      path={['dataSources', 1, 'inputs']} label="Climate Inputs" document={document}
      onChange={next => { updated = next; }} onError={message => { throw Error(message); }}/>);
    fireEvent.click(screen.getByLabelText('Include Tracking'));
    expect(valueAt(updated, ['dataSources', 1, 'inputs', 'tracking'])).toHaveProperty('rooms');
    cleanup();
    const nodeSchema = nodeDefinition();
    const climate = nodeSchema && fieldVariants(nodeSchema).find(variant => variant.properties?.type?.const === 'climate-control');
    if (!climate?.properties?.props) throw Error('Missing climate inspector');
    render(<CompositionFields schema={climate.properties.props} value={JSON.parse(JSON.stringify((document.pages[0].components[9] as { props: unknown }).props))}
      path={['pages', 0, 'components', 9, 'props']} label="Climate" document={document}
      onChange={next => { updated = next; }} onError={message => { throw Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Away Text'), { target: { value: 'Authored energy notice' } });
    expect(valueAt(updated, ['pages', 0, 'components', 9, 'props', 'notice', 'awayText'])).toBe('Authored energy notice');
  });
});
