import { z } from 'zod';
import { digest, digestWithout } from "./json.js";
import { PRODUCT_CLARIFICATION_MANIFEST } from "./product-clarification.js";
import { RuntimeImplementationManifestSchema } from "./work-v2.js";
/** Explicit per-run public sources; does not broaden the client-origin policy. */
export function publicPageUrl(value) {
    if (value.length > 2048)
        throw new Error('Page URL too long');
    const u = new URL(value);
    if (u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.port ||
        !u.hostname.includes('.') ||
        u.hostname.endsWith('.') ||
        /(?:^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname) ||
        z.ipv4().safeParse(u.hostname).success ||
        u.hostname.startsWith('['))
        throw new Error('Public HTTPS page required');
    u.hash = '';
    return u.href;
}
export const SubmittedPagePolicySchema = z
    .strictObject({
    version: z.literal(1),
    urls: z
        .array(z.string().refine((v) => {
        try {
            return publicPageUrl(v) === v;
        }
        catch {
            return false;
        }
    }))
        .min(1)
        .max(6),
})
    .refine((v) => new Set(v.urls).size === v.urls.length, 'Duplicate pages');
/** Call after workspace authorization and pin into the immutable run. */
export function submittedPagePolicy(urls) {
    return SubmittedPagePolicySchema.parse({
        version: 1,
        urls: [...new Set(urls.map(publicPageUrl))],
    });
}
export const SUBMITTED_PAGE_TOOL = Object.freeze({
    key: 'submitted_public_pages',
    version: 1,
    operation: 'read_public_pages',
    provider: 'public_web',
    class: 'read_only',
});
const body = {
    ...PRODUCT_CLARIFICATION_MANIFEST,
    implementation: { key: 'product_service_understanding', version: 6 },
    compatibleDefinitions: [
        { key: 'product_service_understanding', version: 1 },
        { key: 'product_service_understanding', version: 2 },
    ],
    checkpointSchemaVersions: [1, 5],
    instruction: {
        version: 6,
        hash: digest('Public URL draft v1; exact human review before independent evaluation; no website claim promoted without review'),
    },
    buildDigest: digest('psu-public-url-review-v6'),
};
export const PRODUCT_WEBSITE_MANIFEST = RuntimeImplementationManifestSchema.parse({
    ...body,
    manifestDigest: digestWithout(body, 'manifestDigest'),
});
export const PSU_WEBSITE_POLICY_DIGEST = digest({
    key: 'psu_public_url_execution_v3',
    version: 3,
    baseMonetaryPolicy: '967839884ccbed71a4a53f9d75d48f3324f385f3fa6e8950eef59091697a6b89',
    submittedPageTool: SUBMITTED_PAGE_TOOL,
    toolCalls: 6,
    operationalContract: 'psu_execution_evidence_v1',
    schema: 23,
    evidenceWindowMs: 86400000,
    receiptBytes: 16384,
    metadataAttempts: 3,
    metadataWindowMs: 10000,
});
//# sourceMappingURL=product-website.js.map