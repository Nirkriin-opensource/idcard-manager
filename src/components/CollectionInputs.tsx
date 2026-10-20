"use client";
import type { CollectionField } from "../core/collection-schema";
export default function CollectionInputs({
  fields,
  values,
  onChange,
  onImage,
  disabled = false,
}: {
  fields: CollectionField[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  onImage?: (key: string, file: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="collection-inputs">
      {fields.map((f) => (
        <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
          <span>
            {f.label}
            {f.required ? " *" : ""}
          </span>
          {f.type === "image" ? (
            onImage ? (
              <>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required={f.required}
                  disabled={disabled}
                  onChange={(e) => onImage(f.key, e.target.files?.[0] || null)}
                />
                <small>
                  JPEG, PNG or WebP · up to 4 MB.{" "}
                  {f.key === "photo"
                    ? "Use a clear photo of one person; the face will be framed for the card."
                    : "Upload a clear signature image."}
                </small>
              </>
            ) : (
              <small>See the uploaded image below.</small>
            )
          ) : f.type === "textarea" ? (
            <textarea
              maxLength={4000}
              required={f.required}
              disabled={disabled}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          ) : f.type === "select" ? (
            <select
              required={f.required}
              disabled={disabled}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
            >
              <option value="">Select…</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "boolean" ? (
            <input
              type="checkbox"
              required={f.required}
              disabled={disabled}
              checked={!!values[f.key]}
              onChange={(e) => onChange(f.key, e.target.checked)}
            />
          ) : (
            <input
              type={f.type}
              required={f.required}
              disabled={disabled}
              step={f.type === "number" ? "any" : undefined}
              maxLength={
                f.key === "external_id"
                  ? 100
                  : f.key === "name" || f.key === "designation"
                    ? 200
                    : f.key === "phone"
                      ? 40
                      : 4000
              }
              value={values[f.key] ?? ""}
              onChange={(e) =>
                onChange(
                  f.key,
                  f.type === "number" && e.target.value !== ""
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
        </label>
      ))}
    </div>
  );
}
