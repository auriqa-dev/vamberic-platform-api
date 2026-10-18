import { HiveRevisionSchema } from "../domain/hive-definitions";
import { verifyProductSupport } from "./product-service-understanding/support";
import { collectSupportGraph } from "./canonical-support-graph";
import {
  canonicalDigest,
  SupportApplicationSchema,
  type SupportApplication,
} from "../domain/canonical-support";
import type { ClientSession, Db, Document } from "mongodb";
import {
  digest,
  PRODUCT_CLARIFICATION_MANIFEST,
  GeneralClarificationOrigin,
  selectedCandidate,
  EvaluationInputSchema,
  EvaluationPayloadSchema,
  validateEvaluation,
  type Proposal,
  type SourceLineage,
} from "@workspace/agent-runtime-protocol";
import {
  EffectivenessCaseSchema,
  decideEffectiveness,
} from "../domain/agent-effectiveness";
import { lockAuthorityDocument } from "./agent-authority-serialization";
import {
  AgentRunSchema,
  AgentResultSchema,
} from "../domain/agent-control-plane";
import { withoutMongoId } from "./hvm-context";

export class AgentProposalStale extends Error {}
const resources = new Set([
  "offerings",
  "ideal_customer_profiles",
  "buyer_profiles",
  "offers",
  "offer_designs",
  "brands",
  "brand_kits",
]);
type Reference = Extract<
  SourceLineage["source"],
  { kind: "resource" }
>["reference"];
type ControlledTransition = {
  before: Reference;
  after: Document;
  resultIds: Set<string>;
};

/** Only canonical business resources with reviewed scope semantics. No generic
 * collection name from a Result is ever executed as a database query. */
export async function currentAgentSource(
  db: Db,
  workspaceId: string,
  reference: Reference,
  session: ClientSession,
  visited = new Set<string>(),
) {
  return checkSource(db, workspaceId, reference, session, visited);
}
// Approval-only capability: never accepted by the exported ordinary checker.
async function checkSource(
  db: Db,
  workspaceId: string,
  reference: Reference,
  session: ClientSession,
  visited = new Set<string>(),
  transition?: ControlledTransition,
  ownerResultId?: string,
  forWrite = false,
) {
  if (reference.resourceType === "agent_result_projection") {
    if (
      reference.workspaceId !== workspaceId ||
      visited.has(reference.id) ||
      visited.size >= 20
    )
      throw new AgentProposalStale("Result source scope or cycle");
    visited.add(reference.id);
    const raw = await db
      .collection("agent_results")
      .findOne({ id: reference.id, workspaceId }, { session });
    if (!raw) throw new AgentProposalStale("Result source missing");
    const result = AgentResultSchema.parse(withoutMongoId(raw));
    if (
      result.envelope.payloadDigest !== reference.contentHash ||
      reference.version !== undefined ||
      reference.revision !== undefined
    )
      throw new AgentProposalStale("Result source changed");
    for (const source of result.envelope.outcome.content.lineage)
      if (source.role === "consumed" && source.source.kind === "resource")
        await checkSource(
          db,
          workspaceId,
          source.source.reference,
          session,
          visited,
          transition,
          result.id,
        );
    visited.delete(reference.id);
    return raw;
  }
  if (
    !resources.has(reference.resourceType) ||
    reference.workspaceId !== workspaceId
  )
    throw new AgentProposalStale("Unsupported source scope");
  if (
    transition &&
    ownerResultId &&
    transition.resultIds.has(ownerResultId) &&
    digest(reference) === digest(transition.before)
  )
    return transition.after;
  let row: Document | null = await db
    .collection(reference.resourceType)
    .findOne(
      { id: reference.id, workspaceId, archived: { $ne: true } },
      { session },
    );
  // Reads pinned to the still-approved revision keep using its immutable
  // snapshot while a replacement is drafted. Write targets never use this path.
  if (
    !forWrite &&
    row?.status === "draft" &&
    reference.resourceType === "offerings" &&
    reference.revision !== undefined &&
    row.approvedRevision === reference.revision &&
    row.revision > reference.revision
  ) {
    const saved = await db
      .collection("hive_definition_revisions")
      .findOne(
        {
          workspaceId,
          entityType: "offerings",
          entityId: reference.id,
          revision: reference.revision,
        },
        { session },
      );
    if (!saved)
      throw new AgentProposalStale("Approved source snapshot missing");
    row = HiveRevisionSchema.parse(withoutMongoId(saved)).snapshot;
  }
  const hash =
    row?.contentHash ??
    (row ? digest(JSON.parse(JSON.stringify(withoutMongoId(row)))) : undefined);
  if (
    !row ||
    hash !== reference.contentHash ||
    (reference.revision !== undefined && row.revision !== reference.revision) ||
    (reference.version !== undefined && row.version !== reference.version)
  )
    throw new AgentProposalStale("Agent source changed");
  return row;
}
export async function assertProposalFresh(
  db: Db,
  workspaceId: string,
  proposal: Proposal,
  lineage: SourceLineage[],
  session: ClientSession,
) {
  if (proposal.target.kind === "update") {
    const row = await checkSource(
      db,
      workspaceId,
      proposal.target.reference,
      session,
      new Set(),
      undefined,
      undefined,
      true,
    );
    if (
      !proposal.target.expectedUpdatedAt ||
      row.updatedAt.toISOString() !== proposal.target.expectedUpdatedAt
    )
      throw new AgentProposalStale("Target update token changed or missing");
  } else
    for (const parent of proposal.target.parents)
      await currentAgentSource(db, workspaceId, parent.reference, session);
  for (const source of lineage)
    if (source.role === "consumed" && source.source.kind === "resource")
      await currentAgentSource(
        db,
        workspaceId,
        source.source.reference,
        session,
      );
}
/** Additive approval seam: mutable disposition retains immutable Run/Result/
 * proposal/source provenance. Same-revision human edits do not silently erase
 * source assumptions. A new canonical revision provides the explicit review boundary.
 * Existing v9 approvals never query absent control-plane collections. */
