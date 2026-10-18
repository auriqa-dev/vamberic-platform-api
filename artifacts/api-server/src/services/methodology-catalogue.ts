import { createHash } from "node:crypto";
import type { Db, ClientSession, Document } from "mongodb";
import { EventSchema, generatePlatformId } from "../domain";
import {
  getOfferMethodology,
  listOfferMethodologies,
} from "../domain/offer-methodologies";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext } from "./hvm-context";
import { readOperating, mutateOperating, OperatingConflict } from "./operating";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

/** Persist the complete immutable implementation alongside its Empress publication.
 * Chunks respect the existing event payload size; no schema/collection migration.
 */
export async function persistMethodologyDefinition(
  db: Db,
  session: ClientSession,
  row: Document,
  actor: unknown,
) {
  const method = getOfferMethodology(
    row.data.methodology.id,
    row.data.methodology.version,
  );
  if (!method) throw new OperatingConflict("Unknown methodology version");
  const text = JSON.stringify(method),
    hash = digest(text);
  const prior = await db.collection("events").findOne(
    {
      eventType: "offer_methodology_definition",
      "payload.methodologyId": method.id,
      "payload.version": method.version,
    },
    { session },
  );
  if (prior) {
    if (prior.payload.hash !== hash)
      throw new OperatingConflict(
        "Published methodology definition changed; register a new version",
      );
    return;
  }
  const id = generatePlatformId("event"),
    now = new Date();
  const parts = text.match(/[\s\S]{1,3000}/g)!;
  const base = {
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    actor,
    source: { system: "hvm_methodology_catalogue" },
  };
  for (let part = 0; part < parts.length; part++)
    await db.collection("events").insertOne(
      EventSchema.parse({
        ...base,
        id: generatePlatformId("event"),
        eventType: "offer_methodology_definition_part",
        payload: { definitionId: id, part, text: parts[part] },
      }),
      { session },
    );
  await db.collection("events").insertOne(
    EventSchema.parse({
      ...base,
      id,
      eventType: "offer_methodology_definition",
      payload: {
        methodologyId: method.id,
        version: method.version,
        hash,
        parts: parts.length,
        catalogueId: row.id,
      },
    }),
    { session },
  );
}

export async function readMethodologyCatalogue(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
) {
  // Empress authorization is enforced by the existing registry path.
  await readOperating(mongo, config, identity, "methodology_availability", {
    limit: 1,
    offset: 0,
  });
  const db = await mongo.database();
  const definitions = [];
  for (const method of listOfferMethodologies()) {
    const header = await db.collection("events").findOne({
      eventType: "offer_methodology_definition",
      "payload.methodologyId": method.id,
      "payload.version": method.version,
    });
    let persisted = false;
    if (header) {
      const rows = await db
        .collection("events")
        .find({
          eventType: "offer_methodology_definition_part",
          "payload.definitionId": header.id,
        })
        .toArray();
      const text = rows
        .sort((a, b) => a.payload.part - b.payload.part)
        .map((r) => r.payload.text)
        .join("");
      persisted =
        rows.length === header.payload.parts &&
        digest(text) === header.payload.hash &&
        text === JSON.stringify(method);
    }
    definitions.push({ ...method, persisted });
  }
  return { items: definitions };
}

export async function registerMethodology(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  id: string,
  version: number,
) {
  const method = getOfferMethodology(id, version);
  if (!method || method.status !== "active")
    throw new OperatingConflict("Unknown active methodology");
  const page = (await readOperating(
    mongo,
    config,
    identity,
    "methodology_availability",
    { key: method.key, limit: 100, offset: 0 },
  )) as Document;
  let row = page.items.find((r: Document) => r.version === version);
  if (
    row &&
    (row.data.methodology.id !== id || row.data.methodology.version !== version)
  )
    throw new OperatingConflict(
      "Catalogue version already has a different methodology",
    );
  if (!row)
    row = (await mutateOperating(
      mongo,
      config,
      identity,
      "methodology_availability",
      "create",
      {
        key: method.key,
        version,
        availability: "queens",
        data: {
          name: method.name,
          description: method.description,
          methodology: { id, version },
          compatibleAgents: [],
        },
      },
    )) as Document;
  if (row.status === "draft")
    row = (await mutateOperating(
      mongo,
      config,
      identity,
      "methodology_availability",
      "publish",
      {
        id: row.id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
      },
    )) as Document;
  if (row.status !== "active" || row.archived)
    throw new OperatingConflict(
      "This catalogue version is retired; it will not be reactivated automatically",
    );
  // Existing active catalogue entries predate definition snapshots. Backfill only
  // the immutable definition, after rechecking Empress write authority.
  await mongo.withTransaction!(async (db, session) => {
    const resolved = await resolveHvmContext(db, config, identity, session);
    resolved.authority.scopeFilter(resolved.context, "update", {
      type: "methodology_availability",
    });
    await persistMethodologyDefinition(
      db,
      session,
      row!,
      resolved.context.actor,
    );
  });
  return row;
}
