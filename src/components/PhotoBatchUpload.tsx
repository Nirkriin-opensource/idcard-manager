"use client";
import { useRef, useState } from "react";
import { api } from "./client";

export default function PhotoBatchUpload({
  org,
  fields,
  busy,
  run,
  onChange,
  onNotice,
}: {
  org: string;
  fields: { key: string; label: string }[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onChange: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [images, setImages] = useState<File[]>([]);
  const [zip, setZip] = useState<File | null>(null);
  const [match, setMatch] = useState("external_id");
  const [uploading, setUploading] = useState<"images" | "zip" | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const base = `orgs/${org}/`;
  async function send(path: string, file: File) {
    try {
      return await api(path, "POST", file, true);
    } catch (error) {
      if (
        error instanceof TypeError &&
        /fetch|network|load failed/i.test(error.message)
      )
        throw new Error(
          "The photo upload connection was interrupted. Check your connection to this site. Your file is still selected. Refresh the photo list to check whether it completed before uploading again.",
        );
      throw error;
    }
  }
  async function upload(kind: "images" | "zip") {
    if (busy || uploading || (kind === "zip" ? !zip : !images.length)) return;
    setUploading(kind);
    try {
      await run(async () => {
        if (kind === "zip" && zip && zip.size > 25 * 1024 * 1024)
          throw new Error(
            "Photo ZIP exceeds 25 MB. Split it into smaller ZIP files with up to 200 photos each, then choose a smaller file.",
          );
        if (
          kind === "images" &&
          images.some((file) => file.size > 12 * 1024 * 1024)
        )
          throw new Error(
            "A photo exceeds 12 MB. Resize it and select the images again.",
          );
        if (kind === "zip" && zip) {
          const result = await send(
            `${base}photos?match=${encodeURIComponent(match)}&filename=${encodeURIComponent(zip.name)}`,
            zip,
          );
          const matched = result.results.filter((r: any) => r.matched).length;
          const unmatched = result.results.filter((r: any) => !r.matched);
          setZip(null);
          if (zipInput.current) zipInput.current.value = "";
          onNotice(
            `ZIP uploaded. ${matched} matched; ${unmatched.length} need attention.${unmatched.length ? " " + unmatched.map((r: any) => r.filename).join(", ") : ""}`,
          );
        } else {
          let completed = 0;
          for (const file of images) {
            await send(
              `${base}assets?filename=${encodeURIComponent(file.name)}&match=${encodeURIComponent(match)}`,
              file,
            );
            completed++;
            // Keep only unfinished files selected if a later upload fails.
            setImages(images.slice(completed));
          }
          if (imageInput.current) imageInput.current.value = "";
          onNotice(
            `${completed} images uploaded; unique filename matches were assigned automatically. Select a photo below to review or match manually.`,
          );
        }
        await onChange();
      });
    } finally {
      setUploading(null);
    }
  }
  const disabled = busy || !!uploading;
  return (
    <>
      <label>
        Photo matching field
        <select
          value={match}
          disabled={disabled}
          onChange={(e) => setMatch(e.target.value)}
        >
          <option value="external_id">Organization ID</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="two-columns">
        <div>
          <label>
            Multiple images
            <input
              ref={imageInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={disabled}
              onChange={(e) => {
                setImages(Array.from(e.target.files || []));
                onNotice("");
              }}
            />
          </label>
          <p className="muted">
            Images are resized and stripped of original metadata. Maximum 12 MB
            each. Selecting files does not upload them.
          </p>
          {images.length > 0 && (
            <p role="status">
              {images.length} images ready to upload:{" "}
              {images.map((file) => file.name).join(", ")}
            </p>
          )}
          <button
            className="primary"
            disabled={disabled || !images.length}
            onClick={() => void upload("images")}
          >
            {uploading === "images" ? "Uploading images…" : "Upload images"}
          </button>
        </div>
        <div>
          <label>
            Photo ZIP
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              disabled={disabled}
              onChange={(e) => {
                setZip(e.target.files?.[0] || null);
                onNotice("");
              }}
            />
          </label>
          <p className="muted">
            Choose a ZIP, check the matching field, then click Upload ZIP.
          </p>
          {zip && (
            <p role="status">
              Ready to upload: {zip.name} ({(zip.size / 1024 / 1024).toFixed(2)}{" "}
              MB)
            </p>
          )}
          <button
            className="primary"
            disabled={disabled || !zip}
            onClick={() => void upload("zip")}
          >
            {uploading === "zip" ? "Uploading ZIP…" : "Upload ZIP"}
          </button>
        </div>
      </div>
      {uploading && (
        <p role="status">Uploading and matching photos. Please wait…</p>
      )}
    </>
  );
}
