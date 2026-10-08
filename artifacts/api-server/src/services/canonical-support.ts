import { verifyProductSupport } from "./product-service-understanding/support";
import type { Db, ClientSession, Document } from "mongodb";
import {
  digest,
  selectedCandidate,
  ProductCanonicalContextSchema,
  ProductOutputSchema,
  type ResultContent,
} from "@workspace/agent-runtime-protocol";
import {
  SupportCertificateSchema,
  SupportReferenceSchema,
  CERTIFICATE_EVENT,
  canonicalDigest,
} from "../domain/canonical-support";
import {
  AgentResultSchema,
  AgentRunSchema,
} from "../domain/agent-control-plane";
import { EffectivenessCaseSchema } from "../domain/agent-effectiveness";
import { HiveRevisionSchema } from "../domain/hive-definitions";
import { collectSupportGraph } from "./canonical-support-graph";
import {
  currentAgentSource,
  AgentProposalStale,
} from "./agent-proposal-freshness";
import { withoutMongoId, resolveHvmContext } from "./hvm-context";
import {
  lockAuthorityDocument,
  type AuthorityAnchor,
} from "./agent-authority-serialization";
import { AuthorizationDenied } from "../authorization/policy";
import type { MongoService } from "./mongo";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";

export async function projectCanonicalSupport(
  db: Db,
  workspaceId: string,
  session: ClientSession,
  reference: ReturnType<typeof SupportReferenceSchema.parse>,
  authorize: (r: ReturnType<typeof SupportReferenceSchema.parse>) => void,
  traversal = new Set<string>(),
) {
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (![18, 19, 20, 21, 22, 23, 24, 25].includes(ledger?.version ?? 0))
    throw new AgentProposalStale(
      "Canonical support requires applied schema 18",
    );
  const visit = `certificate:${digest(reference)}`;
  if (
    traversal.has(visit) ||
    [...traversal].filter((k) => !k.startsWith("dependency:")).length >= 20
  )
    throw new AgentProposalStale("Canonical traversal bound");
  traversal.add(visit);
  authorize(reference);
  if (reference.resourceType !== "offerings")
    throw new AgentProposalStale("Unsupported canonical root");
  // Canonical writers share this workspace document; use its existing real-write anchor.
  await lockAuthorityDocument(
    db,
    { collection: "crm_workspaces", id: workspaceId },
    session,
  );
  const row = await currentAgentSource(db, workspaceId, reference, session);
  if (
    reference.resourceType !== "offerings" ||
    reference.revision === undefined ||
    row.status !== "approved" ||
    row.approvedRevision !== reference.revision ||
    row.archived
  )
    throw new AgentProposalStale("Canonical root is not current approved");
  const events = await db
    .collection("events")
    .find(
      {
        workspaceId,
        eventType: CERTIFICATE_EVENT,
        "payload.resource": "offerings",
        "payload.entityId": reference.id,
        "payload.revision": reference.revision,
        "payload.policyVersion": 1,
      },
      { session },
    )
    .limit(2)
    .toArray();
  if (events.length !== 1)
    throw new AgentProposalStale("Missing or ambiguous certificate");
  const event = events[0]!,
    k = SupportCertificateSchema.parse(event.payload);
  const rawSnapshot = await db
    .collection("hive_definition_revisions")
    .findOne({ id: k.snapshotId, workspaceId }, { session });
  if (!rawSnapshot) throw new AgentProposalStale("Approval snapshot missing");
  const snapshot = HiveRevisionSchema.parse(withoutMongoId(rawSnapshot));
  if (
    k.workspaceId !== workspaceId ||
    k.entityId !== reference.id ||
    k.revision !== reference.revision ||
    k.contentHash !== reference.contentHash ||
    snapshot.entityType !== "offerings" ||
    snapshot.entityId !== reference.id ||
    snapshot.revision !== reference.revision ||
    canonicalDigest(snapshot.snapshot) !== k.snapshotDigest ||
    canonicalDigest(withoutMongoId(row)) !== k.snapshotDigest ||
    canonicalDigest(row.evidence) !== k.evidenceDigest ||
    row.approvedAt.toISOString() !== k.approvedAt ||
    canonicalDigest(row.approvedBy) !== canonicalDigest(k.approver) ||
    event.occurredAt.toISOString() !== k.approvedAt
  )
    throw new AgentProposalStale("Canonical certificate snapshot mismatch");
  const composed: {
    field: "explicitExclusions";
    value: string[];
    findingJson: string;
    evidence: ResultContent["evidence"];
  }[] = [];
  const dependencies: ReturnType<typeof SupportReferenceSchema.parse>[] = [];
  for (const a of k.applications) {
    const rawRun = await db
        .collection("agent_runs")
        .findOne({ id: a.runId, workspaceId }, { session }),
      rawResult = await db
        .collection("agent_results")
        .findOne({ id: a.resultId, workspaceId }, { session }),
      rawCase = await db
        .collection("agent_effectiveness_cases")
        .findOne({ id: a.caseId, workspaceId }, { session });
    if (!rawRun || !rawResult || !rawCase)
      throw new AgentProposalStale("Certificate application absent");
    const run = AgentRunSchema.parse(withoutMongoId(rawRun)),
      result = AgentResultSchema.parse(withoutMongoId(rawResult)),
      c = EffectivenessCaseSchema.parse(withoutMongoId(rawCase));
    await verifyProductSupport(db, run, result.envelope, session, traversal);
    const candidate = c.candidates.find(
      (x) => digest(x.reference) === a.candidateDigest,
    )?.reference;
    const proposal = result.envelope.outcome.content.proposals.find(
      (p) => p.id === a.proposalId,
    );
    const disposition = result.dispositions.find(
      (d) => d.proposalId === a.proposalId && d.status === "applied_to_draft",
    );
    if (
      !candidate ||
      !proposal ||
      !disposition?.target ||
      canonicalDigest(disposition.target) !== a.appliedDraftDigest ||
      result.runId !== run.id ||
      result.attemptId !== a.attemptId ||
      result.envelope.payloadDigest !== a.envelopeDigest ||
      candidate.resultId !== result.id ||
      candidate.runId !== run.id ||
      candidate.attemptId !== a.attemptId ||
      candidate.envelopeDigest !== a.envelopeDigest ||
      candidate.selector.kind !== "proposal" ||
      candidate.selector.proposalId !== proposal.id ||
      digest(
        selectedCandidate(result.envelope.outcome.content, candidate.selector),
      ) !== candidate.contentDigest ||
      run.frozen.definition.id !== a.definitionId ||
      run.manifest.manifestDigest !== a.manifestDigest ||
      run.effectiveness?.caseId !== c.id ||
      digest(c.criteria) !== a.criteriaDigest ||
      digest(c.policy) !== a.policyDigest ||
      !c.decisions.some(
        (d) =>
          d.evaluationResultId === a.evaluationResultId && d.kind === "pass",
      )
    )
      throw new AgentProposalStale("Certificate application changed");
    const definition = await lockAuthorityDocument(
      db,
      { collection: "agent_definitions", id: a.definitionId },
      session,
    );
    if (
      definition.archived ||
      definition.status !== "active" ||
      definition.data.executionImplementation?.manifestDigest !==
        a.manifestDigest ||
      !definition.data.effectiveness?.some(
        (p: unknown) => digest(p) === digest(c.definition),
      )
    )
      throw new AgentProposalStale("Certified policy withdrawn");
    const roots = a.witnesses.map((w) => w.id);
    const graph = await collectSupportGraph(
      db,
      workspaceId,
      session,
      roots,
      proposal.target.kind === "update"
        ? { before: proposal.target.reference, resultIds: new Set(roots) }
        : undefined,
      c.criteria.lineage,
      traversal,
    );
    const expected = {
      witnesses: a.witnesses,
      selfEdges: a.selfEdges,
      independent: a.independent,
      independentSnapshots: a.independentSnapshots,
      proofDigests: a.proofDigests,
      inputWitnesses: a.inputWitnesses,
    };
    if (
      digest(graph) !== digest(expected) ||
      !graph.witnesses.some(
        (w) =>
          w.id === a.evaluationResultId &&
          w.envelopeDigest === a.evaluationDigest,
      )
    )
      throw new AgentProposalStale("Certificate dependency closure mismatch");
    const domain = ProductOutputSchema.safeParse(
      result.envelope.outcome.content.domainOutput,
    );
    for (const statement of domain.success ? domain.data.statements : []) {
      if (statement.canonicalBinding?.field !== "explicitExclusions") continue;
      const finding = result.envelope.outcome.content.findings.find(
        (f) => f.id === statement.findingId,
      );
      if (
        !finding?.payload ||
        digest(statement.canonicalBinding.value) !==
          digest(row.definition.explicitExclusions)
      )
        continue;
      composed.push({
        field: "explicitExclusions",
        value: statement.canonicalBinding.value as string[],
        findingJson: JSON.stringify(finding),
        evidence: result.envelope.outcome.content.evidence.filter((e) =>
          finding.evidenceIds.includes(e.id),
        ),
      });
    }
    for (const ref of graph.independent) {
      const dependencyKey = `dependency:${digest(ref)}`;
      if (
        !traversal.has(dependencyKey) &&
        [...traversal].filter((k) => k.startsWith("dependency:")).length >= 40
      )
        throw new AgentProposalStale("Aggregate independent dependency bound");
      traversal.add(dependencyKey);
      authorize(ref);
      await currentAgentSource(db, workspaceId, ref, session);
      if (!dependencies.some((d) => digest(d) === digest(ref)))
        dependencies.push(ref);
    }
  }
  // This bounded proof projection carries no raw Result, permission or grant.
  return ProductCanonicalContextSchema.parse({
    kind: "canonical_support_context" as const,
    schemaVersion: 1 as const,
    root: reference,
    certificateId: event.id as string,
    certificateDigest: k.digest,
    snapshotDigest: k.snapshotDigest,
    evidenceDigest: k.evidenceDigest,
    dependencies,
    composed,
  });
}
/** Human read seam only. Agent preparation still needs its own authorized,
 * pinned context integration; a human projection is never a worker grant. */
