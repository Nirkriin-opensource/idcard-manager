"use client";
import { useState, useEffect } from "react";
import { api } from "./client";
import {
  cardTypes,
  generalCardFields,
  cardFieldCatalog,
  defaultCardPolicy,
  type CardType,
  type CardPolicy,
} from "../core/card-field-catalog";

export default function CardFields({
  org,
  onRefresh,
}: {
  org: string;
  onRefresh: () => void;
}) {
  const [kind, setKind] = useState<CardType>("staff"),
    [profiles, setProfiles] = useState<Partial<Record<CardType, CardPolicy>>>(
      {},
    ),
    [policy, setPolicy] = useState<CardPolicy>({
      ...defaultCardPolicy("staff"),
      general: true,
    }),
    [assets, setAssets] = useState<Record<string, any>[]>([]),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const base = `orgs/${org}/`;
  useEffect(() => {
    let cancelled = false;
    Promise.all([api(base + "card-profiles"), api(base + "assets")])
      .then(([s, a]) => {
        if (!cancelled) {
          setProfiles(s.profiles);
          setPolicy({
            ...(s.profiles.staff || defaultCardPolicy("staff")),
            general: true,
          });
          setAssets(a);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(template = false) {
    await task(async () => {
      await api(base + "card-profiles", template ? "POST" : "PUT", {
        kind,
        policy,
      });
      setProfiles({ ...profiles, [kind]: policy });
      onRefresh();
      setMessage(
        template
          ? "Card template created. Open Templates to preview and edit its layout."
          : "Field choices saved. Download a fresh upload kit to use these requirements.",
      );
    });
  }
  function toggle(key: string, column: "shown" | "required", checked: boolean) {
    setPolicy((p) => ({
      ...p,
      [column]: checked
        ? [...new Set([...p[column], key])]
        : p[column].filter((k) => k !== key),
      ...(column === "required" && checked
        ? { shown: [...new Set([...p.shown, key])] }
        : {}),
      ...(column === "shown" && !checked
        ? { required: p.required.filter((k) => k !== key) }
        : {}),
    }));
  }
  return (
    <section className="panel">
      <h2>Card fields & mandatory rules</h2>
      <p>
        Choose the fields printed on your General card and which must be
        completed. Name and ID are always required to identify records. Photos
        and signatures are checked when generating cards, after people are
        imported.
      </p>
      <p>
        <strong>General card</strong> · Select fields and mandatory rules for
        everyone.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Show on card</th>
              <th>Mandatory</th>
            </tr>
          </thead>
          <tbody>
            {generalCardFields.map((f) => (
              <tr key={f.key}>
                <td>
                  {f.label}
                  {f.key === "rfid" && (
                    <small>
                      {" "}
                      (stored identifier; chip encoding needs hardware)
                    </small>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Show ${f.label}`}
                    type="checkbox"
                    checked={policy.shown.includes(f.key)}
                    disabled={busy || ["name", "external_id"].includes(f.key)}
                    onChange={(e) => toggle(f.key, "shown", e.target.checked)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Require ${f.label}`}
                    type="checkbox"
                    checked={policy.required.includes(f.key)}
                    disabled={busy || ["name", "external_id"].includes(f.key)}
                    onChange={(e) =>
                      toggle(f.key, "required", e.target.checked)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Shared card images</h3>
      {(["organization_logo", "authorized_signature"] as const).map((key) => (
        <div key={key}>
          <label>
            {key === "organization_logo"
              ? "Organization logo"
              : "Authorized signature"}
            <select
              value={policy.assets[key] || ""}
              disabled={busy}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  assets: {
                    ...policy.assets,
                    [key]: e.target.value || undefined,
                  },
                })
              }
            >
              <option value="">Not selected</option>
              {assets
                .filter((a) => a.kind !== "RENDER")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.original_name || a.kind + " " + a.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Upload{" "}
            {key === "organization_logo" ? "logo" : "authorized signature"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void task(async () => {
                    const a = await api(
                      base +
                        `assets?kind=${key === "organization_logo" ? "LOGO" : "SIGNATURE"}&filename=${encodeURIComponent(file.name)}`,
                      "POST",
                      file,
                      true,
                    );
                    setAssets(await api(base + "assets"));
                    setPolicy((p) => ({
                      ...p,
                      assets: { ...p.assets, [key]: a.id },
                    }));
                    setMessage(
                      "Image uploaded. Save field choices to apply it.",
                    );
                  });
              }}
            />
          </label>
        </div>
      ))}
      <p>
        Cardholder signatures are uploaded in the person editor. Visitor expiry
        uses a date, time and timezone. Shared images and mandatory changes
        apply to newly generated cards; saved cards retain their original images
        and details.
      </p>
      <div className="toolbar">
        <button disabled={busy} onClick={() => void save()}>
          Save field choices
        </button>
      </div>
      <p className="muted">
        Create the shared template in Appearance & card themes. Full-field
        designs use a tall 85.6 × 110 mm layout with a reverse side for codes
        and signatures. Review the preview before printing; use the designer for
        your card dimensions and longer addresses.
      </p>
      <p>
        <a href={`/api/${base}upload-templates?kind=kit&general=1`}>
          Download General import kit
        </a>
      </p>
      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
