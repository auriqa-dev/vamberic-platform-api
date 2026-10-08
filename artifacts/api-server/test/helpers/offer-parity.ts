import type { Document } from "mongodb";
import { offerHash } from "../../src/domain/offers";

export interface OfferParityCase {
  name: string;
  document: Document;
  valid: boolean;
}
// Mutations are explicit expected-contract boundaries, not expectations inferred
// from the implementation under test. Hashes are refreshed except hash-format cases.
export function offerParityCases(
  collection: string,
  baseline: Document,
): OfferParityCase[] {
  const cases: OfferParityCase[] = [];
  function add(
    name: string,
    mutate: (row: Document) => void,
    valid = false,
    hash = true,
  ) {
    const document = structuredClone(baseline);
    mutate(document);
    const offer =
      collection === "offers"
        ? document
        : collection === "offer_revisions"
          ? document.snapshot
          : undefined;
    if (offer && hash)
      offer.contentHash = offerHash(offer as Parameters<typeof offerHash>[0]);
    cases.push({ name, document, valid });
  }
  add("valid baseline", () => {}, true);
  add("invalid record id", (r) => {
    r.id = "bad";
  });
  add("missing workspace", (r) => {
    delete r.workspaceId;
  });
  add("null workspace", (r) => {
    r.workspaceId = null;
  });
  add("wrong workspace prefix", (r) => {
    r.workspaceId = baseline.id;
  });
  add("unknown root field", (r) => {
    r.extra = true;
  });
  const design =
    collection === "offer_designs"
      ? (r: Document) => r
      : collection === "offer_revisions"
        ? (r: Document) => r.designSnapshot
        : undefined;
  if (design) {
    const change = (name: string, f: (d: Document) => void, valid = false) =>
      add(`design: ${name}`, (r) => f(design(r)), valid);
    change(
      "equal timestamps",
      (d) => {
        d.updatedAt = d.createdAt;
      },
      true,
    );
    change("reversed timestamps", (d) => {
      d.updatedAt = new Date(d.createdAt.getTime() - 1);
    });
    change("string date", (d) => {
      d.createdAt = d.createdAt.toISOString();
    });
    change("archive timestamp on active", (d) => {
      d.archivedAt = d.updatedAt;
    });
    change("archived without timestamp", (d) => {
      d.archived = true;
    });
    change("unknown status", (d) => {
      d.status = "approved";
    });
    change("missing completion lineage", (d) => {
      delete d.sourceRevisions;
    });
    change("invalid lineage revision", (d) => {
      d.sourceRevisions.offering.revision = 0;
    });
    change("invalid lineage hash", (d) => {
      d.sourceRevisions.offering.contentHash = "bad";
    });
    change("unknown lineage field", (d) => {
      d.sourceRevisions.icps[0].extra = true;
    });
    change("method version noninteger", (d) => {
      d.methodologyVersion = 1.5;
    });
    change("method key syntax", (d) => {
      d.methodologyKey = "Wrong Key";
    });
    change("method id prefix", (d) => {
      d.methodologyId = d.offeringId;
    });
    change("empty name", (d) => {
      d.work.name = " ";
    });
    change("name too long", (d) => {
      d.work.name = "x".repeat(201);
    });
    change("duplicate targets", (d) => {
      d.work.targetIcpIds.push(d.work.targetIcpIds[0]);
    });
    change("empty completion targets", (d) => {
      d.work.targetIcpIds = [];
    });
    change("invalid buyer prefix", (d) => {
      d.work.targetBuyerProfileIds = [d.offeringId];
    });
    change("duplicate stage keys", (d) => {
      d.work.stages.push(structuredClone(d.work.stages[0]));
    });
    change("duplicate progress", (d) => {
      d.work.completedStageKeys.push(d.work.completedStageKeys[0]);
    });
    change("progress disagrees", (d) => {
      d.work.completedStageKeys.pop();
    });
    change("completed stage missing rationale", (d) => {
      delete d.work.stages[0].decisionRationale;
    });
    change("invalid stage status", (d) => {
      d.work.stages[0].status = "approved";
    });
    change("too many stages", (d) => {
      d.work.stages = Array(31).fill(d.work.stages[0]);
    });
    change("unknown stage field", (d) => {
      d.work.stages[0].hiddenReasoning = "No";
    });
    change("selected absent option", (d) => {
      d.work.stages[0].selectedOptionKeys = ["absent"];
    });
    const option = {
      key: "choice",
      name: "Choice",
      description: "Choice",
      status: "selected",
      rationale: "Selected for fit",
    };
    change("option selection not recorded", (d) => {
      d.work.stages[0].optionsConsidered = [option];
    });
    change(
      "valid selected decision",
      (d) => {
        Object.assign(d.work.stages[0], {
          optionsConsidered: [option],
          selectedOptionKeys: ["choice"],
        });
      },
      true,
    );
    change("duplicate options", (d) => {
      d.work.stages[0].optionsConsidered = [
        { ...option, status: "considered" },
        { ...option, status: "considered" },
      ];
    });
    change("rejection needs rationale", (d) => {
      d.work.stages[0].optionsConsidered = [
        { ...option, status: "rejected", rationale: undefined },
      ];
    });
    change("change proposal needs explanation", (d) => {
      d.work.stages[0].optionsConsidered = [
        { ...option, status: "considered", requiresOfferingChange: true },
      ];
    });
    const reference = {
      key: "source",
      kind: "external_evidence",
      reference: "https://example.com",
      observedAt: "2026-09-01T00:00:00Z",
    };
    change("duplicate evidence keys", (d) => {
      d.work.stages[0].evidence = [reference, reference];
    });
    for (const field of ["research", "facts", "agentFindings", "assumptions"]) {
      const artifact =
        field === "research"
          ? { finding: "Finding" }
          : field === "agentFindings"
            ? { summary: "Candidate", unverified: true }
            : { statement: "Statement" };
      change(`${field} dangling evidence`, (d) => {
        d.work.stages[0][field] = [
          {
            ...artifact,
            ...(field === "assumptions" ? { key: "assumption" } : {}),
            evidenceReferenceKeys: ["absent"],
          },
        ];
      });
    }
    change(
      "valid evidence fact",
      (d) => {
        Object.assign(d.work.stages[0], {
          evidence: [reference],
          facts: [{ statement: "Fact", evidenceReferenceKeys: ["source"] }],
        });
      },
      true,
    );
    change("agent finding must be unverified", (d) => {
      d.work.stages[0].agentFindings = [
        { summary: "Candidate", evidenceReferenceKeys: [], unverified: false },
      ];
    });
    change("invalid assumption status", (d) => {
      d.work.stages[0].assumptions = [
        { key: "assumption", statement: "Maybe", status: "confirmed" },
      ];
    });
    change("empty evidence date", (d) => {
      d.work.stages[0].evidence = [{ ...reference, observedAt: "bad" }];
    });
    change("evidence bound", (d) => {
      d.work.stages[0].evidence = Array(101).fill(reference);
    });
    change("research must be external", (d) => {
      d.work.competitiveAnalysis.findings[0].sources[0].kind = "user_supplied";
    });
    change("research needs findings", (d) => {
      d.work.competitiveAnalysis.findings = [];
    });
    change("research source required", (d) => {
      d.work.competitiveAnalysis.findings[0].sources = [];
    });
    change("research enum", (d) => {
      d.work.competitiveAnalysis.findings[0].kind = "unknown";
    });
    change("human actor only", (d) => {
      d.createdBy.type = "agent";
    });
    change("Partner is not human", (d) => {
      d.updatedBy.id = "partner_someone";
    });
    change("blank human id", (d) => {
      d.updatedBy.id = " ";
    });
    change("invalid issuer", (d) => {
      d.createdBy.issuer = "not a URL";
    });
    if (collection === "offer_designs") {
      change(
        "valid abandoned",
        (d) => {
          d.status = "abandoned";
          d.archived = true;
          d.archivedAt = d.updatedAt;
        },
        true,
      );
      change("archive before creation", (d) => {
        d.status = "abandoned";
        d.archived = true;
        d.archivedAt = new Date(d.createdAt.getTime() - 1);
      });
      change("archive after update", (d) => {
        d.status = "abandoned";
        d.archived = true;
        d.archivedAt = new Date(d.updatedAt.getTime() + 1);
      });
    } else {
      change("snapshot not completed", (d) => {
        d.status = "ready_for_review";
      });
      change("snapshot workspace differs", (d) => {
        d.workspaceId = "workspace_00000000000000000000000001";
      });
      change("snapshot id differs", (d) => {
        d.id = "offerdesign_00000000000000000000000001";
      });
      add(
        "valid revision without optional design snapshot",
        (r) => {
          delete r.designSnapshot;
        },
        true,
      );
    }
  }
  const offer =
    collection === "offers"
      ? (r: Document) => r
      : collection === "offer_revisions"
        ? (r: Document) => r.snapshot
        : undefined;
  if (offer) {
    const change = (
      name: string,
      f: (o: Document) => void,
      valid = false,
      hash = true,
    ) => add(`offer: ${name}`, (r) => f(offer(r)), valid, hash);
    change("reversed chronology", (o) => {
      o.updatedAt = new Date(o.createdAt.getTime() - 1);
    });
    change("approval before creation", (o) => {
      o.approvedAt = new Date(o.createdAt.getTime() - 1);
    });
    change("approval after update", (o) => {
      o.approvedAt = new Date(o.updatedAt.getTime() + 1);
    });
    change("missing approved actor", (o) => {
      delete o.approvedBy;
    });
    change("missing approval date", (o) => {
      delete o.approvedAt;
    });
    change("future approval pointer", (o) => {
      o.approvedRevision = o.revision + 1;
    });
    change("missing approval pointer", (o) => {
      delete o.approvedRevision;
    });
    change("missing lineage", (o) => {
      delete o.lineage;
    });
    change("missing analysis", (o) => {
      delete o.competitiveAnalysis;
    });
    change("active archive date", (o) => {
      o.archivedAt = o.updatedAt;
    });
    change(
      "invalid hash format",
      (o) => {
        o.contentHash = "bad";
      },
      false,
      false,
    );
    change("revision zero", (o) => {
      o.revision = 0;
    });
    change("revision infinite", (o) => {
      o.revision = Infinity;
    });
    change("blank proposition", (o) => {
      o.definition.headlineProposition = " ";
    });
    change("campaign content forbidden", (o) => {
      o.definition.emailSequence = "No";
    });
    change("null optional text", (o) => {
      o.definition.promise = null;
    });
    change("zero targets", (o) => {
      o.definition.targetIcpIds = [];
    });
    change("duplicate buyers", (o) => {
      o.definition.targetBuyerProfileIds.push(
        o.definition.targetBuyerProfileIds[0],
      );
    });
    change("target bound", (o) => {
      o.definition.targetIcpIds = Array(41).fill(o.definition.targetIcpIds[0]);
    });
    change("free price nonzero", (o) => {
      o.definition.commercialTerms.options[0].price.amountMinor = 1;
    });
    change("negative amount", (o) => {
      o.definition.commercialTerms.options[1].price.amountMinor = -1;
    });
    change("fractional amount", (o) => {
      o.definition.commercialTerms.options[1].price.amountMinor = 0.5;
    });
    change("unsafe amount", (o) => {
      o.definition.commercialTerms.options[1].price.amountMinor =
        Number.MAX_SAFE_INTEGER + 1;
    });
    change(
      "max safe amount",
      (o) => {
        o.definition.commercialTerms.options[1].price.amountMinor =
          Number.MAX_SAFE_INTEGER;
      },
      true,
    );
    change("unknown currency", (o) => {
      o.definition.commercialTerms.options[1].price.currency = "ZZZ";
    });
    change("invalid price enum", (o) => {
      o.definition.commercialTerms.options[0].pricingModel = "unknown";
    });
    change("empty price options", (o) => {
      o.definition.commercialTerms.options = [];
    });
    change("commission below zero", (o) => {
      o.definition.commercialTerms.options[1].commissionRate = -0.1;
    });
    change("commission above one", (o) => {
      o.definition.commercialTerms.options[1].commissionRate = 1.1;
    });
    change("commission nonfinite", (o) => {
      o.definition.commercialTerms.options[1].commissionRate = Infinity;
    });
    change("commission NaN", (o) => {
      o.definition.commercialTerms.options[1].commissionRate = NaN;
    });
    change(
      "valid commission endpoints",
      (o) => {
        o.definition.commercialTerms.options[0].commissionRate = 0;
        o.definition.commercialTerms.options[1].commissionRate = 1;
      },
      true,
    );
    change("free component effect nonzero", (o) => {
      o.definition.components = [
        {
          name: "Extra",
          description: "Extra",
          order: 0,
          included: true,
          commercialEffect: {
            name: "Extra",
            pricingModel: "free",
            price: { amountMinor: 1, currency: "GBP" },
          },
        },
      ];
    });
    change("component negative order", (o) => {
      o.definition.components = [
        { name: "Extra", description: "Extra", order: -1, included: true },
      ];
    });
    change("research lacks external source", (o) => {
      o.competitiveAnalysis.findings[0].sources[0].kind = "user_supplied";
    });
    change("bad nested lineage prefix", (o) => {
      o.lineage.icps[0].id = o.offeringId;
    });
    change("lineage revision fraction", (o) => {
      o.lineage.buyers[0].revision = 1.5;
    });
    change("lineage method version zero", (o) => {
      o.lineage.methodology.methodologyVersion = 0;
    });
    if (collection === "offers") {
      change(
        "valid revised draft",
        (o) => {
          o.status = "draft";
          o.revision++;
          delete o.approvedAt;
          delete o.approvedBy;
        },
        true,
      );
      change("draft pointer equal", (o) => {
        o.status = "draft";
        delete o.approvedAt;
        delete o.approvedBy;
      });
      change(
        "valid retired",
        (o) => {
          o.status = "retired";
          o.archived = true;
          o.archivedAt = o.updatedAt;
        },
        true,
      );
      change("retired archive after update", (o) => {
        o.status = "retired";
        o.archived = true;
        o.archivedAt = new Date(o.updatedAt.getTime() + 1);
      });
    } else {
      add("outer revision mismatch", (r) => {
        r.revision++;
      });
      add("outer Offer identity mismatch", (r) => {
        r.offerId = "offer_00000000000000000000000001";
      });
      add("outer workspace mismatch", (r) => {
        r.workspaceId = "workspace_00000000000000000000000001";
      });
    }
  }
  return cases;
}
