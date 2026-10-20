"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { useOrganizationTime } from "./OrganizationTime";
import { toWallTime, wallTimeToInstant } from "../core/organization-time";
type Row = Record<string, any>;
const counts: Record<string, string> = {
  auditEntries: "Audit log entries",
  renders: "Rendered ID cards",
  renderAssets: "Linked render images (shared images retained)",
  exportJobs: "Export job records",
  exportFiles: "Export downloads",
  generationJobs: "Generation job records",
};
export default function PurgeData({
  org,
  initialKind,
  onRefresh,
}: {
  org: string;
  initialKind: "audit" | "renders" | "jobs";
  onRefresh: () => void;
}) {
  const organizationTime = useOrganizationTime();
  const [kind, setKind] = useState(initialKind),
    [before, setBefore] = useState(() => {
      return toWallTime(
        organizationTime.now() - 30 * 86400000,
        organizationTime.timeZone,
      );
    }),
    [preview, setPreview] = useState<Row | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Row>({ receipts: [], pendingFiles: 0 });
  const refresh = () => api(`orgs/${org}/retention`).then(setHistory);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [org]);
  async function run(action: "preview" | "confirm") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api(
        `orgs/${org}/retention`,
        "POST",
        action === "preview"
          ? {
              action,
              kind,
              before: wallTimeToInstant(before, organizationTime.timeZone),
            }
          : { action, id: preview?.id, confirmation },
      );
      if (action === "preview") {
        setPreview(result);
        setConfirmation("");
      } else {
        setPreview(null);
        setConfirmation("");
        setMessage(
          "Purge completed. Removed files are queued for background cleanup.",
        );
        await refresh();
        onRefresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const change = () => {
    setPreview(null);
    setConfirmation("");
    setError("");
  };
  return (
    <section className="panel purge-settings">
      <details>
        <summary>Purge data · Admin only</summary>
        <p>
          Permanently remove selected records from this organization. Preview
          first, then type PURGE to confirm. People, photos, templates, card
          numbers and card status stay intact. Purge receipts are retained.
        </p>
        <fieldset disabled={busy}>
          <div className="two-columns">
            <label>
              Purge category
              <select
                aria-label="Purge category"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  change();
                }}
              >
                <option value="audit">Audit log entries</option>
                <option value="renders">
                  Rendered ID cards & related exports
                </option>
                <option value="jobs">
                  Completed job logs & export downloads
                </option>
              </select>
            </label>
            <label>
              Created before ({organizationTime.timeZone})
              <input
                aria-label="Purge cutoff"
                type="datetime-local"
                step="1"
                value={before}
                onChange={(e) => {
                  setBefore(e.target.value);
                  change();
                }}
              />
            </label>
          </div>
          <p className="muted">
            Up to 1,000 records per category per purge. Active jobs block
            render/job purges. Render purges remove both sides and related
            export downloads; saved card previews will no longer be available.
            Completed job purges retain failed jobs for retry. Existing backups
            retain their copies.
          </p>
          <button
            type="button"
            disabled={!before}
            onClick={() => void run("preview")}
          >
            Preview purge
          </button>
          {preview && (
            <div className="notice">
              <h3>Purge preview</h3>
              {preview.moreAvailable && (
                <p>
                  More matching records remain. After this purge, preview again
                  with the same cutoff to remove the next batch.
                </p>
              )}
              <p>
                Only the records in this preview will be removed. Expires{" "}
                {new Date(preview.expiresAt).toLocaleTimeString()}.
              </p>
              <dl>
                {Object.entries(counts).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{preview.summary[key] || 0}</dd>
                  </div>
                ))}
              </dl>
              <label>
                Type PURGE to confirm
                <input
                  aria-label="Purge confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="danger"
                disabled={
                  confirmation !== "PURGE" ||
                  !Object.values(preview.summary).some((v) => Number(v) > 0)
                }
                onClick={() => void run("confirm")}
              >
                Permanently purge previewed data
              </button>
            </div>
          )}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <p className="muted">
          Files awaiting cleanup: {history.pendingFiles}.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            Refresh cleanup status
          </button>
        </p>
        {history.receipts.length > 0 && (
          <div className="table-scroll">
            <table>
              <caption>Recent purge receipts</caption>
              <thead>
                <tr>
                  <th>Completed</th>
                  <th>Category</th>
                  <th>Cutoff</th>
                </tr>
              </thead>
              <tbody>
                {history.receipts.map((r: Row) => (
                  <tr key={r.id}>
                    <td>{organizationTime.format(r.completed_at)}</td>
                    <td>{r.kind}</td>
                    <td>{organizationTime.format(r.before_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
