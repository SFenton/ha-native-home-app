import { z } from 'zod/v4';
import { identifierSchema } from '../../validation';
import { parameterName } from '../expression';
import type { LogicAnchor, LogicUseBinding, StudioCanvasMetadata } from '../graph/types';

export const MAX_LOGIC_USE_BINDINGS = 128;
export const jsonPointerSchema = z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/).refine(value =>
  !value.split('/').some(part => ['__proto__', 'prototype', 'constructor'].includes(part.replace(/~1/g, '/').replace(/~0/g, '~'))));
const owner = { id: identifierSchema, nodeId: identifierSchema.optional(), field: jsonPointerSchema };
export const logicAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...owner, kind: z.enum(['page', 'modal', 'component', 'logic', 'flow']) }),
  z.strictObject({ id: identifierSchema, field: jsonPointerSchema, kind: z.literal('document'), fingerprint: z.string().min(1) }),
]) satisfies z.ZodType<LogicAnchor>;
/** Automatic fill stays tied to the reference selected when authored. */
export interface StoredLogicUseBinding extends LogicUseBinding {
  readonly logicId: string;
}
export const logicUseBindingSchema = z.strictObject({
  use: logicAnchorSchema,
  logicId: identifierSchema,
  argument: parameterName,
  from: z.strictObject({ kind: z.literal('use-tile'), field: jsonPointerSchema }),
}) satisfies z.ZodType<StoredLogicUseBinding>;
export const logicUseBindingsSchema = z.array(logicUseBindingSchema).max(MAX_LOGIC_USE_BINDINGS);

export const studioCanvasMetadataSchema = z.strictObject({
  version: z.literal(1),
  canvases: z.array(z.strictObject({
    id: z.string().min(1), roots: z.array(logicAnchorSchema),
    nodes: z.array(z.strictObject({ id: z.string().min(1), origins: z.array(jsonPointerSchema), x: z.number(), y: z.number() })),
    viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
    groups: z.array(z.strictObject({ id: z.string(), label: z.string(), nodeIds: z.array(z.string()) })).optional(),
  })),
  bundles: z.array(z.strictObject({
    id: z.string(), name: z.string(),
    outputs: z.array(z.strictObject({ name: z.string(), logicId: z.string() })),
  })).optional(),
}) satisfies z.ZodType<StudioCanvasMetadata>;
