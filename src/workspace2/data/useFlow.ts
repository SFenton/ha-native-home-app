import { useCallback } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { PipelineInputs, PipelineSource } from '../../shared/composition/pipeline';
import { useRows } from '../rowsContext';
import { flowById, updateFlow } from './flow';

/** The open flow, and a way to change its inputs as one document change (its schema follows its steps). */
export function useFlow(id: string): { document: CompositionDocument; source?: PipelineSource; inputs?: PipelineInputs; edit: (change: (inputs: PipelineInputs) => PipelineInputs, group?: string) => void; onError: (message: string) => void } {
  const { document, onChange, onError } = useRows();
  const source = flowById(document, id);
  const edit = useCallback((change: (inputs: PipelineInputs) => PipelineInputs, group?: string) => onChange(updateFlow(document, id, change), group), [document, id, onChange]);
  return { document, source, inputs: source?.inputs, edit, onError };
}
