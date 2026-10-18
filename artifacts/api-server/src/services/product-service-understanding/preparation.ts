import { currentAgentSource } from "../agent-proposal-freshness";
import {
  PRODUCT_WEBSITE_MANIFEST,
  submittedPagePolicy,
  SUBMITTED_PAGE_TOOL,
} from "@workspace/agent-runtime-protocol";
import { websiteCaseBudget, websiteRunBudget } from "./execution-policy";
import { productionCaseBudget, productionRunBudget } from "./execution-policy";
import { prepareGeneralClarification } from "./general-clarification";
import { prepareUncertainty } from "./uncertainty";
import { projectCanonicalSupport } from "../canonical-support";
import { SupportReferenceSchema } from "../../domain/canonical-support";
import { z } from "zod";
import {
  digest,
  PRODUCT_GENERAL_MANIFEST,
  PRODUCT_CLARIFICATION_MANIFEST,
  GeneralClarificationOrigin,
  PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
  PRODUCT_UNCERTAINTY_MANIFEST,
  PsuUncertaintyOriginV2,
  PSU_FACT_POLICY,
  productCriteria,
  ProductScopeSchema,
  JsonPayloadSchema,
  EvaluationInputSchema,
  EvaluationPayloadSchema,
  RuntimeImplementationManifestSchema as ImplementationManifestSchema,
  type RuntimeImplementationManifest as ImplementationManifest,
  type ResourceGrant,
} from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../../config";
import { resolveHvmContext, withoutMongoId } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import {
  AgentRunSchema,
  AgentResultSchema,
  parseFrozenWork,
} from "../../domain/agent-control-plane";
import {
  productEffectivenessProfile,
  PRODUCT_EFFECTIVENESS,
  PRODUCT_POLICY,
} from "./profile";

const requestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("create"),
      brandId: z.string(),
      workingLabel: z.string().min(1).max(200),
      orientation: z.string().max(4000),
      websiteUrls: z.array(z.string().max(2048)).max(6).optional(),
      canonicalSupport: SupportReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("refresh"),
      offeringId: z.string(),
      expectedUpdatedAt: z.string().datetime(),
      workingLabel: z.string().min(1).max(200),
      orientation: z.string().max(4000),
      websiteUrls: z.array(z.string().max(2048)).max(6).optional(),
      canonicalSupport: SupportReferenceSchema.optional(),
    })
    .strict(),
]);
/** Offline/fake-provider foundation policy only. Not registered by subsystem
 * defaults, not deployable provider configuration and never browser-supplied. */
