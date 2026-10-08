import { z } from 'zod';
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export declare const LIMITS: Readonly<{
    depth: 12;
    nodes: 20000;
    keys: 100;
    array: 256;
    string: 16000;
    dispatchBytes: 2048;
    workBytes: 262144;
    outcomeBytes: 262144;
    payloadBytes: 32768;
    checkpointBytes: 65536;
    observationBytes: 16384;
}>;
/** JSON-domain only. No toJSON, getters, prototypes, sparse arrays or coercion. */
export declare function canonicalJson(value: unknown, maxBytes?: number): string;
export declare function digest(value: unknown): string;
export declare function digestWithout(value: object, key: string): string;
export declare function bounded<S extends z.ZodType>(schema: S, maxBytes: number): z.ZodPipe<z.ZodUnknown, S>;
export declare const JsonPayloadSchema: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
