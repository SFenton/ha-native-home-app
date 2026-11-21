import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { graphSourceSchema } from '../../../src/shared/composition/graph/capabilities';
import { liftField } from '../../../src/workspace2/logic-fields/registry';
import { draftDocument } from '../draft/fixtures';
import type { EditorPath } from '../../../src/composition-editor';

export const demoLights = ['light.demo_office', 'light.demo_kitchen', 'light.demo_gym', 'light.demo_hall'];
export const lightsPath: EditorPath = ['dataSources', 2];
export function lightsDocument() {
  const source = graphSourceSchema.parse({
    id: 'demo-selected-lights', kind: 'model', model: 'pipeline@1',
    inputs: {
      title: 'Selected Lights On', parameters: [],
      request: { type: 'entities', entityIds: demoLights.map(value => ({ type: 'literal', value })), attributes: [] },
      steps: [
        { id: 'on', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: 'on' } } },
        { id: 'labels', op: 'map', fields: {
          id: { type: 'item', path: ['entityId'] },
          title: { type: 'map', of: { type: 'item', path: ['entityId'] },
            cases: demoLights.map((equals, index) => ({ equals, then: { type: 'literal', value: ['Office', 'Kitchen', 'Gym', 'Hall'][index] } })),
            otherwise: { type: 'item', path: ['entityId'] } },
        } },
      ],
      output: { kind: 'rows', max: 4, row: { id: { type: 'item', path: ['id'] }, title: { type: 'item', path: ['title'] }, subtitle: { type: 'literal', value: 'On' } } },
      schema: { kind: 'array', of: { kind: 'object', fields: { id: { shape: { kind: 'string' } }, title: { shape: { kind: 'string' } } } } },
    },
  });
  const document = compileCompositionDocument(draftDocument()).document;
  return compileCompositionDocument({ ...document, dataSources: [...document.dataSources, source] }).document;
}
export const lightsGraph = () => liftField(lightsDocument(), lightsPath, 'flow').graph;
