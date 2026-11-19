import type { SimulationCase } from '../../shared/composition/graph/types';
import { parseScenarios, storeSchema, STORE_LIMIT } from './contracts';

export const scenarioKey = (documentId: string, canvasId: string): string => `sh-studio.logic-scenarios.v1:${documentId}:${canvasId}`;
export interface ScenarioStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: string };
export function loadScenarios(documentId: string, canvasId: string, storage?: ScenarioStorage): StorageResult<SimulationCase[]> {
  try {
    const text = (storage ?? localStorage).getItem(scenarioKey(documentId, canvasId));
    return { ok: true, value: text === null ? [] : parseScenarios(text) };
  } catch { return { ok: false, error: "Saved scenarios couldn't be loaded. Stored data was left unchanged." }; }
}
export function saveScenarios(documentId: string, canvasId: string, scenarios: readonly SimulationCase[], storage?: ScenarioStorage): StorageResult<string> {
  try {
    const valid = storeSchema.parse({ version: 1, scenarios });
    const text = JSON.stringify(valid);
    if (new TextEncoder().encode(text).length > STORE_LIMIT) return { ok: false, error: 'Scenarios exceed the 256 KiB canvas limit. The unsaved scenario remains in memory.' };
    (storage ?? localStorage).setItem(scenarioKey(documentId, canvasId), text);
    return { ok: true, value: text };
  } catch { return { ok: false, error: "Scenarios weren't saved (invalid data, unavailable storage, or quota exceeded). Keep this view open to retry or export." }; }
}
