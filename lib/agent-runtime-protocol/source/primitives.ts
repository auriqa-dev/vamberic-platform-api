import { z } from 'zod';
export const PROTOCOL_VERSION = '1.2' as const;
export const SUPPORTED_PROTOCOL_VERSIONS = ['1.1', PROTOCOL_VERSION] as const;
export const ProtocolVersionSchema = z.enum(SUPPORTED_PROTOCOL_VERSIONS);
export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const KeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
export const VersionSchema = z.number().int().min(1).max(1_000_000);
export const CounterSchema = z.number().int().min(0).max(1_000_000);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const TimestampSchema = z.iso.datetime({ precision: 3 });
export const TextSchema = z.string().min(1).max(2_000);
export const ProjectionSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/)
      .refine(
        (v) =>
          !v
            .split('.')
            .some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)),
      ),
  )
  .min(1)
  .max(40)
  .refine((v) => new Set(v).size === v.length, 'Duplicate field');
export function platformId(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`));
}
export const WorkspaceIdSchema = platformId('workspace');
export const ClientIdSchema = platformId('org');
export const ExactDecimalSchema = z
  .string()
  .max(32)
  .regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$/);
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const ImplementationIdentitySchema = z.strictObject({
  key: KeySchema,
  version: VersionSchema,
});
export const InstructionSchema = z.strictObject({
  version: VersionSchema,
  hash: HashSchema,
});
export const ReferenceSchema = z.strictObject({
  resourceType: KeySchema,
  id: OpaqueIdSchema,
  workspaceId: WorkspaceIdSchema,
  version: VersionSchema.optional(),
  revision: VersionSchema.optional(),
  contentHash: HashSchema,
});
export const ExternalReferenceSchema = z
  .string()
  .max(2_000)
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ['https:', 'http:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        u.href === v
      );
    } catch {
      return false;
    }
  }, 'Use normalized HTTP(S) URL without credentials');

export const RESULT_SCHEMA_VERSION = 2;
export const ResultSchemaVersionSchema = z.literal(RESULT_SCHEMA_VERSION);
