"use client";
import { useEffect, useState, type FormEvent } from "react";
import CollectionInputs from "./CollectionInputs";
import type { CollectionField } from "../core/collection-schema";
import { formatOrganizationTime } from "../core/organization-time";
type PublicForm = {
  title: string;
  profession: string;
  description: string;
  organization_name: string;
  version: number;
  fields: CollectionField[];
  timeZone: string;
  hour12: boolean;
  closes_at: string | null;
};
export default function PublicCollection({
  org,
  token,
}: {
  org: string;
  token: string;
}) {
  const [form, setForm] = useState<PublicForm | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(""),
    [loaded, setLoaded] = useState(false),
    [values, setValues] = useState<Record<string, any>>({}),
    [images, setImages] = useState<Record<string, File>>({}),
    [consent, setConsent] = useState(false),
    [website, setWebsite] = useState("");
  const endpoint = `/api/collect/${encodeURIComponent(org)}/${encodeURIComponent(token)}`;
  useEffect(() => {
    let live = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(`${d.error} ${d.fix || ""}`);
        if (live) setForm(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [endpoint]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const files: Record<string, string> = {};
      for (const [key, file] of Object.entries(images)) {
        if (file.size > 4 * 1024 * 1024)
          throw new Error("Each image must be 4 MB or smaller.");
        files[key] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () =>
            reject(new Error("The image could not be read."));
          reader.readAsDataURL(file);
        });
      }
      const normalized = { ...values };
      const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: form.version,
            values: normalized,
            images: files,
            consent,
            website,
            time_zone: form.timeZone,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(`${d.error} ${d.fix || ""}`);
      setDone(d.reference);
      setValues({});
      setImages({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="collection-public">
      <div className="collection-brand">IDcard Manager</div>
      <section className="panel">
        {!loaded ? (
          <p>Loading form…</p>
        ) : done ? (
          <>
            <h1>Details submitted</h1>
            <p>
              The organization will review your details before adding them to
              its card records.
            </p>
            <p>
              Reference: <strong>{done}</strong>
            </p>
          </>
        ) : (
          <>
            {form && (
              <>
                <p className="eyebrow">
                  {form.organization_name} · {form.profession}
                </p>
                <h1>{form.title}</h1>
                <p className="preserve-lines">{form.description}</p>
                <p className="muted">Fields marked * are required.</p>
                <p className="muted">Organization time zone: {form.timeZone}</p>
                {form.closes_at && (
                  <p>Closes: {formatOrganizationTime(form.closes_at, form)}</p>
                )}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {form && (
              <form onSubmit={submit}>
                <CollectionInputs
                  fields={form.fields}
                  values={values}
                  onChange={(k, v) => setValues({ ...values, [k]: v })}
                  disabled={busy}
                  onImage={(k, f) => {
                    setError("");
                    setImages((old) => {
                      const next = { ...old };
                      delete next[k];
                      if (f) {
                        if (f.size > 4 * 1024 * 1024)
                          setError("Each image must be 4 MB or smaller.");
                        next[k] = f;
                      }
                      return next;
                    });
                  }}
                />
                <div className="collection-honeypot" aria-hidden="true">
                  <label>
                    Website
                    <input
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>
                <label className="collection-consent">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    disabled={busy}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  I agree that {form.organization_name} may use these details
                  and images to prepare my ID card.
                </label>
                <button className="primary" disabled={busy || !consent}>
                  {busy ? "Submitting…" : "Submit details"}
                </button>
              </form>
            )}
          </>
        )}
      </section>
      <p className="muted">
        Your submission is visible to this organization’s administrators. This
        form cannot display other people’s details.
      </p>
    </main>
  );
}
