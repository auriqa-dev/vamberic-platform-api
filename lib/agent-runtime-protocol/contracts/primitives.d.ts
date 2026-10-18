import { z } from 'zod';
export declare const PROTOCOL_VERSION: "1.2";
export declare const SUPPORTED_PROTOCOL_VERSIONS: readonly ["1.1", "1.2"];
export declare const ProtocolVersionSchema: z.ZodEnum<{
    1.2: "1.2";
    1.1: "1.1";
}>;
export declare const OpaqueIdSchema: z.ZodString;
export declare const KeySchema: z.ZodString;
export declare const VersionSchema: z.ZodNumber;
export declare const CounterSchema: z.ZodNumber;
export declare const HashSchema: z.ZodString;
export declare const TimestampSchema: z.ZodISODateTime;
export declare const TextSchema: z.ZodString;
export declare const ProjectionSchema: z.ZodArray<z.ZodString>;
export declare function platformId(prefix: string): z.ZodString;
export declare const WorkspaceIdSchema: z.ZodString;
export declare const ClientIdSchema: z.ZodString;
export declare const ExactDecimalSchema: z.ZodString;
export declare const CurrencySchema: z.ZodString;
export declare const ImplementationIdentitySchema: z.ZodObject<{
    key: z.ZodString;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const InstructionSchema: z.ZodObject<{
    version: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export declare const ReferenceSchema: z.ZodObject<{
    resourceType: z.ZodString;
    id: z.ZodString;
    workspaceId: z.ZodString;
    version: z.ZodOptional<z.ZodNumber>;
    revision: z.ZodOptional<z.ZodNumber>;
    contentHash: z.ZodString;
}, z.core.$strict>;
export declare const ExternalReferenceSchema: z.ZodString;
export declare const RESULT_SCHEMA_VERSION = 2;
export declare const ResultSchemaVersionSchema: z.ZodLiteral<2>;
