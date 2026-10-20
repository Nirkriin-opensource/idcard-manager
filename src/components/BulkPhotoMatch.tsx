"use client";
import { useState } from "react";
import { api } from "./client";
export default function BulkPhotoMatch({
  org,
  fields,
  onChange,
}: {
  org: string;
  fields: { key: string; label: string }[];
  onChange: () => void;
}) {
  const [field, setField] = useState("external_id"),
    [ignoreSpaces, setIgnoreSpaces] = useState(true),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(action: "preview" | "apply") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(`orgs/${org}/photo-matches`, "POST", {
        field,
        ignore_spaces: ignoreSpaces,
        action,
        preview_token: action === "apply" ? preview?.preview_token : undefined,
      });
      if (action === "preview") setPreview(result);
      else {
        setPreview(null);
        setNotice(
          `${result.matched} photos matched. Existing assignments were kept. Create a new card batch to use these photos.`,
        );
        onChange();
      }
    } catch (e) {
      setError((e as Error).message);
      if (action === "apply") setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Bulk match uploaded photos</h2>
      <p>
        1. Choose Organization ID. 2. Preview the matches. 3. Click Match
        photos. You do not need to upload the photos again.
      </p>
      <label>
        Bulk matching field
        <select
          disabled={busy}
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setPreview(null);
          }}
        >
          <option value="external_id">Organization ID</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={ignoreSpaces}
          disabled={busy}
          onChange={(e) => {
            setIgnoreSpaces(e.target.checked);
            setPreview(null);
          }}
        />
        Ignore spaces in filenames and IDs (Admin_ 1.jpg matches Admin_1)
      </label>
      <p className="muted">
        Existing photo assignments stay unchanged. Identical duplicate uploads
        count as one choice; conflicting photos or IDs require manual matching.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <button disabled={busy} onClick={() => void run("preview")}>
        {busy ? "Please wait…" : "Preview bulk matches"}
      </button>
      {preview && (
        <>
          <p role="status">
            {preview.ready} ready to match; {preview.skipped} skipped.
          </p>
          <button
            className="primary"
            disabled={busy || !preview.ready}
            onClick={() => void run("apply")}
          >
            Match {preview.ready} photos
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Photo filename</th>
                  <th>Person / ID</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item: any) => (
                  <tr key={item.asset_id}>
                    <td>{item.filename}</td>
                    <td>
                      {item.person_name} {item.external_id}
                    </td>
                    <td>
                      {item.reason}
                      {item.duplicates
                        ? ` (${item.duplicates} duplicate uploads)`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
