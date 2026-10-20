"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
export default function BulkRecordSelection({
  org,
  kind,
  ids,
  selected,
  onSelect,
  deleted,
  onDone,
}: {
  org: string;
  kind: "people" | "photos";
  ids: string[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  deleted: boolean;
  onDone: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [pendingIds, setPendingIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const checkbox = useRef<HTMLInputElement>(null);
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  useEffect(() => {
    if (checkbox.current)
      checkbox.current.indeterminate = selected.length > 0 && !all;
  }, [selected, all]);
  useEffect(() => {
    setConfirm(false);
    setError("");
  }, [org, deleted]);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`orgs/${org}/bulk-records`, "POST", {
        kind,
        ids: deleted ? selected : pendingIds,
        action: deleted ? "restore" : "delete",
      });
      setConfirm(false);
      onSelect([]);
      onDone(`${r.count} ${kind} ${deleted ? "restored" : "deleted"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            ref={checkbox}
            style={{ width: "auto" }}
            type="checkbox"
            aria-label={
              kind === "people"
                ? "Select all people on this page"
                : "Select all loaded photos"
            }
            checked={all}
            disabled={busy || !ids.length}
            onChange={(e) => onSelect(e.target.checked ? ids : [])}
          />
          {kind === "people"
            ? "Select all on this page"
            : "Select all loaded photos"}
        </label>
        <span>{selected.length} selected</span>
        {selected.length > 0 && (
          <button
            className={deleted ? "primary" : "danger"}
            disabled={busy}
            onClick={() => {
              if (deleted) void apply();
              else {
                setPendingIds([...selected]);
                setConfirm(true);
              }
            }}
          >
            {deleted ? "Restore selected" : "Delete selected"} (
            {selected.length})
          </button>
        )}
      </div>
      {error && !confirm && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`bulk-delete-${kind}`}
          >
            <h2 id={`bulk-delete-${kind}`}>Delete selected {kind}</h2>
            <p>
              Delete {pendingIds.length} selected {kind}?
            </p>
            <p>
              {kind === "people"
                ? "They will move to Deleted people. Card history is kept, and verification is disabled until restored."
                : "They will move to Deleted photos and be removed from current person matches. Existing card images are kept. Restored photos can be matched again."}
            </p>
            <p>You can restore these items from the deleted view.</p>
            <div className="toolbar">
              <button disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void apply()}
              >
                {busy ? "Deleting…" : "Delete selected"}
              </button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