function createProductProfile(
  config: AppConfig,
  manifestValue: ImplementationManifest,
  clock = () => new Date(),
  production = false,
) {
  const manifest = ImplementationManifestSchema.parse(manifestValue);
  if (manifest.implementation.key !== "product_service_understanding")
    throw new Error("Product manifest required");
  if (
    production &&
    ![
      PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
      PRODUCT_WEBSITE_MANIFEST.manifestDigest,
    ].includes(manifest.manifestDigest)
  )
    throw new Error("Exact reviewed production manifest required");
  const website =
    manifest.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest;
  const generalClarification =
    manifest.manifestDigest === PRODUCT_CLARIFICATION_MANIFEST.manifestDigest;
  const uncertainty =
    generalClarification ||
    manifest.manifestDigest ===
      PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest;
  const general =
    website ||
    uncertainty ||
    manifest.manifestDigest === PRODUCT_UNCERTAINTY_MANIFEST.manifestDigest ||
    manifest.manifestDigest === PRODUCT_GENERAL_MANIFEST.manifestDigest;
  return productEffectivenessProfile({
    manifestDigest: manifest.manifestDigest,
    async prepareCase(context) {
      const raw = z.record(z.unknown()).parse(context.input);
      const { uncertainty: selector, ...request } = raw;
      const checked = requestSchema.parse(request);
      if (production && !website && checked.websiteUrls?.length)
        throw new Error("Production website retrieval unavailable");
      if (website) submittedPagePolicy(checked.websiteUrls ?? []);
      if (selector !== undefined) {
        if (!uncertainty)
          throw new Error("Uncertainty implementation required");
        const prepared = await (
          generalClarification
            ? prepareGeneralClarification
            : prepareUncertainty
        )(context, selector, production);
        const remaining =
          Date.parse(prepared.allocation.deadline) - clock().getTime();
        if (remaining <= 0 || remaining > 3600000)
          throw new Error("Invalid fresh allocation deadline");
        return {
          criteria: productCriteria(),
          totalBudget: prepared.allocation,
          preparedInput: { ...request, uncertaintyOrigin: prepared.origin },
        };
      }
      if (context.predecessor && uncertainty)
        throw new Error("Explicit uncertainty allocation required");
      return {
        criteria: productCriteria(),
        totalBudget: production
          ? (website ? websiteCaseBudget : productionCaseBudget)(
              new Date(clock().getTime() + 3600000).toISOString(),
            )
          : {
              deadline: new Date(clock().getTime() + 3600000).toISOString(),
              modelCalls: 16,
              toolCalls: 6,
              providerCalls: [
                { provider: "fake_provider", calls: 16 },
                { provider: "public_web", calls: 6 },
              ],
              cost: { currency: "GBP", amount: "1" },
            },
      };
    },
    async prepareRun({ db, session, identity, case: c, runId, role, input }) {
      const now = clock().toISOString();
      const resolved = await resolveHvmContext(db, config, identity, session);
      const agent =
        c.target.kind === "workspace_agent"
          ? undefined
          : await db.collection("client_agents").findOne(
              {
                id: c.target.id,
                workspaceId: c.workspaceId,
                revision: c.target.revision,
              },
              { session },
            );
      if (c.target.kind !== "workspace_agent" && !agent)
        throw new AuthorizationDenied();
      const definition = await db.collection("agent_definitions").findOne(
        {
          id:
            c.target.kind === "workspace_agent"
              ? c.target.definition.id
              : agent!.data.definition.id,
          version:
            c.target.kind === "workspace_agent"
              ? c.target.definition.version
              : agent!.data.definition.version,
        },
        { session },
      );
      if (
        !definition ||
        definition.data.executionImplementation?.manifestDigest !==
          manifest.manifestDigest
      )
        throw new AuthorizationDenied();
      const root =
        role === "maker"
          ? undefined
          : AgentRunSchema.parse(
              withoutMongoId(
                (await db
                  .collection("agent_runs")
                  .findOne(
                    { id: c.rootRunId, workspaceId: c.workspaceId },
                    { session },
                  )) ?? {},
              ),
            );
      const { uncertaintyOrigin: originValue, ...makerRequest } = z
        .record(z.unknown())
        .parse(
          role === "maker"
            ? input
            : (root!.frozen.input as Record<string, unknown>).request,
        );
      const origin =
        originValue === undefined
          ? undefined
          : (generalClarification
              ? GeneralClarificationOrigin
              : PsuUncertaintyOriginV2
            ).parse(originValue);
      if (
        origin &&
        (!uncertainty ||
          !c.predecessorCase ||
          c.predecessorCase.id !== origin.predecessorCaseId ||
          digest(c.target) !== origin.targetDigest ||
          digest(c.requester) !== digest(origin.applicability.actor) ||
          c.authority.basis !== origin.applicability.capacity ||
          c.requestKey !== origin.applicability.requestKey)
      )
        throw new Error("Uncertainty origin changed");
      const original =
        role === "maker"
          ? requestSchema.parse(makerRequest)
          : requestSchema.parse(
              (root!.frozen.input as Record<string, unknown>).request,
            );
      const resource = original.mode === "create" ? "brands" : "offerings";
      const id =
        original.mode === "create" ? original.brandId : original.offeringId;
      resolved.authority.scopeFilter(resolved.context, "read", {
        type: resource,
        workspaceId: c.workspaceId,
      });
      const row = await db
        .collection(resource)
        .findOne(
          { id, workspaceId: c.workspaceId, archived: { $ne: true } },
          { session },
        );
      if (!row) throw new AuthorizationDenied();
      if (
        original.mode === "refresh" &&
        (row.status !== "draft" ||
          row.updatedAt.toISOString() !== original.expectedUpdatedAt)
      )
        throw new Error(
          "Refresh requires the selected unchanged human-opened draft",
        );
      const reference = {
        resourceType: resource,
        id,
        workspaceId: c.workspaceId,
        ...(row.revision ? { revision: row.revision } : {}),
        contentHash:
          row.contentHash ??
          digest(JSON.parse(JSON.stringify(withoutMongoId(row)))),
      };
      const scope = ProductScopeSchema.parse(
        original.mode === "create"
          ? {
              mode: "create",
              brand: reference,
              workingLabel: original.workingLabel,
            }
          : {
              mode: "refresh",
              target: reference,
              expectedUpdatedAt: original.expectedUpdatedAt,
              workingLabel: original.workingLabel,
            },
      );
      if (root) {
        const prior = ProductScopeSchema.parse(
          (root.frozen.input as Record<string, unknown>).scope,
        );
        if (digest(prior) !== digest(scope))
          throw new Error("Product context changed; a new case is required");
      }
      const fields =
        resource === "offerings"
          ? ["definition", "evidence", "revision", "status"]
          : ["name", "description", "primaryDomain"].filter(
              (k) => row[k] !== undefined,
            );
      const payload = JsonPayloadSchema.parse(
        JSON.parse(
          JSON.stringify(Object.fromEntries(fields.map((k) => [k, row[k]]))),
        ),
      );
      const snapshots = [
        {
          id: "selected_product_context",
          reference,
          fields,
          payload,
          payloadDigest: digest(payload),
        },
      ];
      const resources: ResourceGrant[] = [{ reference, fields }];
      if (original.canonicalSupport) {
        if (!general || original.canonicalSupport.id === reference.id)
          throw new Error(
            "Canonical source must be a distinct pinned approved Offering",
          );
        const support = await projectCanonicalSupport(
          db,
          c.workspaceId,
          session,
          original.canonicalSupport,
          (ref) => {
            if (
              ref.workspaceId !== c.workspaceId ||
              !definition.data.hiveAccess.readResources.includes(
                ref.resourceType,
              )
            )
              throw new AuthorizationDenied();
            resolved.authority.scopeFilter(resolved.context, "read", {
              type: ref.resourceType,
              workspaceId: c.workspaceId,
            });
          },
        );
        const canonical = await currentAgentSource(
          db,
          c.workspaceId,
          support.root,
          session,
        );
        if (!canonical) throw new AuthorizationDenied();
        const canonicalPayload = JsonPayloadSchema.parse(
          JSON.parse(
            JSON.stringify({
              definition: canonical.definition,
              evidence: canonical.evidence,
              revision: canonical.revision,
              status: canonical.status,
              canonicalSupport: support,
            }),
          ),
        );
        const canonicalFields = [
          "definition",
          "evidence",
          "revision",
          "status",
          "canonicalSupport",
        ];
        resources.push({ reference: support.root, fields: canonicalFields });
        snapshots.push({
          id: "certified_product_context",
          reference: support.root,
          fields: canonicalFields,
          payload: canonicalPayload,
          payloadDigest: digest(canonicalPayload),
        });
      }
      const history: {
        localEvidenceId: string;
        sourceResultId: string;
        sourceEnvelopeDigest: string;
        sourceEvidenceId: string;
        sourceEvidenceDigest: string;
      }[] = [];
      let candidateResult:
        ReturnType<typeof AgentResultSchema.parse> | undefined;
      if (role !== "maker" || origin) {
        const candidate = origin
          ? origin.candidate
          : c.candidates.at(-1)!.reference;
        candidateResult = AgentResultSchema.parse(
          withoutMongoId(
            (await db
              .collection("agent_results")
              .findOne(
                { id: candidate.resultId, workspaceId: c.workspaceId },
                { session },
              )) ?? {},
          ),
        );
        if (candidateResult.envelope.payloadDigest !== candidate.envelopeDigest)
          throw new AuthorizationDenied();
        const content = candidateResult.envelope.outcome.content;
        const resultFields = [
          "domainOutput",
          "findings",
          "evidence",
          "knowledgeGaps",
          "proposals",
          "lineage",
          ...(general
            ? ["assumptions", "unknowns", "artifacts", "warnings"]
            : []),
        ];
        const projected = JsonPayloadSchema.parse(
          JSON.parse(
            JSON.stringify(
              Object.fromEntries(
                resultFields.map((k) => [
                  k,
                  content[k as keyof typeof content],
                ]),
              ),
            ),
          ),
        );
        const resultReference = {
          resourceType: "agent_result_projection",
          id: candidateResult.id,
          workspaceId: c.workspaceId,
          contentHash: candidate.envelopeDigest,
        };
        resources.push({ reference: resultReference, fields: resultFields });
        snapshots.push({
          id: "candidate_context",
          reference: resultReference,
          fields: resultFields,
          payload: projected,
          payloadDigest: digest(projected),
        });
        for (const e of content.evidence)
          history.push({
            localEvidenceId: e.id,
            sourceResultId: candidateResult.id,
            sourceEnvelopeDigest: candidate.envelopeDigest,
            sourceEvidenceId: e.id,
            sourceEvidenceDigest: digest(e),
          });
        if (history.length > 20)
          throw new Error("Product support exceeds import bound");
      }
      const configured = z
        .array(
          z
            .object({
              key: z.string(),
              text: z.string().optional(),
              boolean: z.boolean().optional(),
              number: z.number().optional(),
            })
            .strict(),
        )
        .parse(agent?.data.configuration ?? []);
      const enabled =
        configured.find((x) => x.key === "website_enabled")?.boolean === true;
      const origins = (
        configured.find((x) => x.key === "website_origins")?.text ?? ""
      )
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (origins.length > 4) throw new Error("Website origin bound");
      for (const origin of origins) {
        const u = new URL(origin);
        if (
          u.origin !== origin ||
          u.protocol !== "https:" ||
          u.port ||
          u.username ||
          u.password
        )
          throw new Error("Website origin denied");
      }
      const urls = role === "maker" ? (original.websiteUrls ?? []) : [];
      const submittedPages =
        website && role === "maker" ? submittedPagePolicy(urls) : undefined;
      for (const url of website ? [] : urls) {
        const u = new URL(url);
        if (
          !enabled ||
          !origins.includes(u.origin) ||
          u.protocol !== "https:" ||
          u.port ||
          u.username ||
          u.password ||
          u.search ||
          u.hash
        )
          throw new Error("Website scope denied");
      }
      const websiteGrant = website
        ? SUBMITTED_PAGE_TOOL
        : {
            key: "client_website",
            version: 1,
            operation: "read_public_pages",
            provider: "public_web",
            class: "read_only",
          };
      const operation = PRODUCT_EFFECTIVENESS[role];
      const model = {
        provider: production ? "openai" : "fake_provider",
        model: production ? `openai_psu_${role}_v1` : "fake_model",
        purpose:
          role === "evaluator" ? "product_evaluate" : "product_understand",
      };
      let operationInput: unknown = {
        ...(general ? { factAdmissionPolicy: PSU_FACT_POLICY } : {}),
        ...(origin
          ? {
              uncertaintyOrigin: origin,
              history: {
                kind: "product_service_history",
                schemaVersion: 1,
                importedSupport: history,
              },
            }
          : {}),
        scope,
        criteria: c.criteria,
        context: resources,
        model,
        orientation: original.orientation,
        inputExpiresAt: c.totalBudget.deadline,
        request: original,
        ...(website
          ? submittedPages
            ? { submittedPages }
            : {}
          : {
              websitePolicy: { enabled, origins },
              ...(urls.length
                ? { website: { grant: websiteGrant, urls } }
                : {}),
            }),
      };
      if (role === "revision") {
        const evaluationId = c.evaluations.at(-1)!.resultId;
        const evaluation = AgentResultSchema.parse(
          withoutMongoId(
            (await db
              .collection("agent_results")
              .findOne(
                { id: evaluationId, workspaceId: c.workspaceId },
                { session },
              )) ?? {},
          ),
        );
        const payload = EvaluationPayloadSchema.parse(
          evaluation.envelope.outcome.content.domainOutput,
        );
        operationInput = {
          ...(operationInput as object),
          history: {
            kind: "product_service_history",
            schemaVersion: 1,
            importedSupport: history,
          },
          ...(general
            ? {
                revisionPin: {
                  candidate: c.candidates.at(-1)!.reference,
                  evaluation: {
                    resultId: evaluation.id,
                    envelopeDigest: evaluation.envelope.payloadDigest,
                  },
                },
              }
            : {}),
          defects: payload.defects,
        };
      }
      if (role === "evaluator")
        operationInput = EvaluationInputSchema.parse({
          kind: "effectiveness_evaluation_request",
          schemaVersion: 1,
          candidate: c.candidates.at(-1)!.reference,
          criteria: c.criteria,
          policy: PRODUCT_POLICY.identity,
          requestKey: `evaluate:${c.evaluations.length + 1}`,
          instruction: { key: "product_evaluator", ...manifest.instruction },
          importedSupport: history,
        });
      const calls = role === "maker" ? 6 : 2;
      return {
        frozen: parseFrozenWork({
          protocolVersion:
            definition.data.executionImplementation.protocolVersion,
          runId,
          workspaceId: c.workspaceId,
          clientId: c.organisationId,
          operation,
          definition: {
            id: definition.id,
            key: definition.key,
            version: definition.version,
          },
          implementation: {
            ...manifest.implementation,
            manifestDigest: manifest.manifestDigest,
            buildDigest: manifest.buildDigest,
          },
          ...(c.target.kind === "workspace_agent"
            ? {
                executionTarget: {
                  kind: c.target.kind,
                  workspaceId: c.workspaceId,
                  definition: c.target.definition,
                  implementation: c.target.implementation,
                },
                configuration: [],
              }
            : {
                clientAgent: {
                  id: agent!.id,
                  revision: agent!.revision,
                  configuration: agent!.data.configuration,
                },
              }),
          context: { references: resources, snapshots },
          input: JsonPayloadSchema.parse(operationInput),
          resultSchemaVersion: 2,
          checkpointSchemaVersion:
            website && role === "maker"
              ? 5
              : origin
                ? generalClarification
                  ? 4
                  : 3
                : 1,
          grant: {
            id: `grant:${runId}`,
            version: 1,
            runId,
            workspaceId: c.workspaceId,
            expiresAt: c.totalBudget.deadline,
            resources,
            proposalTargets:
              role === "evaluator"
                ? []
                : scope.mode === "create"
                  ? [
                      {
                        kind: "create",
                        targetKind: "offerings",
                        parents: [
                          { relationship: "brand", reference: scope.brand },
                        ],
                      },
                    ]
                  : [
                      {
                        kind: "update",
                        targetKind: "offerings",
                        reference: scope.target,
                      },
                    ],
            tools: urls.length ? [websiteGrant] : [],
            bindings: [],
            models: [model],
            budgets: production
              ? (website ? websiteRunBudget : productionRunBudget)(
                  role,
                  c.totalBudget.deadline,
                )
              : {
                  deadline: c.totalBudget.deadline,
                  modelCalls: calls,
                  toolCalls: urls.length ? 6 : 0,
                  providerCalls: [
                    { provider: "fake_provider", calls },
                    ...(urls.length
                      ? [{ provider: "public_web", calls: 6 }]
                      : []),
                  ],
                  cost: { currency: "GBP", amount: "0.10" },
                },
          },
          traceId: `product:${runId}`,
          lineage: resources.map((r, i) => ({
            id: `source:${i}`,
            role: "requested",
            purpose: "Authorized Product context",
            source: { kind: "resource", reference: r.reference },
            fields: r.fields,
            observedAt: now,
            fetchedAt: now,
          })),
        }),
        limits: {
          attempts: role === "maker" ? 4 : 2,
          failures: production ? 0 : 2,
          inputCycles: 3,
          continuations: 4,
        },
      };
    },
  });
}

/** Historical offline composition remains unchanged. */
export function createProductFoundationProfile(
  config: AppConfig,
  manifest: ImplementationManifest,
  clock = () => new Date(),
) {
  return createProductProfile(config, manifest, clock, false);
}
/** Server-owned production envelope; never selected by a request or client config. */
export function createProductProductionProfile(
  config: AppConfig,
  clock = () => new Date(),
) {
  return createProductProfile(
    config,
    PRODUCT_CLARIFICATION_MANIFEST,
    clock,
    true,
  );
}

/** Explicit versioned factory; registration remains a trusted startup decision. */
export function createWebsiteProductProductionProfile(
  config: AppConfig,
  clock = () => new Date(),
) {
  return createProductProfile(config, PRODUCT_WEBSITE_MANIFEST, clock, true);
}