export async function readCanonicalSupport(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  rawReference: unknown,
) {
  const reference = SupportReferenceSchema.parse(rawReference),
    workspaceId = reference.workspaceId;
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as Document, { session });
    if (![18, 19, 20, 21, 22, 23, 24, 25].includes(ledger?.version ?? 0))
      throw new AgentProposalStale(
        "Canonical support requires applied schema 18",
      );
    let resolved = await resolveHvmContext(db, config, identity, session);
    const authorize = (r: ReturnType<typeof SupportReferenceSchema.parse>) => {
      if (
        r.workspaceId !== workspaceId ||
        resolved.context.actor.type !== "human"
      )
        throw new AuthorizationDenied();
      resolved.authority.scopeFilter(resolved.context, "read", {
        type: r.resourceType,
        workspaceId,
      });
    };
    authorize(reference);
    await lockAuthorityDocument(
      db,
      { collection: "crm_workspaces", id: workspaceId },
      session,
    );
    // Lock all current positive membership chains, then resolve again. No
    // historical actor or Empress grant supplies workspace authority here.
    const human = resolved.response.human;
    for (const collection of [
      "workspace_memberships",
      "hvm_partner_memberships",
    ] as const) {
      const rows = await db
        .collection(collection)
        .find(
          {
            "human.id": human.id,
            "human.issuer": human.issuer,
            status: "active",
            archived: { $ne: true },
            ...(collection === "workspace_memberships" ? { workspaceId } : {}),
          },
          { session },
        )
        .limit(201)
        .toArray();
      if (rows.length > 200) throw new AuthorizationDenied();
      for (const r of rows) {
        await lockAuthorityDocument(db, { collection, id: r.id }, session);
        if (collection === "hvm_partner_memberships") {
          await lockAuthorityDocument(
            db,
            { collection: "hvm_partners", id: r.partnerId },
            session,
          );
          const assignments = await db
            .collection("workspace_partner_assignments")
            .find({ workspaceId, partnerId: r.partnerId }, { session })
            .limit(201)
            .toArray();
          if (assignments.length > 200) throw new AuthorizationDenied();
          for (const assignment of assignments)
            await lockAuthorityDocument(
              db,
              {
                collection: "workspace_partner_assignments",
                id: assignment.id,
              } as AuthorityAnchor,
              session,
            );
        }
      }
    }
    resolved = await resolveHvmContext(db, config, identity, session);
    return projectCanonicalSupport(
      db,
      workspaceId,
      session,
      reference,
      authorize,
    );
  });
}
