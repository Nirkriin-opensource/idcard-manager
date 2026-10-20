"use client";
import { useState, type FormEvent } from "react";
import { api } from "./client";
type Row = Record<string, any>;
export default function PhotoTools({
  org,
  asset,
  fields,
  onChange,
  onError,
}: {
  org: string;
  asset?: Row;
  fields: Row[];
  onChange: (id?: string) => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [over, setOver] = useState(false),
    [match, setMatch] = useState("external_id"),
    [message, setMessage] = useState("");
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    onError("");
    try {
      let matched = 0;
      for (const file of files) {
        const r = await api(
          `orgs/${org}/assets?filename=${encodeURIComponent(file.name)}&match=${encodeURIComponent(match)}`,
          "POST",
          file,
          true,
        );
        matched += Number(r.matched);
      }
      setMessage(
        `${files.length} uploaded; ${matched} matched by filename. Review unmatched photos below.`,
      );
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function crop(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!asset) return;
    const values = Object.fromEntries(
      Array.from(new FormData(e.currentTarget)).map(([k, v]) => [k, Number(v)]),
    );
    setBusy(true);
    try {
      const r = await api(
        `orgs/${org}/assets/${asset.id}/crop`,
        "POST",
        values,
      );
      onChange(r.id);
      setMessage(
        "Cropped image saved as a new asset. Match it to a person below. Historical cards retain their original image.",
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className={"dropzone " + (over ? "selected" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <h3>Drag photos here</h3>
        <p className="muted">
          Or choose multiple JPEG, PNG or WebP files. Filenames match the
          selected field.
        </p>
        <label>
          Match field
          <select value={match} onChange={(e) => setMatch(e.target.value)}>
            <option value="external_id">Organization ID</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Choose photos for matching"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
      </div>
      {message && <p className="notice">{message}</p>}
      {asset && (
        <div className="crop-tools">
          <h3>Crop selected image</h3>
          <p className="muted">
            {asset.original_name || asset.id.slice(0, 8)} · {asset.width} ×{" "}
            {asset.height} pixels. Enter crop bounds in pixels.
          </p>
          <form onSubmit={crop}>
            <div className="toolbar">
              {["left", "top", "width", "height"].map((key) => (
                <label key={asset.id + key}>
                  {key}
                  <input
                    name={key}
                    type="number"
                    min={key === "left" || key === "top" ? 0 : 1}
                    max={
                      key === "left" || key === "width"
                        ? asset.width
                        : asset.height
                    }
                    defaultValue={
                      key === "width"
                        ? asset.width
                        : key === "height"
                          ? asset.height
                          : 0
                    }
                    required
                  />
                </label>
              ))}
              <button disabled={busy}>Save crop as new image</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
