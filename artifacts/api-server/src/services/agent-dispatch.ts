import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  RuntimeDispatchSchema as DispatchSchema,
  canonicalJson,
} from "@workspace/agent-runtime-protocol";
import type { MongoService } from "./mongo";
import type { createAgentControlPlane } from "./agent-control-plane";
import { requireAgentControlPlane } from "./agent-operators";

export function sqsDispatchSink(client: SQSClient, queueUrl: string) {
  return {
    async send(input: unknown): Promise<void> {
      const message = DispatchSchema.parse(input);
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: canonicalJson(message),
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
    },
  };
}
/** v11 uses the status/id index for nonterminal Runs. The v10 fallback
 * retains its bounded id-index scan, including terminal rows, avoiding unbounded filtered
 * scans and needs no v10 index mutation. One page per tick; measure revisit lag
 * before scaling history. No import-time timer, DDL or worker DB access. */
export function createDispatchScheduler(
  mongo: MongoService,
  control: Pick<
    ReturnType<typeof createAgentControlPlane>,
    "publish" | "reconcile"
  >,
  sink: { send(input: unknown): Promise<void> },
  diagnostic: (code: "dispatch_failed") => void,
) {
  const publisherId = `publisher:${randomUUID()}`;
  let cursor: string | undefined;
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  async function page() {
    const db = await mongo.database();
    await requireAgentControlPlane(db);
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never);
    const rows = await db
      .collection("agent_runs")
      .find(
        {
          ...(cursor ? { id: { $gt: cursor } } : {}),
          ...([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(
            ledger?.version ?? 0,
          )
            ? { status: { $in: ["queued", "running", "awaiting_input"] } }
            : {}),
        },
        {
          projection: { id: 1, status: 1 },
          maxTimeMS: 5_000,
        },
      )
      .sort({ id: 1 })
      .limit(50)
      .toArray();
    if (!rows.length) {
      cursor = undefined;
      return;
    }
    for (const row of rows) {
      if (stopped) return;
      cursor = String(row.id);
      if (["completed", "failed", "cancelled"].includes(row.status)) continue;
      try {
        await control.reconcile(cursor);
        await control.publish(cursor, publisherId, sink);
      } catch {
        diagnostic("dispatch_failed");
      }
    }
  }
  function tick() {
    active = page()
      .catch(() => diagnostic("dispatch_failed"))
      .finally(() => {
        active = undefined;
        if (!stopped) timer = setTimeout(tick, 5_000);
      });
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      tick();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active;
    },
  };
}
