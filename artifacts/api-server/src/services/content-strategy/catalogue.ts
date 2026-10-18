import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { resolveHvmContext, withoutMongoId } from "../hvm-context";
import { ActionTypeSchema, actionTypeHash } from "../../domain/action-library";
import { generatePlatformId } from "../../domain";
import { HiveConflict } from "../hive-definitions";
export const CONTENT_ACTION_TYPES = [
  {
    key: "external_initiative",
    name: "Commission external initiative",
    description:
      "Commission reviewed PR, events, partnerships, advertising or specialist work. Assignment records responsibility, not spending or sending authority.",
  },
  {
    key: "content_creation",
    name: "Create content",
    description:
      "Produce a draft asset from a reviewed brief. Production does not grant publication or communication authority.",
  },
  {
    key: "content_adaptation",
    name: "Adapt content",
    description:
      "Adapt or update existing sources for an audience or channel while preserving evidence and provenance.",
  },
  {
    key: "content_research",
    name: "Research or collect evidence",
    description:
      "Gather missing evidence or investigate a content question. No unsupported claim or execution authority is implied.",
  },
  {
    key: "content_review",
    name: "Review content",
    description:
      "Human review of claims, content quality, source freshness or production dependencies.",
  },
] as const;
export async function initialiseContentTypes(
  config: AppConfig,
  mongo: MongoService,
  identity: AuthenticatedUser,
) {
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const resolved = await resolveHvmContext(db, config, identity, session);
    resolved.authority.scopeFilter(resolved.context, "create", {
      type: "action_types",
    });
    const now = new Date(),
      result = [];
    for (const item of CONTENT_ACTION_TYPES) {
      const raw = await db
        .collection("action_types")
        .findOne({ key: item.key, version: 1 }, { session });
      const data = {
        name: item.name,
        description: item.description,
        capabilityIds: [],
      };
      const hash = actionTypeHash({ key: item.key, version: 1, data });
      if (raw) {
        const prior = ActionTypeSchema.parse(withoutMongoId(raw));
        if (prior.contentHash !== hash)
          throw new HiveConflict(
            "Existing Library type differs; review the catalogue rather than replacing it.",
          );
        result.push(prior.id);
        continue;
      }
      const row = ActionTypeSchema.parse({
        id: generatePlatformId("actiontype"),
        key: item.key,
        version: 1,
        data,
        contentHash: hash,
        status: "active",
        availability: "queens",
        createdAt: now,
        updatedAt: now,
        createdBy: resolved.context.actor,
        updatedBy: resolved.context.actor,
        archived: false,
        schemaVersion: 1,
      });
      await db.collection("action_types").insertOne(row, { session });
      result.push(row.id);
    }
    return { ids: result };
  });
}
