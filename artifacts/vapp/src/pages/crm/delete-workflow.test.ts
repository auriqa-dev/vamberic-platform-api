import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { CrmDeletePreview } from "@workspace/api-client-react";
import {
  canDelete,
  clearCrmDeleteCaches,
  createDeleteWorkflow,
} from "./delete-workflow";
const preview: CrmDeletePreview = {
  recordId: "person_00000000000000000000000001",
  recordType: "person",
  previewToken: "a".repeat(64),
  willDelete: [
    {
      collection: "people",
      ids: ["person_00000000000000000000000001"],
      count: 1,
    },
  ],
  blockedBy: [],
};

test("UI requires preview and exact confirmation before passing the current token to DELETE", async () => {
  let loaded = false;
  let deletes = 0;
  let completed = false;
  const workflow = createDeleteWorkflow(
    async () => {
      loaded = true;
      return preview;
    },
    async (input) => {
      assert.equal(loaded, true);
      assert.deepEqual(input, {
        confirm: "DELETE",
        previewToken: preview.previewToken,
      });
      deletes++;
    },
    async () => {
      completed = true;
    },
  );
  await workflow.submit();
  assert.equal(deletes, 0);
  await workflow.open();
  assert.deepEqual(
    workflow.getSnapshot().preview?.willDelete,
    preview.willDelete,
  );
  await workflow.submit();
  assert.equal(deletes, 0);
  workflow.confirm("delete");
  assert.equal(canDelete(workflow.getSnapshot()), false);
  workflow.confirm("DELETE ");
  assert.equal(canDelete(workflow.getSnapshot()), false);
  workflow.confirm("DELETE");
  assert.equal(canDelete(workflow.getSnapshot()), true);
  await workflow.submit();
  assert.equal(deletes, 1);
  assert.equal(completed, true);
  assert.equal(workflow.getSnapshot().phase, "deleted");
});

test("blocker is available for display and disables permanent deletion", async () => {
  const blocker = {
    collection: "transactions",
    count: 1,
    ids: ["transaction_00000000000000000000000001"],
    code: "COMMERCIAL_HISTORY",
    reason: "Financial history must be retained.",
  };
  const workflow = createDeleteWorkflow(
    async () => ({ ...preview, blockedBy: [blocker] }),
    async () => {
      assert.fail("must not delete");
    },
    async () => {},
  );
  await workflow.open();
  workflow.confirm("DELETE");
  assert.deepEqual(workflow.getSnapshot().preview?.blockedBy, [blocker]);
  assert.equal(canDelete(workflow.getSnapshot()), false);
  await workflow.submit();
});

test("delete failure never exposes raw errors and requires reloading and reconfirming", async () => {
  let count = 0;
  const workflow = createDeleteWorkflow(
    async () => preview,
    async () => {
      count++;
      throw new Error("mongodb://secret private@example.com");
    },
    async () => {
      assert.fail("no success");
    },
  );
  await workflow.open();
  workflow.confirm("DELETE");
  await workflow.submit();
  assert.equal(workflow.getSnapshot().phase, "failed");
  assert.equal(workflow.getSnapshot().preview, undefined);
  assert.equal(
    JSON.stringify(workflow.getSnapshot()).includes("private@example.com"),
    false,
  );
  await workflow.submit();
  assert.equal(count, 1);
  await workflow.open();
  assert.equal(workflow.getSnapshot().confirmation, "");
});

test("closing a pending preview discards the response and no duplicate deletion is possible", async () => {
  let resolve!: (value: CrmDeletePreview) => void;
  const workflow = createDeleteWorkflow(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    async () => {},
    async () => {},
  );
  const loading = workflow.open();
  workflow.close();
  resolve(preview);
  await loading;
  assert.equal(workflow.getSnapshot().phase, "closed");
  let finish!: () => void;
  let calls = 0;
  const pending = createDeleteWorkflow(
    async () => preview,
    () => {
      calls++;
      return new Promise<void>((done) => {
        finish = done;
      });
    },
    async () => {},
  );
  await pending.open();
  pending.confirm("DELETE");
  const first = pending.submit();
  await pending.submit();
  pending.close();
  assert.equal(pending.getSnapshot().phase, "deleting");
  finish();
  await first;
  assert.equal(calls, 1);
});

test("successful deletion clears related detail/list/preview/dashboard caches before returning to list", async () => {
  const client = new QueryClient();
  const related = [
    "/api/v1/people",
    "/api/v1/people/person_1",
    "/api/v1/people/person_1/delete-preview",
    "/api/v1/organisations",
    "/api/v1/opportunities",
    "/api/v1/dashboard/summary",
  ];
  for (const key of [...related, "/api/v1/products"])
    client.setQueryData([key], { private: true });
  let navigated = false;
  const workflow = createDeleteWorkflow(
    async () => preview,
    async () => {},
    async () => {
      await clearCrmDeleteCaches(client);
      for (const key of related)
        assert.equal(client.getQueryData([key]), undefined);
      navigated = true;
    },
  );
  await workflow.open();
  workflow.confirm("DELETE");
  await workflow.submit();
  assert.equal(navigated, true);
  assert.deepEqual(client.getQueryData(["/api/v1/products"]), {
    private: true,
  });
  client.clear();
});

test("a 409 refreshes the preview, exposes safe blockers and clears confirmation", async () => {
  let loads = 0;
  const blocker = {
    collection: "transactions",
    count: 1,
    ids: [],
    code: "COMMERCIAL_HISTORY",
    reason: "Financial history must be retained.",
  };
  const workflow = createDeleteWorkflow(
    async () => {
      loads++;
      return loads === 1 ? preview : { ...preview, blockedBy: [blocker] };
    },
    async () => {
      throw { status: 409, data: { message: "raw Mongo private@example.com" } };
    },
    async () => {},
  );
  await workflow.open();
  workflow.confirm("DELETE");
  await workflow.submit();
  assert.equal(loads, 2);
  assert.equal(workflow.getSnapshot().confirmation, "");
  assert.deepEqual(workflow.getSnapshot().preview?.blockedBy, [blocker]);
  assert.equal(canDelete(workflow.getSnapshot()), false);
  assert.equal(
    JSON.stringify(workflow.getSnapshot()).includes("private@example.com"),
    false,
  );
});
