import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "./access";
const values = z.array(z.string().trim().min(1).max(150)).max(20);
export const ConsumerFactsSchema = z
  .object({
    country: z.string().trim().max(100),
    region: z.string().trim().max(150),
    needs: values,
    interests: values,
    purchaseStage: z.enum([
      "",
      "exploring",
      "comparing",
      "ready_to_buy",
      "existing_customer",
    ]),
    source: z.string().trim().min(1).max(1000),
    observedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const date = new Date(v);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === v &&
          date.getTime() <= Date.now()
        );
      }),
  })
  .strict();
export function createConsumerFacts(config: AppConfig, mongo: MongoService) {
  async function access(
    db: Db,
    identity: AuthenticatedUser,
    w: string,
    personId: string,
    action: "read" | "update",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    platformIdSchema("person").parse(personId);
    const r = await resolveHvmContext(db, config, identity, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    r.authority.scopeFilter(r.context, action, {
      type: "people",
      workspaceId: w,
    });
    const person = await db
      .collection("people")
      .findOne(
        { id: personId, workspaceId: w, archived: { $ne: true } },
        { session },
      );
    if (!person) throw new AuthorizationDenied();
    return r.context.actor;
  }
  async function read(
    identity: AuthenticatedUser,
    w: string,
    personId: string,
  ) {
    const db = await mongo.database();
    await access(db, identity, w, personId, "read");
    const row = await db.collection("events").findOne({
      workspaceId: w,
      personId,
      eventType: "consumer_characteristics",
    });
    return row
      ? { updatedAt: row.updatedAt.toISOString(), facts: row.payload.facts }
      : null;
  }
  return {
    read,
    async save(
      identity: AuthenticatedUser,
      w: string,
      personId: string,
      raw: unknown,
    ) {
      const input = z
        .object({
          expectedUpdatedAt: z.string().datetime().nullable(),
          facts: ConsumerFactsSchema.nullable(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        const actor = await access(
          db,
          identity,
          w,
          personId,
          "update",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const old = await db
          .collection("events")
          .findOne(
            { workspaceId: w, personId, eventType: "consumer_characteristics" },
            { session },
          );
        if ((old?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt)
          throw new HiveConflict("Consumer details changed; reload first");
        if (old) {
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              personId,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              createdBy: actor,
              updatedBy: actor,
              eventType: "consumer_characteristics_history",
              payload: { facts: old.payload.facts },
            }),
            { session },
          );
          await db.collection("events").updateOne(
            { id: old.id, workspaceId: w, updatedAt: old.updatedAt },
            {
              $set: {
                payload: { facts: input.facts },
                updatedAt: now,
                updatedBy: actor,
              },
            },
            { session },
          );
        } else {
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              personId,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              createdBy: actor,
              updatedBy: actor,
              eventType: "consumer_characteristics",
              payload: { facts: input.facts },
            }),
            { session },
          );
        }
      });
      return read(identity, w, personId);
    },
  };
}