export async function requireFreshAgentApplications(
  db: Db,
  workspaceId: string,
  resource: string,
  target: Document,
  session: ClientSession,
) {
  try {
    return await verifyFreshAgentApplications(
      db,
      workspaceId,
      resource,
      target,
      session,
    );
  } catch (error) {
    if (error instanceof AgentProposalStale) throw error;
    throw new AgentProposalStale(
      "Exact application provenance could not be verified",
    );
  }
}
async function verifyFreshAgentApplications(
  db: Db,
  workspaceId: string,
  resource: string,
  target: Document,
  session: ClientSession,
) {
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  const certifications: SupportApplication[] = [];
  if (
    ![10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(
      ledger?.version ?? 0,
    )
  )
    return certifications;
  const rows = await db
    .collection("agent_results")
    .find(
      {
        workspaceId,
        "dispositions.target.resource": resource,
        "dispositions.target.id": target.id,
      },
      { session },
    )
    .limit(101)
    .toArray();
  if (rows.length > 100)
    throw new AgentProposalStale(
      "Agent provenance history exceeds review bound",
    );
  for (const row of rows) {
    const result = AgentResultSchema.parse(withoutMongoId(row));
    for (const disposition of result.dispositions) {
      if (
        disposition.status !== "applied_to_draft" ||
        disposition.target?.resource !== resource ||
        disposition.target.id !== target.id ||
        disposition.target.revision !== target.revision
      )
        continue;
      const runRaw = await db
        .collection("agent_runs")
        .findOne({ id: result.runId, workspaceId }, { session });
      if (!runRaw) throw new AgentProposalStale("Source Run absent");
      const run = AgentRunSchema.parse(withoutMongoId(runRaw));
      await verifyProductSupport(db, run, result.envelope, session);
      const proposal = result.envelope.outcome.content.proposals.find(
        (p) => p.id === disposition.proposalId,
      );
      if (!proposal) throw new AgentProposalStale("Applied proposal absent");
      let transition: ControlledTransition | undefined;
      let certification: SupportApplication | undefined;
      if (run.effectiveness) {
        const raw = await db
          .collection("agent_effectiveness_cases")
          .findOne({ id: run.effectiveness.caseId, workspaceId }, { session });
        if (!raw) throw new AgentProposalStale("Effectiveness case absent");
        const c = EffectivenessCaseSchema.parse(withoutMongoId(raw));
        const candidate = c.candidates.at(-1)?.reference;
        if (
          c.status !== "passed" ||
          candidate?.resultId !== result.id ||
          candidate.selector.kind !== "proposal" ||
          candidate.selector.proposalId !== disposition.proposalId
        )
          throw new AgentProposalStale("Effectiveness pass is not current");
        // Only exact controlled application, not semantic similarity. updatedAt
        // also catches evidence-only edits and an edit followed by a revert.
        if (
          run.status !== "completed" ||
          result.envelope.outcome.kind !== "success" ||
          result.envelope.outcome.completeness.kind !== "complete" ||
          target.status !== "draft" ||
          target.archived === true ||
          target.workspaceId !== workspaceId ||
          target.contentHash !== disposition.target.contentHash ||
          target.updatedAt.getTime() !==
            disposition.target.updatedAt.getTime() ||
          digest(target.definition) !== digest(proposal.candidate) ||
          candidate.caseId !== c.id ||
          candidate.runId !== run.id ||
          candidate.attemptId !== result.attemptId ||
          candidate.envelopeDigest !== result.envelope.payloadDigest ||
          candidate.contentDigest !==
            digest(
              selectedCandidate(
                result.envelope.outcome.content,
                candidate.selector,
              ),
            )
        )
          throw new AgentProposalStale("Controlled application mismatch");
        const proofCases = [c];
        // A linked clarification is a new Case, not a revision in the old Case.
        // Admit its exact predecessor only through the Platform-frozen origin;
        // merely appearing in Result lineage never extends the transition proof.
        if (
          c.predecessorCase &&
          run.manifest.manifestDigest ===
            PRODUCT_CLARIFICATION_MANIFEST.manifestDigest
        ) {
          const rootRaw = await db
            .collection("agent_runs")
            .findOne({ id: c.rootRunId, workspaceId }, { session });
          const root = AgentRunSchema.parse(withoutMongoId(rootRaw ?? {}));
          const origin = GeneralClarificationOrigin.parse(
            (root.frozen.input as Record<string, unknown>).uncertaintyOrigin,
          );
          const previousRaw = await db
            .collection("agent_effectiveness_cases")
            .findOne({ id: c.predecessorCase.id, workspaceId }, { session });
          const previous = EffectivenessCaseSchema.parse(
            withoutMongoId(previousRaw ?? {}),
          );
          const priorCandidate = previous.candidates.at(-1)?.reference;
          const priorEvaluation = previous.evaluations.at(-1);
          if (
            root.effectiveness?.caseId !== c.id ||
            root.effectiveness.role !== "maker" ||
            root.manifest.manifestDigest !==
              PRODUCT_CLARIFICATION_MANIFEST.manifestDigest ||
            previous.predecessorCase ||
            previous.status !== "held" ||
            previous.stateRevision !== origin.predecessorRevision + 1 ||
            origin.predecessorCaseId !== previous.id ||
            origin.workspaceId !== workspaceId ||
            digest(previous.target) !== digest(c.target) ||
            origin.targetDigest !== digest(c.target) ||
            digest(priorCandidate) !== digest(origin.candidate) ||
            c.predecessorCase.candidateDigest !==
              priorCandidate?.contentDigest ||
            c.predecessorCase.criteriaDigest !== previous.criteria.digest ||
            origin.criteriaDigest !== previous.criteria.digest ||
            origin.profileDigest !== previous.criteria.profile.digest ||
            origin.policyDigest !== previous.policy.identity.digest ||
            priorEvaluation?.resultId !== origin.evaluationResultId ||
            priorEvaluation.candidateRevision !== priorCandidate?.revision
          )
            throw new AgentProposalStale(
              "Controlled clarification predecessor mismatch",
            );
          const priorEvaluationRaw = await db
            .collection("agent_results")
            .findOne(
              { id: origin.evaluationResultId, workspaceId },
              { session },
            );
          const priorResult = AgentResultSchema.parse(
            withoutMongoId(priorEvaluationRaw ?? {}),
          );
          const priorPayload = EvaluationPayloadSchema.parse(
            priorResult.envelope.outcome.content.domainOutput,
          );
          if (
            priorResult.envelope.payloadDigest !==
              origin.evaluationEnvelopeDigest ||
            digest(priorPayload) !== origin.evaluationDigest ||
            digest(priorPayload.candidate) !== digest(origin.candidate) ||
            priorPayload.defects.length ||
            origin.criterionIds.some(
              (id) =>
                !priorPayload.assessments.some(
                  (a) => a.criterionId === id && a.outcome === "uncertain",
                ),
            ) ||
            origin.applicability.assessments.some(
              (a) =>
                digest(
                  priorPayload.assessments.find(
                    (x) => x.criterionId === a.criterionId,
                  ),
                ) !== a.digest,
            )
          )
            throw new AgentProposalStale(
              "Controlled clarification Evaluation mismatch",
            );
          proofCases.push(previous);
        }
        const resultIds = new Set<string>();
        for (const proofCase of proofCases)
          for (const item of proofCase.candidates) {
            const ref = item.reference;
            const rawCandidate = await db
              .collection("agent_results")
              .findOne({ id: ref.resultId, workspaceId }, { session });
            if (!rawCandidate)
              throw new AgentProposalStale("Candidate source absent");
            const historical = AgentResultSchema.parse(
              withoutMongoId(rawCandidate),
            );
            if (
              ref.caseId !== proofCase.id ||
              historical.runId !== ref.runId ||
              historical.attemptId !== ref.attemptId ||
              historical.envelope.payloadDigest !== ref.envelopeDigest ||
              digest(
                selectedCandidate(
                  historical.envelope.outcome.content,
                  ref.selector,
                ),
              ) !== ref.contentDigest
            )
              throw new AgentProposalStale("Candidate source mismatch");
            const candidateRun = await db
              .collection("agent_runs")
              .findOne({ id: ref.runId, workspaceId }, { session });
            if (
              !candidateRun ||
              candidateRun.effectiveness?.caseId !== proofCase.id ||
              candidateRun.effectiveness?.role === "evaluator"
            )
              throw new AgentProposalStale("Candidate Run mismatch");
            resultIds.add(ref.resultId);
          }
        const decision = c.decisions.at(-1)!;
        const evaluationEntry = c.evaluations.find(
          (e) => e.resultId === decision.evaluationResultId,
        );
        const evaluationRaw = await db
          .collection("agent_results")
          .findOne(
            { id: decision.evaluationResultId, workspaceId },
            { session },
          );
        if (!evaluationRaw || !evaluationEntry)
          throw new AgentProposalStale("Passing evaluation absent");
        const evaluated = AgentResultSchema.parse(
          withoutMongoId(evaluationRaw),
        );
        const evaluatorRaw = await db
          .collection("agent_runs")
          .findOne({ id: evaluated.runId, workspaceId }, { session });
        if (!evaluatorRaw) throw new AgentProposalStale("Evaluator Run absent");
        const evaluator = AgentRunSchema.parse(withoutMongoId(evaluatorRaw));
        const evaluationInput = EvaluationInputSchema.parse(
          evaluator.frozen.input,
        );
        const assessment = validateEvaluation(
          evaluated.envelope.outcome.content,
          evaluationInput,
          {
            allowedNotApplicable: c.criteria.criteria
              .filter((x) => x.applicabilityRule !== "always")
              .map((x) => x.id),
            modelInvocationIds: evaluated.envelope.usage
              .filter((x) => x.category === "model")
              .map((x) => x.invocationId),
          },
        );
        if (
          evaluationEntry.runId !== evaluated.runId ||
          evaluationEntry.requestKey !== assessment.requestKey ||
          evaluationEntry.candidateRevision !== candidate.revision ||
          evaluator.effectiveness?.caseId !== c.id ||
          evaluator.effectiveness.role !== "evaluator" ||
          evaluator.status !== "completed" ||
          evaluated.envelope.outcome.kind !== "success" ||
          evaluated.envelope.outcome.completeness.kind !== "complete" ||
          digest(assessment.candidate) !== digest(candidate) ||
          digest(evaluationInput.criteria) !== digest(c.criteria) ||
          digest(assessment.policy) !== digest(c.policy.identity) ||
          decision.policyDigest !== c.policy.identity.digest ||
          decideEffectiveness({
            criteria: c.criteria,
            policy: c.policy,
            evaluation: assessment,
            revision: candidate.revision,
            blockingGap: evaluated.envelope.outcome.content.knowledgeGaps.some(
              (g) => g.severity === "blocking",
            ),
            fresh: true,
            authorized: true,
            canRevise: true,
            oscillation: false,
          }).kind !== "pass"
        )
          throw new AgentProposalStale("Passing evaluation mismatch");
        if (proposal.target.kind === "update") {
          const before = proposal.target.reference;
          if (
            before.resourceType !== resource ||
            before.id !== target.id ||
            before.workspaceId !== workspaceId ||
            before.revision === undefined ||
            !before.contentHash ||
            !proposal.target.expectedUpdatedAt ||
            !run.frozen.grant.proposalTargets.some(
              (t) =>
                t.kind === "update" &&
                t.targetKind === resource &&
                digest(t.reference) === digest(before),
            ) ||
            !result.envelope.outcome.content.lineage.some(
              (l) =>
                proposal.lineageIds.includes(l.id) &&
                l.role === "consumed" &&
                l.source.kind === "resource" &&
                digest(l.source.reference) === digest(before),
            )
          )
            throw new AgentProposalStale("Original target provenance mismatch");
          transition = { before, after: target, resultIds };
        }
        const definition = await lockAuthorityDocument(
          db,
          { collection: "agent_definitions", id: run.frozen.definition.id },
          session,
        );
        if (
          definition.status !== "active" ||
          definition.archived === true ||
          definition.data.executionImplementation?.manifestDigest !==
            run.manifest.manifestDigest ||
          !definition.data.effectiveness?.some(
            (p: unknown) => digest(p) === digest(c.definition),
          )
        )
          throw new AgentProposalStale("Effectiveness policy withdrawn");
        for (const source of c.criteria.lineage)
          if (source.source.kind === "resource")
            await checkSource(
              db,
              workspaceId,
              source.source.reference,
              session,
              new Set(),
              transition,
              result.id,
            );
        for (const proofCase of proofCases)
          for (const evaluation of proofCase.evaluations) {
            if (!evaluation.resultId) continue;
            const row = await db
              .collection("agent_results")
              .findOne({ id: evaluation.resultId, workspaceId }, { session });
            if (!row) throw new AgentProposalStale("Evaluation source absent");
            const e = AgentResultSchema.parse(withoutMongoId(row));
            const assessment = EvaluationPayloadSchema.parse(
              e.envelope.outcome.content.domainOutput,
            );
            const evaluatedCandidate = proofCase.candidates.find(
              (x) => digest(x.reference) === digest(assessment.candidate),
            );
            const evaluationRun = await db
              .collection("agent_runs")
              .findOne({ id: e.runId, workspaceId }, { session });
            if (
              !evaluatedCandidate ||
              e.runId !== evaluation.runId ||
              assessment.requestKey !== evaluation.requestKey ||
              assessment.criteriaDigest !== proofCase.criteria.digest ||
              digest(assessment.policy) !== digest(proofCase.policy.identity) ||
              evaluationRun?.effectiveness?.caseId !== proofCase.id ||
              evaluationRun?.effectiveness?.role !== "evaluator"
            )
              throw new AgentProposalStale(
                "Historical evaluation lineage mismatch",
              );
            transition?.resultIds.add(e.id);

            for (const source of e.envelope.outcome.content.lineage)
              if (
                source.role === "consumed" &&
                source.source.kind === "resource"
              )
                await checkSource(
                  db,
                  workspaceId,
                  source.source.reference,
                  session,
                  new Set(),
                  transition,
                  e.id,
                );
          }
        if (
          [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(ledger?.version ?? 0) &&
          resource === "offerings"
        ) {
          const graph = await collectSupportGraph(
            db,
            workspaceId,
            session,
            [
              ...new Set([
                ...resultIds,
                ...c.evaluations.flatMap((e) =>
                  e.resultId ? [e.resultId] : [],
                ),
              ]),
            ],
            transition,
            c.criteria.lineage,
          );
          for (const ref of graph.independent)
            await currentAgentSource(db, workspaceId, ref, session);
          certification = SupportApplicationSchema.parse({
            runId: run.id,
            attemptId: result.attemptId,
            resultId: result.id,
            envelopeDigest: result.envelope.payloadDigest,
            proposalId: proposal.id,
            caseId: c.id,
            candidateDigest: digest(candidate),
            evaluationResultId: evaluated.id,
            evaluationDigest: evaluated.envelope.payloadDigest,
            criteriaDigest: digest(c.criteria),
            policyDigest: digest(c.policy),
            definitionId: run.frozen.definition.id,
            manifestDigest: run.manifest.manifestDigest,
            appliedDraftDigest: canonicalDigest(disposition.target),
            ...graph,
          });
        }
        if (c.stateRevision >= 1_000_000)
          throw new AgentProposalStale("Case revision exhausted");
        const locked = await db
          .collection("agent_effectiveness_cases")
          .updateOne(
            { id: c.id, workspaceId, stateRevision: c.stateRevision },
            { $set: { stateRevision: c.stateRevision + 1 } },
            { session },
          );
        if (!locked.matchedCount)
          throw new AgentProposalStale("Effectiveness review changed");
      }
      for (const source of result.envelope.outcome.content.lineage) {
        if (source.role !== "consumed" || source.source.kind !== "resource")
          continue;
        // Proposal's previous target is intentionally changed by application.
        // External consumed source assumptions remain guarded until approval.
        if (
          !run.effectiveness &&
          proposal.target.kind === "update" &&
          source.source.reference.resourceType === resource &&
          source.source.reference.id === target.id
        )
          continue;
        await checkSource(
          db,
          workspaceId,
          source.source.reference,
          session,
          new Set(),
          transition,
          result.id,
        );
      }
      if (certification) certifications.push(certification);
    }
  }
  return certifications;
}
