import { z } from 'zod';
/** Explicit per-run public sources; does not broaden the client-origin policy. */
export declare function publicPageUrl(value: string): string;
export declare const SubmittedPagePolicySchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    urls: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/** Call after workspace authorization and pin into the immutable run. */
export declare function submittedPagePolicy(urls: readonly string[]): {
    version: 1;
    urls: string[];
};
export declare const SUBMITTED_PAGE_TOOL: Readonly<{
    key: "submitted_public_pages";
    version: 1;
    operation: "read_public_pages";
    provider: "public_web";
    class: "read_only";
}>;
export declare const PRODUCT_WEBSITE_MANIFEST: {
    implementation: {
        key: string;
        version: number;
    };
    compatibleDefinitions: {
        key: string;
        version: number;
    }[];
    protocolVersions: ("1.2" | "1.1")[];
    operations: string[];
    resultSchemaVersions: number[];
    checkpointSchemaVersions: number[];
    instruction: {
        version: number;
        hash: string;
    };
    buildDigest: string;
    manifestDigest: string;
} | {
    protocolVersions: ("1.2" | "1.1" | "2.0")[];
    implementation: {
        key: string;
        version: number;
    };
    compatibleDefinitions: {
        key: string;
        version: number;
    }[];
    operations: string[];
    resultSchemaVersions: number[];
    checkpointSchemaVersions: number[];
    instruction: {
        version: number;
        hash: string;
    };
    buildDigest: string;
    manifestDigest: string;
};
export declare const PSU_WEBSITE_POLICY_DIGEST: string;
