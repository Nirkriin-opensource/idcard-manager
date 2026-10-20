"use client";
import { browserId } from "./browser-id";
import { useEffect, useState } from "react";
import { api } from "./client";
import { starterTemplate } from "../core/starter";
type State = {
  step: number;
  logoId?: string;
  templateId?: string;
  personId?: string;
  cardId?: string;
  requestKey: string;
  done?: boolean;
};
const steps = [
  "Organization",
  "Logo",
  "Template",
  "People",
  "Photos",
  "Sample card",
  "Print settings",
  "Finish",
];
export default function Setup({
  org,
  user,
  name,
  onNavigate,
  onRefresh,
}: {
  org: string;
  user: string;
  name: string;
  onNavigate: (tab: string) => void;
  onRefresh: () => void;
}) {
  const key = `idcard-setup:${user}:${org}`;
  const [state, setState] = useState<State>({ step: 0, requestKey: "" }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let next: State = { step: 0, requestKey: browserId() };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (
        saved &&
        Number.isInteger(saved.step) &&
        saved.step >= 0 &&
        saved.step < 8 &&
        typeof saved.requestKey === "string"
      )
        next = saved;
    } catch {}
    setState(next);
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        setMessage(
          "Browser storage is unavailable; keep this tab open to retain setup progress.",
        );
      }
  }, [state, loaded, key]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const next = () => setState((s) => ({ ...s, step: Math.min(7, s.step + 1) }));
  const base = `orgs/${org}/`;
  async function checkPeople() {
    const p = await api(base + "people");
    if (!p.total)
      throw new Error(
        "Add or import at least one person, then return to Setup.",
      );
    const person = p.items[0],
      kind = person.custom_fields?.card_type;
    const templates = await api(base + "templates");
    const compatible = (t: Record<string, any>) =>
      !t.archived &&
      (t.card_type === "general" ||
        (kind
          ? t.card_type === kind || t.card_type === "shared"
          : !t.card_type));
    const selected =
      templates.find(
        (t: Record<string, any>) => t.id === state.templateId && compatible(t),
      ) || templates.find(compatible);
    if (!selected)
      throw new Error(
        "No compatible template for the sample person. Set their Card type and create the shared template in Organization, then return to Setup.",
      );
    setState((s) => ({
      ...s,
      templateId: selected.id,
      personId: person.id,
      step: 4,
    }));
  }
  if (!loaded) return <p>Opening setup…</p>;
  if (state.done)
    return (
      <section className="panel">
        <h2>Your first-card setup is complete</h2>
        <p>
          Your data and saved print profile are ready. Activate cards only after
          checking their details. Print a sample at 100% and scan its QR before
          a production batch.
        </p>
        <button onClick={() => onNavigate("Cards")}>Open cards</button>
        <button
          onClick={() => setState((s) => ({ ...s, done: false, step: 0 }))}
        >
          Review setup
        </button>
      </section>
    );
  return (
    <section className="panel setup-wizard">
      <p className="eyebrow">FIRST CARD · STEP {state.step + 1} OF 8</p>
      <h2>{steps[state.step]}</h2>
      <progress aria-label="Setup progress" max={8} value={state.step + 1} />
      <ol className="setup-steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === state.step ? "step" : undefined}>
            {s}
          </li>
        ))}
      </ol>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="notice">{message}</p>}
      {state.step === 0 && (
        <>
          <p>
            You’re setting up <strong>{name}</strong>. Choose another
            organization from the sidebar if needed.
          </p>
          <button onClick={next}>Use this organization</button>
        </>
      )}
      {state.step === 1 && (
        <>
          <p>Upload an organization logo, or continue without one.</p>
          <label>
            Organization logo
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
                        "assets?kind=LOGO&filename=" +
                        encodeURIComponent(file.name),
                      "POST",
                      file,
                      true,
                    );
                    setState((s) => ({ ...s, logoId: a.id }));
                    setMessage("Logo saved.");
                  });
              }}
            />
          </label>
          {state.logoId && (
            <img
              className="setup-logo"
              alt="Uploaded organization logo"
              src={`/api/${base}assets/${state.logoId}?thumb=1`}
            />
          )}
          <button disabled={busy} onClick={next}>
            {state.logoId ? "Continue with logo" : "Continue without logo"}
          </button>
        </>
      )}
      {state.step === 2 && (
        <>
          <p>
            Create a two-sided CR80 starter with name, ID, portrait and a secure
            verification QR. You can customize it in Templates.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                const existing = await api(base + "templates");
                const available = existing.find(
                  (t: { archived: boolean }) => !t.archived,
                );
                if (available) {
                  setState((s) => ({
                    ...s,
                    templateId: available.id,
                    step: 3,
                  }));
                  return;
                }
                const document = starterTemplate(name, state.logoId);
                const t = await api(base + "templates", "POST", {
                  name: "First staff card",
                  document,
                });
                setState((s) => ({ ...s, templateId: t.id, step: 3 }));
              })
            }
          >
            Use existing template or create starter
          </button>
        </>
      )}
      {state.step === 3 && (
        <>
          <p>
            Import a CSV/Excel sheet, map its columns, preview and commit it.
            You can also add one person manually.
          </p>
          <button onClick={() => onNavigate("Imports")}>Open imports</button>
          <button onClick={() => onNavigate("People")}>Add a person</button>
          <button disabled={busy} onClick={() => void task(checkPeople)}>
            Check people and continue
          </button>
        </>
      )}
      {state.step === 4 && (
        <>
          <p>
            Upload a portrait named with the person’s ID and check its match. A
            portrait is required by the starter template.
          </p>
          <button onClick={() => onNavigate("Photos")}>
            Upload and match photos
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                const assets = await api(base + "assets");
                if (!assets.some((a: { kind: string }) => a.kind === "PHOTO"))
                  throw new Error(
                    "Upload and match a photo, then return to Setup.",
                  );
                next();
              })
            }
          >
            Check photos and continue
          </button>
        </>
      )}
      {state.step === 5 && (
        <>
          <p>
            Generate a saved DRAFT sample using your first person and template.
            Generation validates bindings, photo assignment, text fit and QR
            size.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                if (!state.templateId || !state.personId)
                  throw new Error(
                    "Return to the Template and People steps first.",
                  );
                const card = await api(
                  base + "cards",
                  "POST",
                  { person_id: state.personId, template_id: state.templateId },
                  false,
                  { "Idempotency-Key": state.requestKey },
                );
                setState((s) => ({ ...s, cardId: card.id }));
                setMessage(
                  "Draft sample saved. Inspect both sides before activating.",
                );
              })
            }
          >
            {state.cardId ? "Load saved sample" : "Generate sample card"}
          </button>
          {state.cardId && (
            <>
              <p>
                <img
                  className="setup-card"
                  alt="Saved setup sample front"
                  src={`/api/${base}cards/${state.cardId}/image`}
                />
              </p>
              <a href={`/api/${base}cards/${state.cardId}/pdf?side=both`}>
                Download two-sided sample PDF
              </a>
              <p>
                <button onClick={next}>Sample checked — continue</button>
              </p>
            </>
          )}
        </>
      )}
      {state.step === 6 && (
        <>
          <p>
            Save an A4 eight-card profile with crop marks. Print at actual size
            / 100%, with fit-to-page disabled. Check duplex alignment on plain
            paper first.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                await api(base + "print-profiles", "POST", {
                  name: "First card · A4",
                  options: {
                    format: "pdf",
                    layout: "sheet",
                    side: "both",
                    paper: "A4",
                    columns: 2,
                    rows: 4,
                    margin: 10,
                    gap: 6,
                    cropMarks: true,
                  },
                });
                next();
              })
            }
          >
            Save print settings
          </button>
          <button onClick={() => onNavigate("Exports")}>
            Customize print layout
          </button>
        </>
      )}
      {state.step === 7 && (
        <>
          <p>
            Your first-card workflow is ready. The sample stays DRAFT until you
            activate it in Cards. Public verification starts with no personal
            fields; choose approved fields in Privacy. Keep an off-server backup
            and rehearse recovery.
          </p>
          <button
            onClick={() => {
              setState((s) => ({ ...s, done: true }));
              onRefresh();
            }}
          >
            Finish setup
          </button>
        </>
      )}
      {state.step > 0 && (
        <p>
          <button
            disabled={busy}
            onClick={() => setState((s) => ({ ...s, step: s.step - 1 }))}
          >
            Back
          </button>
        </p>
      )}
    </section>
  );
}
