import type { QueryClient } from "@tanstack/react-query";
import type {
  CrmDeleteInput,
  CrmDeletePreview,
} from "@workspace/api-client-react";

export type DeletePageKind = "people" | "organisations" | "opportunities";
export interface DeleteState {
  phase: "closed" | "loading" | "ready" | "deleting" | "failed" | "deleted";
  confirmation: string;
  preview?: CrmDeletePreview;
  error?: string;
}
export function canDelete(state: DeleteState): boolean {
  return (
    state.phase === "ready" &&
    state.confirmation === "DELETE" &&
    !!state.preview &&
    state.preview.blockedBy.length === 0
  );
}
/** Shared UI workflow: a current preview and explicit text are mandatory. */
export function createDeleteWorkflow(
  load: () => Promise<CrmDeletePreview>,
  remove: (input: CrmDeleteInput) => Promise<unknown>,
  onDeleted: () => Promise<void>,
) {
  let state: DeleteState = { phase: "closed", confirmation: "" };
  let generation = 0;
  const listeners = new Set<() => void>();
  const set = (next: DeleteState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async open() {
      if (state.phase === "deleting") return;
      const current = ++generation;
      set({ phase: "loading", confirmation: "" });
      try {
        const preview = await load();
        if (current === generation)
          set({ phase: "ready", confirmation: "", preview });
      } catch {
        if (current === generation)
          set({
            phase: "failed",
            confirmation: "",
            error:
              "Unable to load deletion preview. The record may be missing or deletion may be unavailable.",
          });
      }
    },
    close() {
      if (state.phase !== "deleting") {
        generation++;
        set({ phase: "closed", confirmation: "" });
      }
    },
    confirm(value: string) {
      if (state.phase === "ready") set({ ...state, confirmation: value });
    },
    async submit() {
      if (!canDelete(state)) return;
      const preview = state.preview!;
      set({ ...state, phase: "deleting" });
      try {
        await remove({ confirm: "DELETE", previewToken: preview.previewToken });
      } catch (error) {
        // A 409 cannot be resolved with the old confirmation. Refresh the safe
        // preview so newly discovered blockers are immediately visible.
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        ) {
          try {
            const refreshed = await load();
            set({
              phase: "ready",
              confirmation: "",
              preview: refreshed,
              error:
                "Dependencies changed or protected records block deletion. Review the refreshed preview before confirming again.",
            });
            return;
          } catch {
            /* Fall through to a generic safe error. */
          }
        }
        // Never display raw API/Mongo text. A fresh preview exposes safe blockers.
        set({
          phase: "failed",
          confirmation: "",
          error:
            "Deletion was not confirmed. Reload the preview to check blockers or changes before trying again.",
        });
        return;
      }
      set({ phase: "deleted", confirmation: "" });
      // Do not offer a second deletion if post-success UI/cache work fails.
      await onDeleted();
    },
  };
}
export async function clearCrmDeleteCaches(client: QueryClient) {
  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      typeof query.queryKey[0] === "string" &&
      /^\/api\/v1\/(people|organisations|opportunities|dashboard)(?:\/|$)/.test(
        query.queryKey[0],
      ),
  };
  await client.cancelQueries(filters);
  await client.invalidateQueries({ ...filters, refetchType: "none" });
  client.removeQueries(filters);
}
