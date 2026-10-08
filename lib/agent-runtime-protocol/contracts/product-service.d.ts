import { z } from 'zod';
import { type ResultContent } from './content.ts';
export declare const OFFERING_TYPES: readonly ["software", "installed_technology", "physical_product", "professional_service", "managed_service", "outsourced_operation", "infrastructure_engineering_service", "legal_advisory_service", "insurance_financial_product", "subscription_media", "hybrid", "other", "unknown"];
export declare const DELIVERY_MODES: readonly ["digital_self_service", "digitally_assisted", "installed_deployed", "physical_delivery", "on_site_service", "remote_service", "people_led_advisory", "managed_outsourced", "project_based", "ongoing_subscription", "hybrid", "other", "unknown"];
export declare const IMPLEMENTATION_MODELS: readonly ["customer_implementation", "supplier_led_implementation", "supplier_mobilisation", "light_configuration", "no_implementation", "other", "unknown"];
export declare const OFFERING_LIST_FIELDS: readonly ["capabilities", "deliverables", "problemsSolved", "desiredOutcomes", "differentiators", "purchaseConsiderations", "industriesServed", "regionsServed", "competitors", "boundaries", "explicitExclusions", "approvedTerminology", "avoidTerminology", "approvedClaims", "proofPoints", "regulatoryContext", "unknowns"];
export declare const OfferingContentSchema: z.ZodObject<{
    unknowns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    deliverables: z.ZodOptional<z.ZodArray<z.ZodString>>;
    problemsSolved: z.ZodOptional<z.ZodArray<z.ZodString>>;
    desiredOutcomes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    differentiators: z.ZodOptional<z.ZodArray<z.ZodString>>;
    purchaseConsiderations: z.ZodOptional<z.ZodArray<z.ZodString>>;
    industriesServed: z.ZodOptional<z.ZodArray<z.ZodString>>;
    regionsServed: z.ZodOptional<z.ZodArray<z.ZodString>>;
    competitors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    boundaries: z.ZodOptional<z.ZodArray<z.ZodString>>;
    explicitExclusions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    approvedTerminology: z.ZodOptional<z.ZodArray<z.ZodString>>;
    avoidTerminology: z.ZodOptional<z.ZodArray<z.ZodString>>;
    approvedClaims: z.ZodOptional<z.ZodArray<z.ZodString>>;
    proofPoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    regulatoryContext: z.ZodOptional<z.ZodArray<z.ZodString>>;
    businessModel: z.ZodOptional<z.ZodString>;
    primaryOfferingType: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        software: "software";
        installed_technology: "installed_technology";
        physical_product: "physical_product";
        professional_service: "professional_service";
        managed_service: "managed_service";
        outsourced_operation: "outsourced_operation";
        infrastructure_engineering_service: "infrastructure_engineering_service";
        legal_advisory_service: "legal_advisory_service";
        insurance_financial_product: "insurance_financial_product";
        subscription_media: "subscription_media";
        hybrid: "hybrid";
        other: "other";
    }>>;
    secondaryOfferingTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        unknown: "unknown";
        software: "software";
        installed_technology: "installed_technology";
        physical_product: "physical_product";
        professional_service: "professional_service";
        managed_service: "managed_service";
        outsourced_operation: "outsourced_operation";
        infrastructure_engineering_service: "infrastructure_engineering_service";
        legal_advisory_service: "legal_advisory_service";
        insurance_financial_product: "insurance_financial_product";
        subscription_media: "subscription_media";
        hybrid: "hybrid";
        other: "other";
    }>>>;
    websiteUrl: z.ZodOptional<z.ZodString>;
    whatItIs: z.ZodOptional<z.ZodString>;
    whatCustomerBuys: z.ZodOptional<z.ZodString>;
    deliveryModes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        unknown: "unknown";
        hybrid: "hybrid";
        other: "other";
        digital_self_service: "digital_self_service";
        digitally_assisted: "digitally_assisted";
        installed_deployed: "installed_deployed";
        physical_delivery: "physical_delivery";
        on_site_service: "on_site_service";
        remote_service: "remote_service";
        people_led_advisory: "people_led_advisory";
        managed_outsourced: "managed_outsourced";
        project_based: "project_based";
        ongoing_subscription: "ongoing_subscription";
    }>>>;
    supplierRole: z.ZodOptional<z.ZodString>;
    customerRole: z.ZodOptional<z.ZodString>;
    implementationModel: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        other: "other";
        customer_implementation: "customer_implementation";
        supplier_led_implementation: "supplier_led_implementation";
        supplier_mobilisation: "supplier_mobilisation";
        light_configuration: "light_configuration";
        no_implementation: "no_implementation";
    }>>;
    engagementModel: z.ZodOptional<z.ZodString>;
    valueProposition: z.ZodOptional<z.ZodString>;
    commercialModel: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    description: z.ZodString;
}, z.core.$strict>;
export declare const ProductBindingSchema: z.ZodObject<{
    field: z.ZodEnum<{
        [x: string]: string;
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
}, z.core.$strict>;
export declare const ProductScopeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    mode: z.ZodLiteral<"create">;
    brand: z.ZodObject<{
        resourceType: z.ZodString;
        id: z.ZodString;
        workspaceId: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        revision: z.ZodOptional<z.ZodNumber>;
        contentHash: z.ZodString;
    }, z.core.$strict>;
    workingLabel: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    mode: z.ZodLiteral<"refresh">;
    target: z.ZodObject<{
        resourceType: z.ZodString;
        id: z.ZodString;
        workspaceId: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        revision: z.ZodOptional<z.ZodNumber>;
        contentHash: z.ZodString;
    }, z.core.$strict>;
    expectedUpdatedAt: z.ZodISODateTime;
    workingLabel: z.ZodString;
}, z.core.$strict>], "mode">;
export declare const ProductStatementSchema: z.ZodObject<{
    id: z.ZodString;
    concept: z.ZodEnum<{
        capability: "capability";
        outcome: "outcome";
        identity: "identity";
        substance: "substance";
        receipt: "receipt";
        delivery: "delivery";
        constraint: "constraint";
        commercial: "commercial";
        customer: "customer";
        proof: "proof";
    }>;
    findingId: z.ZodString;
    availability: z.ZodEnum<{
        unknown: "unknown";
        planned: "planned";
        pilot: "pilot";
        current: "current";
        legacy: "legacy";
        discontinued: "discontinued";
    }>;
    canonicalBinding: z.ZodOptional<z.ZodObject<{
        field: z.ZodEnum<{
            [x: string]: string;
        }>;
        value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    }, z.core.$strict>>;
    qualification: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ProductOutputSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"product_service_understanding">;
    schemaVersion: z.ZodLiteral<1>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        mode: z.ZodLiteral<"create">;
        brand: z.ZodObject<{
            resourceType: z.ZodString;
            id: z.ZodString;
            workspaceId: z.ZodString;
            version: z.ZodOptional<z.ZodNumber>;
            revision: z.ZodOptional<z.ZodNumber>;
            contentHash: z.ZodString;
        }, z.core.$strict>;
        workingLabel: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        mode: z.ZodLiteral<"refresh">;
        target: z.ZodObject<{
            resourceType: z.ZodString;
            id: z.ZodString;
            workspaceId: z.ZodString;
            version: z.ZodOptional<z.ZodNumber>;
            revision: z.ZodOptional<z.ZodNumber>;
            contentHash: z.ZodString;
        }, z.core.$strict>;
        expectedUpdatedAt: z.ZodISODateTime;
        workingLabel: z.ZodString;
    }, z.core.$strict>], "mode">;
    proposalId: z.ZodOptional<z.ZodLiteral<"offering_understanding">>;
    statements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        concept: z.ZodEnum<{
            capability: "capability";
            outcome: "outcome";
            identity: "identity";
            substance: "substance";
            receipt: "receipt";
            delivery: "delivery";
            constraint: "constraint";
            commercial: "commercial";
            customer: "customer";
            proof: "proof";
        }>;
        findingId: z.ZodString;
        availability: z.ZodEnum<{
            unknown: "unknown";
            planned: "planned";
            pilot: "pilot";
            current: "current";
            legacy: "legacy";
            discontinued: "discontinued";
        }>;
        canonicalBinding: z.ZodOptional<z.ZodObject<{
            field: z.ZodEnum<{
                [x: string]: string;
            }>;
            value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
        }, z.core.$strict>>;
        qualification: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    components: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        relationship: z.ZodEnum<{
            unknown: "unknown";
            optional: "optional";
            included: "included";
            prerequisite: "prerequisite";
            stage: "stage";
            separately_purchasable: "separately_purchasable";
        }>;
        statementIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    currentCommercialReality: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            price: "price";
            billing_basis: "billing_basis";
            term: "term";
            package: "package";
            guarantee: "guarantee";
            buying_mechanism: "buying_mechanism";
        }>;
        statementIds: z.ZodArray<z.ZodString>;
        amountMinor: z.ZodOptional<z.ZodNumber>;
        currency: z.ZodOptional<z.ZodString>;
        unit: z.ZodOptional<z.ZodString>;
        interval: z.ZodOptional<z.ZodString>;
        qualifier: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    currentCustomerReality: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        relationship: z.ZodEnum<{
            buyer: "buyer";
            payer: "payer";
            user: "user";
            beneficiary: "beneficiary";
            claimed_audience: "claimed_audience";
        }>;
        statementIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    claims: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        statementId: z.ZodString;
        category: z.ZodEnum<{
            product_fact: "product_fact";
            intended_outcome: "intended_outcome";
            observed_outcome: "observed_outcome";
            comparative_claim: "comparative_claim";
            unsupported_marketing_claim: "unsupported_marketing_claim";
        }>;
        qualification: z.ZodString;
        use: z.ZodEnum<{
            internal_only: "internal_only";
            permission_unknown: "permission_unknown";
        }>;
    }, z.core.$strict>>;
    contradictions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        concept: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodString>;
        material: z.ZodBoolean;
        resolutionEvidenceIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    gapContexts: z.ZodArray<z.ZodObject<{
        gapId: z.ZodString;
        category: z.ZodEnum<{
            capability: "capability";
            outcome: "outcome";
            identity: "identity";
            receipt: "receipt";
            delivery: "delivery";
            constraint: "constraint";
            commercial: "commercial";
            proof: "proof";
            contradiction: "contradiction";
        }>;
        concept: z.ZodString;
        affectedStatementIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    resolvedPrerequisites: z.ZodArray<z.ZodObject<{
        priorRunId: z.ZodString;
        priorResultId: z.ZodOptional<z.ZodString>;
        priorGapId: z.ZodString;
        resolvingEvidenceIds: z.ZodArray<z.ZodString>;
        rationale: z.ZodString;
    }, z.core.$strict>>;
    changes: z.ZodArray<z.ZodObject<{
        field: z.ZodEnum<{
            [x: string]: string;
        }>;
        beforeValue: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        afterValue: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        kind: z.ZodEnum<{
            unchanged: "unchanged";
            changed: "changed";
            newly_uncertain: "newly_uncertain";
            omitted: "omitted";
        }>;
        findingIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    review: z.ZodObject<{
        summary: z.ZodString;
        confirmationTopics: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>>;
export declare const ProductHistorySchema: z.ZodObject<{
    kind: z.ZodLiteral<"product_service_history">;
    schemaVersion: z.ZodLiteral<1>;
    importedSupport: z.ZodPipe<z.ZodUnknown, z.ZodArray<z.ZodObject<{
        localEvidenceId: z.ZodString;
        sourceResultId: z.ZodString;
        sourceEnvelopeDigest: z.ZodString;
        sourceEvidenceId: z.ZodString;
        sourceEvidenceDigest: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const ProductCheckpointSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    stage: z.ZodEnum<{
        orient: "orient";
        gather: "gather";
        structure: "structure";
        clarify: "clarify";
        synthesize: "synthesize";
    }>;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        mode: z.ZodLiteral<"create">;
        brand: z.ZodObject<{
            resourceType: z.ZodString;
            id: z.ZodString;
            workspaceId: z.ZodString;
            version: z.ZodOptional<z.ZodNumber>;
            revision: z.ZodOptional<z.ZodNumber>;
            contentHash: z.ZodString;
        }, z.core.$strict>;
        workingLabel: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        mode: z.ZodLiteral<"refresh">;
        target: z.ZodObject<{
            resourceType: z.ZodString;
            id: z.ZodString;
            workspaceId: z.ZodString;
            version: z.ZodOptional<z.ZodNumber>;
            revision: z.ZodOptional<z.ZodNumber>;
            contentHash: z.ZodString;
        }, z.core.$strict>;
        expectedUpdatedAt: z.ZodISODateTime;
        workingLabel: z.ZodString;
    }, z.core.$strict>], "mode">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            whyRequired: z.ZodString;
            severity: z.ZodEnum<{
                blocking: "blocking";
                non_blocking: "non_blocking";
            }>;
            checked: z.ZodArray<z.ZodString>;
            evidenceIds: z.ZodArray<z.ZodString>;
            findingIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            resolution: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"human_input">;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"research">;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"capability">;
                requiredCapability: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"unresolved">;
            }, z.core.$strict>], "kind">;
            context: z.ZodOptional<z.ZodObject<{
                subject: z.ZodOptional<z.ZodString>;
                scope: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
                parents: z.ZodArray<z.ZodObject<{
                    relationship: z.ZodString;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
        lineage: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            role: z.ZodEnum<{
                requested: "requested";
                consumed: "consumed";
                proposal_base: "proposal_base";
            }>;
            purpose: z.ZodString;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"resource">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"artifact">;
                artifactId: z.ZodString;
                contentHash: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"input">;
                requestId: z.ZodString;
                contentHash: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            fetchedAt: z.ZodISODateTime;
            fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            snapshotId: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    questionKeys: z.ZodArray<z.ZodString>;
    inputCycles: z.ZodNumber;
    sourceDigests: z.ZodArray<z.ZodObject<{
        reference: z.ZodObject<{
            resourceType: z.ZodString;
            id: z.ZodString;
            workspaceId: z.ZodString;
            version: z.ZodOptional<z.ZodNumber>;
            revision: z.ZodOptional<z.ZodNumber>;
            contentHash: z.ZodString;
        }, z.core.$strict>;
        digest: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>>;
/** Structural proof only. Meaning/grounding remains independent judgement. */
export declare function validateProductContent(value: unknown, complete?: boolean): ResultContent;
/** Structural support seam for the explicitly pinned modern PSU validator.
 * This is not provenance admission or authorization. Legacy callers above
 * never supply composed support. */
export declare function validateProductContentSupport(value: unknown, complete: boolean, composed: ReadonlyMap<string, {
    field: string;
    value: string[];
}>): ResultContent;
export declare const PRODUCT_PROFILE: {
    key: string;
    version: number;
    digest: string;
};
export declare function productCriteria(): {
    schemaVersion: 1;
    profile: {
        key: string;
        version: number;
        digest: string;
    };
    objective: string;
    intendedNextAction: string;
    lineage: {
        id: string;
        role: "requested" | "consumed" | "proposal_base";
        purpose: string;
        source: {
            kind: "resource";
            reference: {
                resourceType: string;
                id: string;
                workspaceId: string;
                contentHash: string;
                version?: number | undefined;
                revision?: number | undefined;
            };
        } | {
            kind: "external";
            url: string;
            contentHash: string;
        } | {
            kind: "artifact";
            artifactId: string;
            contentHash: string;
        } | {
            kind: "input";
            requestId: string;
            contentHash: string;
        };
        observedAt: string;
        fetchedAt: string;
        fields?: string[] | undefined;
        snapshotId?: string | undefined;
        artifactId?: string | undefined;
    }[];
    criteria: {
        id: string;
        version: number;
        category: "validity" | "effectiveness" | "brand";
        requirement: string;
        rationale: string;
        importance: "mandatory" | "advisory";
        method: "deterministic" | "judgement";
        methodKey: string;
        evidence: "required" | "none";
        applicabilityRule: string;
        consequenceKey: string;
        lineageIds: string[];
    }[];
    digest: string;
};
export declare const PRODUCT_MANIFEST: {
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
};
