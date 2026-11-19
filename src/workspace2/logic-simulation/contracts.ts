import { z } from 'zod/v4';
import { wallTime } from '../../shared/composition/pipeline/dates';
import { assertCompositionBounds, canonicalCompositionJSON, parseCompositionJSON } from '../../shared/composition/json';
import type { ReadCapture, SimulationCase, SimulationPin } from '../../shared/composition/graph/types';

const object = z.strictObject;
const id = z.string().min(1).max(256);
const field = z.string().max(4096).regex(/^(?:\/(?:[^~]|~[01])*)*$/);
export const anchorSchema = z.union([
  object({ kind: z.enum(['page', 'modal', 'component', 'logic', 'flow']), id, nodeId: id.optional(), field }),
  object({ kind: z.literal('document'), id, field, fingerprint: z.string().min(1) }),
]);
export const clockSchema = object({
  now: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/),
  utcOffsetMinutes: z.number().int().min(-840).max(840),
}).refine(clock => Boolean(wallTime(clock.now, clock.utcOffsetMinutes)), 'Enter a valid ISO local clock and UTC offset.');
const answer = z.discriminatedUnion('status', [
  object({ status: z.literal('value'), value: z.json() }),
  object({ status: z.literal('loading') }),
  object({ status: z.literal('unavailable') }),
]);
const tri = z.enum(['yes', 'no', 'unknown']);
function hasPrivateFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    /^(?:authorization|access_token|refresh_token|ha_token|supervisor_token|password|headers|connection_url)$/i.test(key) || hasPrivateFields(child));
}
export const resultSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('condition'), answer: tri }),
  object({ kind: z.literal('operand'), answer }),
]);
const readFields = { sourceId: id, answer };
const path = z.array(z.string().min(1).max(160).refine(part => !['__proto__', 'prototype', 'constructor'].includes(part))).max(8);
export const captureSchema = z.union([
  object({ ...readFields, access: z.literal('read').optional(), path }),
  object({ ...readFields, access: z.enum(['raw-state', 'last-changed']) }),
]);
export const pinSchema = z.union([
  object({ kind: z.literal('source'), blockId: id, ...readFields, access: z.literal('read').optional(), path }),
  object({ kind: z.literal('source'), blockId: id, ...readFields, access: z.enum(['raw-state', 'last-changed']) }),
  object({ kind: z.literal('output'), blockId: id, portId: id, result: resultSchema }),
]);
export const readKey = (read: Pick<ReadCapture, 'sourceId' | 'access' | 'path'>): string =>
  canonicalCompositionJSON([read.sourceId, read.access ?? 'read', read.path ?? []]);
export const sourceKey = (read: Pick<ReadCapture, 'sourceId' | 'access' | 'path'>): string =>
  readKey(read.access === 'raw-state' ? { sourceId: read.sourceId, path: ['state'] } : read);
export const pinKey = (pin: SimulationPin): string => pin.kind === 'source'
  ? `source:${sourceKey(pin)}` : `output:${pin.blockId}:${pin.portId}`;
export const anchorKey = (anchor: z.infer<typeof anchorSchema>): string => canonicalCompositionJSON(anchor);
const expectation = z.union([
  object({ output: anchorSchema, kind: z.literal('condition'), answer: tri }),
  object({ output: anchorSchema, kind: z.literal('operand'), answer, absoluteTolerance: z.number().nonnegative().finite().optional() })
    .refine(entry => entry.absoluteTolerance === undefined || entry.answer.status === 'value' && typeof entry.answer.value === 'number', 'Tolerance requires a numeric value.'),
]);
export const caseSchema = object({
  version: z.literal(1), id, name: z.string().trim().min(1).max(80), fingerprint: z.string().min(1),
  capturedAt: z.iso.datetime({ offset: true }),
  base: object({
    reads: z.array(captureSchema).max(512),
    flowResponses: z.array(object({ sourceId: id, requestFingerprint: z.string().min(1), response: z.json(), at: z.iso.datetime({ offset: true }), trimmed: z.boolean() })).max(128),
    clock: clockSchema,
    previousText: z.array(object({ output: anchorSchema, text: z.string().max(16384) })).max(128),
    viewer: object({ userId: id.optional(), isAdmin: z.boolean().optional(), personEntityId: id.optional() }).optional(),
    viewerPerson: answer.optional(),
  }),
  pins: z.array(pinSchema).max(512),
  clock: clockSchema.optional(),
  expected: z.array(expectation).max(128),
}).superRefine((entry, context) => {
  const unique = (keys: string[], label: string) => {
    if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: `Duplicate ${label}.` });
  };
  unique(entry.pins.map(pinKey), 'or conflicting pins');
  unique(entry.base.reads.map(readKey), 'read captures');
  unique(entry.base.flowResponses.map(flow => flow.sourceId), 'flow captures');
  unique(entry.base.previousText.map(seed => anchorKey(seed.output)), 'text seeds');
  unique(entry.expected.map(output => anchorKey(output.output)), 'expected outputs');
  if (hasPrivateFields(entry)) context.addIssue({ code: 'custom', message: 'Connection and credential fields are not scenario data.' });
});
export const STORE_LIMIT = 256 * 1024;
export const STORE_COUNT = 20;
export const storeSchema = object({ version: z.literal(1), scenarios: z.array(caseSchema).max(STORE_COUNT) })
  .refine(store => new Set(store.scenarios.map(entry => entry.id)).size === store.scenarios.length, 'Duplicate scenario IDs.');
export function parseScenarios(text: string): SimulationCase[] {
  if (new TextEncoder().encode(text).length > STORE_LIMIT) throw new Error('Scenarios exceed the 256 KiB canvas limit.');
  const json = parseCompositionJSON(new TextEncoder().encode(text));
  assertCompositionBounds(json);
  return storeSchema.parse(json).scenarios;
}
