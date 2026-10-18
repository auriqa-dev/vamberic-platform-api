import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadConfig } from "../config";
import { MongoClientService } from "../services/mongo";
import { platformIdSchema } from "../domain";
import { planStrategyTemplates } from "../services/contact-strategy/provision";
import { lockIcpWorkspace } from "../services/icp/access";
/** Operator-only. Dry run by default. Apply requires an explicitly reviewed ID list.
 * No credentials are printed. Never takes workspace display names as identity.
 */
const args = process.argv.slice(2);
let mongo: MongoClientService | undefined;
try {
  if (
    args.length !== 0 &&
    !(args.length === 2 && args[0] === "--apply-workspaces")
  )
    throw new Error(
      "Usage: no arguments for preview; --apply-workspaces reviewed-workspace-ids.json for apply",
    );
  const config = loadConfig();
  if (config.deploymentEnvironment !== "dev") throw new Error("Dev only");
  mongo = new MongoClientService(config.mongodbUri);
  const db = await mongo.database();
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as never);
  if (ledger?.version !== 27) throw new Error("Requires reviewed schema 27");
  const ids = args.length
    ? z
        .array(platformIdSchema("workspace"))
        .min(1)
        .parse(JSON.parse(await readFile(args[1], "utf8")))
    : undefined;
  if (ids && new Set(ids).size !== ids.length)
    throw new Error("Duplicate workspace ID");
  const workspaces = await db
    .collection("crm_workspaces")
    .find(
      {
        kind: "client",
        archived: { $ne: true },
        ...(ids ? { id: { $in: ids } } : {}),
      },
      { projection: { id: 1, name: 1 } },
    )
    .toArray();
  if (ids && workspaces.length !== ids.length)
    throw new Error("Workspace scope mismatch");
  for (const workspace of workspaces) {
    const run = async (
      tx: typeof db,
      session?: import("mongodb").ClientSession,
    ) => {
      const now = session
        ? await lockIcpWorkspace(tx, workspace.id, session)
        : new Date();
      const prior = await tx
        .collection("contact_strategy_policies")
        .find({ workspaceId: workspace.id }, { session })
        .toArray();
      const plan = planStrategyTemplates(workspace.id, prior, now);
      if (session && plan.conflicts.length)
        throw new Error("Policy identity conflict; inspect dry run");
      if (session)
        for (const row of plan.created)
          await tx
            .collection("contact_strategy_policies")
            .insertOne(row, { session });
      return {
        workspaceId: workspace.id,
        name: workspace.name,
        createdIds: session ? plan.created.map((p) => p.id) : [],
        missing: plan.created.map((p) => p.key),
        skipped: plan.skipped,
        conflicts: plan.conflicts,
        reviewRequired: plan.reviewRequired,
        existingPolicyCount: prior.length,
        mode: session ? "applied" : "preview",
      };
    };
    console.log(
      JSON.stringify(
        ids
          ? await mongo.withTransaction((tx, session) => run(tx, session))
          : await run(db),
      ),
    );
  }
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("Usage:")
      ? error.message
      : "Contact Strategy backfill stopped. Previous workspace transactions may have committed; rerun the dry run. No automatic retry.",
  );
  process.exitCode = 1;
} finally {
  await mongo?.close();
}
