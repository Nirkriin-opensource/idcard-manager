"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import {
  collectionFields,
  professionPresets,
  type CollectionField,
  type CollectionDefinition,
} from "../core/collection-schema";
import CollectionInputs from "./CollectionInputs";
import { useOrganizationTime } from "./OrganizationTime";
import { toWallTime, wallTimeToInstant } from "../core/organization-time";
type Row = Record<string, any>;
type FormRow = CollectionDefinition & {
  id: string;
  share_url: string;
  pending_count: number;
  closes_local?: string;
};
export default function CollectionForms({
  org,
  onPeopleChanged,
}: {
  org: string;
  onPeopleChanged: () => void;
}) {
  const organizationTime = useOrganizationTime();
  const shareLinkInput = useRef<HTMLInputElement>(null);
  const [forms, setForms] = useState<FormRow[]>([]),
    [catalog, setCatalog] = useState<CollectionField[]>(collectionFields),
    [edit, setEdit] = useState<
      | (CollectionDefinition & {
          id?: string;
          share_url?: string;
          closes_local?: string;
          timeZone?: string;
        })
      | null
    >(null),
    [selected, setSelected] = useState<Row | null>(null),
    [inbox, setInbox] = useState<Row>({ items: [], total: 0 }),
    [status, setStatus] = useState("PENDING"),
    [page, setPage] = useState(1),
    [review, setReview] = useState<Row | null>(null),
    [reviewValues, setReviewValues] = useState<Row>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preset, setPreset] = useState("Employee"),
    [addKey, setAddKey] = useState(""),
    [custom, setCustom] = useState({
      key: "",
      label: "",
      type: "text" as CollectionField["type"],
    });
  const base = `orgs/${org}/forms`;
  async function refresh() {
    const d = await api(base);
    setForms(d.forms);
    setCatalog(d.fields);
  }
  async function loadInbox(id: string) {
    setInbox(
      await api(`${base}/${id}/submissions?status=${status}&page=${page}`),
    );
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [org]);
  useEffect(() => {
    setReview(null);
    if (selected) loadInbox(selected.id).catch((e) => setError(e.message));
  }, [selected?.id, status, page]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function start(name: string) {
    const keys = new Set([
      ...professionPresets[name],
      ...catalog.filter((f) => f.required).map((f) => f.key),
    ]);
    setEdit({
      title: `${name === "Custom" ? "New" : name} data collection`,
      profession: name,
      description: "Please enter your details for your ID card.",
      fields: [...keys].flatMap((key) => {
        const field = catalog.find((f) => f.key === key);
        return field ? [{ ...field }] : [];
      }),
      active: false,
      closes_at: null,
      closes_local: "",
      timeZone: organizationTime.timeZone,
    });
    setSelected(null);
    setNotice("");
  }
  function updateField(index: number, change: Partial<CollectionField>) {
    if (!edit) return;
    setEdit({
      ...edit,
      fields: edit.fields.map((f, i) =>
        i === index ? { ...f, ...change } : f,
      ),
    });
  }
  function move(index: number, delta: number) {
    if (!edit) return;
    const fields = [...edit.fields],
      target = index + delta;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    setEdit({ ...edit, fields });
  }
  async function save() {
    if (!edit) return;
    const d = await api(
      edit.id ? `${base}/${edit.id}` : base,
      edit.id ? "PUT" : "POST",
      {
        title: edit.title,
        profession: edit.profession,
        description: edit.description,
        fields: edit.fields,
        active: edit.active,
        closes_local:
          edit.closes_local ??
          (edit.closes_at
            ? toWallTime(edit.closes_at, organizationTime.timeZone)
            : ""),
        editing_time_zone: edit.timeZone || organizationTime.timeZone,
      },
    );
    setEdit(d);
    await refresh();
    setNotice(
      d.active
        ? "Form saved. Copy the link to share it."
        : "Draft saved. Turn on Accept responses and save when ready to share.",
    );
  }
  async function copy(link: string) {
    setNotice("");
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        setNotice("Form link copied.");
        return;
      } catch {
        // HTTP LAN browsers and clipboard permission rules may need selection copying.
      }
    }
    const input = shareLinkInput.current;
    if (!input) return;
    input.focus();
    input.select();
    input.setSelectionRange(0, link.length);
    try {
      if (document.execCommand("copy")) {
        setNotice("Form link copied.");
        return;
      }
    } catch {}
    setNotice(
      "The link is selected. Press Ctrl+C, or touch and hold it and choose Copy.",
    );
  }
  const link = edit?.share_url || selected?.share_url;
  const localLink =
    link && /https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(link);
  let closingPreview =
    "No automatic closing date. Close this form manually when finished.";
  if (edit?.closes_local)
    try {
      closingPreview =
        "Closes: " +
        organizationTime.format(
          wallTimeToInstant(edit.closes_local, organizationTime.timeZone),
        );
    } catch (e) {
      closingPreview = (e as Error).message;
    }
  return (
    <section className="collection-manager">
      <div className="panel">
        <h2>Data collection forms</h2>
        <p>
          Create shareable forms for any profession or practice. Review
          responses before adding people to your General card workflow.
        </p>
        <div className="toolbar">
          <label>
            Start with
            <select
              aria-label="Profession preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {Object.keys(professionPresets).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() => start(preset)}
          >
            New form
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {link && (
        <section className="panel">
          <h3>Share this form</h3>
          <div className="toolbar">
            <input
              ref={shareLinkInput}
              aria-label="Share form link"
              readOnly
              value={link}
              onClick={(e) => e.currentTarget.select()}
            />
            <button onClick={() => void copy(link)}>Copy link</button>
            <a href={link} target="_blank" rel="noreferrer">
              Open form
            </a>
          </div>
          {localLink && (
            <p className="muted">
              This localhost link opens on this computer. To collect from other
              devices, use the application’s configured network address or
              domain.
            </p>
          )}
          <p className="muted">
            Only share with the intended applicants. Changing the link below
            disables the old link.
          </p>
        </section>
      )}
      {edit && (
        <section className="panel">
          <h3>Customize form</h3>
          <fieldset disabled={busy}>
            <div className="two-columns">
              <label>
                Form title
                <input
                  aria-label="Form title"
                  value={edit.title}
                  maxLength={160}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              <label>
                Profession / practice
                <input
                  aria-label="Profession / practice"
                  value={edit.profession}
                  maxLength={120}
                  onChange={(e) =>
                    setEdit({ ...edit, profession: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Instructions
              <textarea
                value={edit.description}
                maxLength={2000}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </label>
            <div className="toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.checked })
                  }
                />
                Accept responses
              </label>
              <label>
                Closing date (optional)
                <input
                  type="datetime-local"
                  min={toWallTime(
                    organizationTime.now() + 60000,
                    organizationTime.timeZone,
                  )}
                  value={edit.closes_local ?? ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      closes_local: e.target.value,
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  setEdit({ ...edit, closes_local: "", closes_at: null })
                }
              >
                No closing date
              </button>
            </div>
            <p>
              <strong>Time zone: {organizationTime.timeZone}</strong> · Change
              it in Organization → Time management.
            </p>
            <p aria-label="Closing time preview">{closingPreview}</p>
            <p className="muted">
              Name, ID and organization-required questions stay mandatory. Other
              questions can be reordered, renamed or removed.
            </p>
            <div className="collection-field-list">
              {edit.fields.map((f, i) => {
                const locked = !!catalog.find((c) => c.key === f.key)?.required;
                return (
                  <article className="collection-field-row" key={f.key}>
                    <div>
                      <label>
                        Question label
                        <input
                          aria-label={`Label for ${f.key}`}
                          value={f.label}
                          maxLength={120}
                          onChange={(e) =>
                            updateField(i, { label: e.target.value })
                          }
                        />
                      </label>
                      <small>{f.key}</small>
                    </div>
                    <label>
                      Answer type
                      <select
                        aria-label={`Type for ${f.key}`}
                        value={f.type}
                        onChange={(e) =>
                          updateField(i, {
                            type: e.target.value as CollectionField["type"],
                          })
                        }
                      >
                        {[
                          "text",
                          "email",
                          "tel",
                          "textarea",
                          "date",
                          "datetime-local",
                          "number",
                          "boolean",
                          "select",
                          "image",
                        ].map((t) => (
                          <option key={t} value={t}>
                            {
                              (
                                {
                                  text: "Short text",
                                  email: "Email",
                                  tel: "Phone",
                                  textarea: "Long text",
                                  date: "Date",
                                  "datetime-local": "Date and time",
                                  number: "Number",
                                  boolean: "Checkbox",
                                  select: "Dropdown",
                                  image: "Image upload",
                                } as Row
                              )[t]
                            }
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={f.required}
                        disabled={locked}
                        onChange={(e) =>
                          updateField(i, { required: e.target.checked })
                        }
                      />
                      Required
                    </label>
                    <div className="toolbar">
                      <button
                        aria-label={`Move ${f.label} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move ${f.label} down`}
                        disabled={i === edit.fields.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        disabled={locked}
                        aria-label={`Remove ${f.label}`}
                        onClick={() =>
                          setEdit({
                            ...edit,
                            fields: edit.fields.filter((_, j) => j !== i),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                    {f.type === "select" && (
                      <label className="wide">
                        Dropdown choices (one per line)
                        <textarea
                          aria-label={`Choices for ${f.key}`}
                          value={f.options.join("\n")}
                          onChange={(e) =>
                            updateField(i, {
                              options: e.target.value.split("\n"),
                            })
                          }
                        />
                      </label>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="toolbar">
              <label>
                Add existing field
                <select
                  aria-label="Add existing field"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                >
                  <option value="">Choose a field…</option>
                  {catalog
                    .filter((c) => !edit.fields.some((f) => f.key === c.key))
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!addKey}
                onClick={() => {
                  const f = catalog.find((c) => c.key === addKey);
                  if (f)
                    setEdit({ ...edit, fields: [...edit.fields, { ...f }] });
                  setAddKey("");
                }}
              >
                Add field
              </button>
            </div>
            <details>
              <summary>Add a custom question</summary>
              <div className="two-columns">
                <label>
                  Question
                  <input
                    aria-label="Custom question label"
                    value={custom.label}
                    onChange={(e) =>
                      setCustom({
                        ...custom,
                        label: e.target.value,
                        key: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "_")
                          .replace(/^_+|_+$/g, "")
                          .slice(0, 64),
                      })
                    }
                  />
                </label>
                <label>
                  Field key
                  <input
                    aria-label="Custom question key"
                    value={custom.key}
                    onChange={(e) =>
                      setCustom({ ...custom, key: e.target.value })
                    }
                  />
                </label>
                <label>
                  Answer type
                  <select
                    aria-label="Custom answer type"
                    value={custom.type}
                    onChange={(e) =>
                      setCustom({
                        ...custom,
                        type: e.target.value as CollectionField["type"],
                      })
                    }
                  >
                    {[
                      "text",
                      "textarea",
                      "date",
                      "number",
                      "boolean",
                      "select",
                      "email",
                      "tel",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                onClick={() => {
                  if (
                    !custom.label.trim() ||
                    !/^[a-z][a-z0-9_]{0,63}$/.test(custom.key)
                  ) {
                    setError(
                      "Enter a question and a field key starting with a letter, using lowercase letters, digits and underscores.",
                    );
                    return;
                  }
                  if (edit.fields.some((f) => f.key === custom.key)) {
                    setError("This field is already on the form.");
                    return;
                  }
                  setEdit({
                    ...edit,
                    fields: [
                      ...edit.fields,
                      { ...custom, required: false, options: [] },
                    ],
                  });
                  setCustom({ key: "", label: "", type: "text" });
                  setError("");
                }}
              >
                Add custom question
              </button>
            </details>
            <div className="toolbar">
              <button className="primary" onClick={() => void run(save)}>
                Save form
              </button>
              <button onClick={() => setEdit(null)}>Close editor</button>
              {edit.id && (
                <button
                  onClick={() =>
                    void run(async () => {
                      const saved = await api(
                        `${base}/${edit.id}/rotate-link`,
                        "POST",
                        {},
                      );
                      setEdit(saved);
                      await refresh();
                      setNotice(
                        "New link created. The old link no longer accepts submissions.",
                      );
                    })
                  }
                >
                  Change share link
                </button>
              )}
            </div>
          </fieldset>
        </section>
      )}
      <div className="collection-form-grid">
        {forms.map((f) => (
          <article className="panel" key={f.id}>
            <h3>{f.title}</h3>
            <p>
              {f.profession} ·{" "}
              {!f.active
                ? "Closed / draft"
                : f.closes_at &&
                    Date.parse(f.closes_at) <= organizationTime.now()
                  ? "Expired"
                  : "Accepting responses"}
            </p>
            {f.closes_at && (
              <p>Closing time: {organizationTime.format(f.closes_at)}</p>
            )}
            <p>
              {f.pending_count} awaiting review · {f.fields.length} questions
            </p>
            <div className="toolbar">
              <button
                disabled={busy}
                onClick={() => {
                  setEdit(f);
                  setSelected(null);
                  setReview(null);
                  setError("");
                }}
              >
                Edit form
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setEdit(null);
                  setSelected(f);
                  setStatus("PENDING");
                  setPage(1);
                  setReview(null);
                  setError("");
                }}
              >
                Review responses
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`${base}/${f.id}`, "PUT", {
                      ...f,
                      active: !f.active,
                    });
                    await refresh();
                    setEdit(null);
                    setSelected(null);
                    setNotice(
                      f.active
                        ? "Form closed. Existing responses are retained."
                        : "Form opened.",
                    );
                  })
                }
              >
                {f.active ? "Close form" : "Open form"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!forms.length && !edit && (
        <div className="panel empty">
          <h3>No collection forms yet</h3>
          <p>Choose a profession above and create your first form.</p>
        </div>
      )}
      {selected && (
        <section className="panel">
          <h3>Responses · {selected.title}</h3>
          <button
            disabled={busy}
            onClick={() => void run(() => loadInbox(selected.id))}
          >
            Refresh responses
          </button>
          <label>
            Review status
            <select
              aria-label="Review status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="PENDING">Awaiting review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <p>{inbox.total} responses</p>
          {inbox.items.map((s: Row) => (
            <div className="collection-response" key={s.id}>
              <span>
                <strong>{s.values.name}</strong> · {s.values.external_id}
                <small>{organizationTime.format(s.created_at)}</small>
              </span>
              <button
                onClick={() => {
                  setReview(s);
                  const v = { ...s.values };
                  for (const f of s.definition.fields)
                    if (f.type === "datetime-local" && v[f.key])
                      v[f.key] = toWallTime(
                        v[f.key],
                        organizationTime.timeZone,
                      );
                  setReviewValues(v);
                }}
              >
                Review
              </button>
            </div>
          ))}
          <div className="toolbar">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous responses
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 25 >= inbox.total}
              onClick={() => setPage(page + 1)}
            >
              Next responses
            </button>
          </div>
        </section>
      )}
      {review && selected && (
        <section className="panel">
          <h3>Review submission</h3>
          <p>
            {review.definition.profession} · {review.status} · submitted with
            form version {review.definition.version}
          </p>
          <CollectionInputs
            fields={review.definition.fields}
            values={reviewValues}
            disabled={busy || review.status !== "PENDING"}
            onChange={(k, v) => setReviewValues({ ...reviewValues, [k]: v })}
          />
          <div className="collection-review-images">
            {Object.entries(review.assets).map(([key, id]) => (
              <figure key={key}>
                <img
                  src={`/api/orgs/${org}/assets/${id}?thumb=1`}
                  alt={
                    key === "photo" ? "Submitted photo" : "Submitted signature"
                  }
                />
                <figcaption>
                  {key === "photo" ? "Photo" : "Cardholder signature"}
                </figcaption>
              </figure>
            ))}
          </div>
          {review.status === "PENDING" && (
            <div className="toolbar">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const normalized = { ...reviewValues };
                    await api(
                      `${base}/${selected.id}/submissions/${review.id}`,
                      "POST",
                      {
                        action: "approve",
                        values: normalized,
                        time_zone: organizationTime.timeZone,
                      },
                    );
                    setReview(null);
                    await loadInbox(selected.id);
                    await refresh();
                    onPeopleChanged();
                    setNotice(
                      "Approved and added to People. Use the normal card generation and download workflow.",
                    );
                  })
                }
              >
                Approve and add to People
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `${base}/${selected.id}/submissions/${review.id}`,
                      "POST",
                      { action: "reject" },
                    );
                    setReview(null);
                    await loadInbox(selected.id);
                    await refresh();
                    setNotice("Submission rejected. No person was created.");
                  })
                }
              >
                Reject submission
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
