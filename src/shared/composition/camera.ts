import { z } from 'zod/v4';

const text = z.string().max(240).refine(value => Boolean(value.trim()));
const entity = z.strictObject({ type: z.literal('literal'), value: z.string().max(160).min(1) });

/** Source descriptors never contain URLs, credentials or arbitrary service commands. */
export const cameraInputs = z.strictObject({
  entityId: entity, snapshotEntityId: entity,
  rtcStreamId: z.string().min(1).max(160), aspectRatio: z.number().min(0.25).max(8),
  recording: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('disabled') }),
    z.strictObject({ type: z.literal('script'), stateEntityId: entity, scriptEntityId: entity }),
  ]),
});
export const cameraLabels = z.strictObject({
  loading: text, unavailable: text, hidden: text, connecting: text, live: text, delayed: text,
  snapshot: text, retry: text, recordFailed: text, photosTitle: text, photosMessage: text,
  settings: text, cancel: text,
});
