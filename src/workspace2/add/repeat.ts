import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { requestShape, type PipelineRequest } from '../../shared/composition/pipeline';
import { createId as uid } from '../../shared/ids';

type Source = CompositionDocument['dataSources'][number];

/** The records flows of a document: the sources whose output is `records`, which a repeat can read. */
export function recordsFlows(document: Pick<CompositionDocument, 'dataSources'>): Source[] {
  return document.dataSources.filter(source => source.kind === 'model' && source.model === 'pipeline@1' && (source.inputs as { output?: { kind?: string } }).output?.kind === 'records');
}

/** A starter records flow (`sh.repeat@1`): one record for each listed entity, so it compiles and draws before the person has shaped it. */
export function starterRecordsFlow(entityId = 'sensor.example'): Source {
  const request: PipelineRequest = { type: 'entities', entityIds: [{ type: 'literal', value: entityId }], attributes: [] };
  return {
    id: `records-${uid('f').replace(/^f-?/, '').slice(0, 6)}`, kind: 'model', model: 'pipeline@1',
    inputs: { title: 'Records', parameters: [], request, steps: [], output: { kind: 'records', max: 24 }, schema: requestShape(request) },
  } as Source;
}

/**
 * A new `repeat` (`sh.repeat@1`): it reads the first records flow of the document; with none, it starts one over the entity given (the entities request, one
 * record for each listed entity), so a new repeat always compiles. Its cell is one text of the record's entity, which the person edits. Nothing here is named for a card.
 */
export function newRepeat(document: Pick<CompositionDocument, 'dataSources'>, entityId = 'sensor.example'): { node: CompositionNode; sources: Source[] } {
  const found = recordsFlows(document)[0];
  const created: Source[] = [];
  let providerId = found?.id;
  if (!providerId) { const flow = starterRecordsFlow(entityId); providerId = flow.id; created.push(flow); }
  const id = (prefix: string) => `${prefix}-${uid('n').replace(/^n-?/, '').slice(0, 8)}`;
  const cell = {
    id: id('text'), title: 'Item', layout: { span: 1 }, type: 'text' as const,
    props: { value: { type: 'expr' as const, value: { type: 'item' as const, path: ['entityId'] } }, style: 'body' as const, unavailableText: 'Unavailable' },
  };
  const node = {
    id: id('repeat'), title: 'New repeat', layout: { span: 1 }, type: 'repeat' as const,
    props: {
      providerId, axis: 'horizontal' as const, spacing: { type: 'token' as const, name: 's' as const },
      loadingText: 'Loading', emptyText: 'Nothing here', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date',
    },
    children: [cell],
  } as CompositionNode;
  return { node, sources: created };
}
