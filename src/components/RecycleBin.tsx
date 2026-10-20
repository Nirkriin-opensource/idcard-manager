"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { useOrganizationTime } from "./OrganizationTime";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  people: "Deleted people",
  photos: "Deleted photos",
  cards: "Issued cards and verification links",
  renders: "Saved card renders",
  cardEvents: "Card lifecycle events",
  generationJobs: "Related generation jobs (whole batches)",
  generationItems: "Items in those generation jobs",
  exportJobs: "Related exports and downloads (whole files)",
  submissions: "Approved form responses",
  importRows: "Related imported spreadsheet rows",
  removedAssets: "Unshared image assets",
  sharedAssetsRetained: "Shared images retained",
};
export default function RecycleBin({
  org,
  onRefresh,
}: {
  org: string;
  onRefresh: () => void;
}) {
  const time = useOrganizationTime();
  const [kind, setKind] = useState<"people" | "photos">("people"),
    [data, setData] = useState<Row>({ items: [], total: 0 }),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<Row | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const selectAll = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview) {
      previewHeading.current?.focus({ preventScroll: true });
      previewHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [preview]);
  const ids = data.items.map((r: Row) => r.id) as string[];
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  const base = `orgs/${org}/recycle-bin`;
  async function refresh() {
    setData(await api(`${base}?kind=${kind}&offset=${offset}`));
  }
  useEffect(() => {
    let current = true;
    setData({ items: [], total: 0 });
    setSelected([]);
    setPreview(null);
    setConfirmation("");
    setError("");
    setMessage("");
    api(`${base}?kind=${kind}&offset=${offset}`)
      .then((r) => {
        if (current) setData(r);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [org, kind, offset]);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selected.length > 0 && !all;
  }, [selected, all]);
  async function run(action: "restore" | "preview" | "confirm", empty = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api(
        base,
        "POST",
        action === "confirm"
          ? { action, id: preview?.id, confirmation }
          : { action, kind, ...(empty ? { all: true } : { ids: selected }) },
      );
      if (action === "preview") {
        setPreview(result);
        setConfirmation("");
      } else {
        setPreview(null);
        setSelected([]);
        setConfirmation("");
        setMessage(
          action === "restore"
            ? `${result.count} ${kind} restored.${kind === "photos" ? " Match restored photos again before generating cards." : ""}`
            : "Permanent purge completed. Image files are queued for background cleanup. Backups retain earlier copies until expiry.",
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
  return (
    <>
      <section className="panel">
        <h2>Recover first. Permanently remove only when finished.</h2>
        <p>
          Deleted People and Photos stay here until restored or permanently
          purged. Templates use their Archive tab; forms can be closed without
          losing responses.
        </p>
        <p className="muted">
          Purge is administrator-only. It removes the previewed linked data and
          cannot be undone in the app. Existing backups retain earlier copies.
          Apply your organization’s retention requirements before proceeding.
        </p>
      </section>
      <section className="panel">
        <fieldset disabled={busy || !!preview}>
          <div className="toolbar">
            <button
              type="button"
              aria-pressed={kind === "people"}
              onClick={() => {
                setKind("people");
                setOffset(0);
              }}
            >
              Deleted people
            </button>
            <button
              type="button"
              aria-pressed={kind === "photos"}
              onClick={() => {
                setKind("photos");
                setOffset(0);
              }}
            >
              Deleted photos
            </button>
            <span>
              {data.total} deleted {kind}
            </span>
          </div>
          <div className="toolbar">
            <label className="check">
              <input
                ref={selectAll}
                type="checkbox"
                aria-label="Select all recycle bin records on this page"
                checked={all}
                disabled={!ids.length}
                onChange={(e) => setSelected(e.target.checked ? ids : [])}
              />
              Select all on this page
            </label>
            <span>{selected.length} selected</span>
            <button
              disabled={!selected.length}
              onClick={() => void run("restore")}
            >
              Restore selected
            </button>
            <button
              className="danger"
              disabled={!selected.length}
              onClick={() => void run("preview")}
            >
              Preview permanent purge
            </button>
            <button
              className="danger"
              disabled={!data.total}
              onClick={() => void run("preview", true)}
            >
              Preview empty {kind} recycle bin
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>{kind === "people" ? "Person" : "Filename"}</th>
                  <th>Deleted</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r: Row) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select deleted ${r.name}`}
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {r.external_id && <code>{r.external_id} · </code>}
                      {r.name}
                    </td>
                    <td>{time.format(r.deleted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && <p>No deleted {kind} on this page.</p>}
          <div className="toolbar">
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </button>
            <span>Page {Math.floor(offset / 100) + 1}</span>
            <button
              disabled={offset + 100 >= data.total}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </button>
          </div>
        </fieldset>
      </section>
      {preview && (
        <section
          className="panel recycle-preview"
          aria-label="Permanent purge preview"
        >
          <h2 ref={previewHeading} tabIndex={-1}>
            Review permanent deletion
          </h2>
          <p>
            Related generation jobs and export files are removed as whole
            batches/files, including other people’s entries in those batches or
            downloads. Their person records and separately saved cards remain.
          </p>
          <dl>
            {Object.entries(labels).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{preview.summary[key] || 0}</dd>
              </div>
            ))}
          </dl>
          {preview.moreAvailable && (
            <p>
              Limited to 1,000 deleted records. Preview again after completion
              for the next group.
            </p>
          )}
          <p>
            Preview expires {time.format(preview.expiresAt)}. Shared images,
            templates, organization settings, user credentials and backups are
            retained.
          </p>
          <label>
            Type PURGE to confirm
            <input
              aria-label="Recycle bin purge confirmation"
              autoComplete="off"
              disabled={busy}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setConfirmation("");
              }}
            >
              Cancel purge
            </button>
            <button
              className="danger"
              disabled={
                busy ||
                confirmation !== "PURGE" ||
                !(preview.summary.people || preview.summary.photos)
              }
              onClick={() => void run("confirm")}
            >
              {busy ? "Processing…" : "Permanently purge previewed data"}
            </button>
          </div>
        </section>
      )}
      {busy && <p role="status">Processing your request…</p>}
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
    </>
  );
}
