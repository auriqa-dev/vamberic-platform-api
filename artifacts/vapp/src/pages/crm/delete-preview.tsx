import React from "react";
import type { CrmDeletePreview } from "@workspace/api-client-react";
export function DeletePreview({ preview }: { preview: CrmDeletePreview }) {
  return (
    <div className="space-y-4">
      <p className="text-sm break-all">Target: {preview.recordId}</p>
      <p className="font-medium">
        {preview.blockedBy.length
          ? "Proposed scope — deletion is blocked"
          : "Records that will be permanently deleted"}
      </p>
      <ul className="space-y-2">
        {preview.willDelete.map((group) => (
          <li key={group.collection}>
            <details>
              <summary className="cursor-pointer">
                {group.collection.replaceAll("_", " ")}: {group.count}
              </summary>
              <ul className="text-xs text-muted-foreground break-all pl-4">
                {group.ids.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      {preview.blockedBy.length > 0 && (
        <div
          role="alert"
          className="border border-destructive rounded-md p-3 space-y-2"
        >
          <h3 className="font-semibold">Deletion blocked</h3>
          {preview.blockedBy.map((blocker, index) => (
            <div key={index}>
              <p>
                {blocker.reason} ({blocker.collection.replaceAll("_", " ")}:{" "}
                {blocker.count})
              </p>
              <details>
                <summary className="text-sm cursor-pointer">
                  Blocking record IDs
                </summary>
                <p className="text-xs break-all">{blocker.ids.join(", ")}</p>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
