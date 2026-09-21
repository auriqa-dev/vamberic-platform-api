import { DeletePreview } from "./delete-preview";
import { useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  deletePerson,
  deleteOrganisation,
  deleteOpportunity,
  getPersonDeletePreview,
  getOrganisationDeletePreview,
  getOpportunityDeletePreview,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  canDelete,
  clearCrmDeleteCaches,
  createDeleteWorkflow,
  type DeletePageKind,
} from "./delete-workflow";

const apis = {
  people: { preview: getPersonDeletePreview, remove: deletePerson },
  organisations: {
    preview: getOrganisationDeletePreview,
    remove: deleteOrganisation,
  },
  opportunities: {
    preview: getOpportunityDeletePreview,
    remove: deleteOpportunity,
  },
};
export function DeleteDangerZone({
  kind,
  id,
}: {
  kind: DeletePageKind;
  id: string;
}) {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const workflow = useMemo(
    () =>
      createDeleteWorkflow(
        () => apis[kind].preview(id),
        (input) => apis[kind].remove(id, input),
        async () => {
          await clearCrmDeleteCaches(client);
          navigate(`/${kind}`);
          toast({
            title: "Record permanently deleted",
            description:
              "The selected record and approved dependencies were removed.",
          });
        },
      ),
    [kind, id, client, navigate, toast],
  );
  const state = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
    workflow.getSnapshot,
  );
  const busy = state.phase === "deleting";
  return (
    <section className="mt-10 border border-destructive/30 rounded-xl p-5 space-y-3">
      <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
      <p className="text-sm text-muted-foreground">
        Permanent administrative cleanup. This is not an archive action and
        cannot be undone. Commercial and consent history may block deletion.
      </p>
      <Button variant="outline" onClick={() => void workflow.open()}>
        Delete permanently
      </Button>
      <Dialog
        open={state.phase !== "closed" && state.phase !== "deleted"}
        onOpenChange={(open) => {
          if (!open && !busy) workflow.close();
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete permanently</DialogTitle>
            <DialogDescription>
              Review every dependent record below. This cannot be undone.
              People, Organisations and Products outside this scope are
              preserved.
            </DialogDescription>
          </DialogHeader>
          {state.phase === "loading" && (
            <p role="status">Loading deletion preview…</p>
          )}
          {state.error && <p role="alert">{state.error}</p>}
          {state.preview && <DeletePreview preview={state.preview} />}
          {state.preview && state.preview.blockedBy.length === 0 && (
            <div className="space-y-2">
              <label
                htmlFor="crm-delete-confirmation"
                className="text-sm font-medium"
              >
                Type DELETE to confirm permanent deletion
              </label>
              <Input
                id="crm-delete-confirmation"
                value={state.confirmation}
                autoComplete="off"
                disabled={busy}
                onChange={(e) => workflow.confirm(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => workflow.close()}
            >
              Cancel
            </Button>
            {state.phase === "failed" && (
              <Button variant="outline" onClick={() => void workflow.open()}>
                Reload preview
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={!canDelete(state)}
              onClick={() => void workflow.submit()}
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
