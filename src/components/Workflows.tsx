"use client";
import { browserId } from "./browser-id";
import { useOrganizationTime } from "./OrganizationTime";
import {
  wallTimeToInstant,
  formatCalendarDate,
} from "../core/organization-time";
import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { api } from "./client";
import { cardTypes, type CardType } from "../core/card-field-catalog";
import type { Appearance } from "../core/themes";
const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false });
type Row = Record<string, any>;
export default function Workflows({
  org,
  tab,
  cards,
  people,
  templates,
  onError,
  onRefresh,
  themeKey,
  appearance,
}: {
  org: string;
  tab: string;
  cards: Row[];
  people: Row[];
  templates: Row[];
  onError: (s: string) => void;
  onRefresh: () => void;
  themeKey?: string;
  appearance?: Appearance;
}) {
  const organizationTime = useOrganizationTime();
  const [data, setData] = useState<Row>({}),
    [jobs, setJobs] = useState<Row[]>([]),
    [exports, setExports] = useState<Row[]>([]),
    [units, setUnits] = useState<Row[]>([]),
    [profiles, setProfiles] = useState<Row[]>([]),
    [fields, setFields] = useState<Row[]>([]),
    [settings, setSettings] = useState<Row>({
      verification_fields: [],
      location_enabled: false,
    }),
    [locations, setLocations] = useState<Row[]>([]),
    [assets, setAssets] = useState<Row[]>([]),
    [audit, setAudit] = useState<Row[]>([]),
    [tokens, setTokens] = useState<Row[]>([]),
    [token, setToken] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [persons, setPersons] = useState<string[]>([]),
    [all, setAll] = useState(false),
    [template, setTemplate] = useState(""),
    [filters, setFilters] = useState<Row>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [jobDetails, setJobDetails] = useState<Row | null>(null),
    [chosenCard, setChosenCard] = useState(""),
    [history, setHistory] = useState<Row | null>(null),
    [expiry, setExpiry] = useState(""),
    [showMap, setShowMap] = useState(false),
    [offset, setOffset] = useState(0),
    [mapAsset, setMapAsset] = useState("");
  const key = useRef(browserId());
  const [options, setOptions] = useState<Row>({
    format: "pdf",
    imageFormat: "png",
    dpi: 300,
    quality: 95,
    side: "front",
    layout: "card",
    paper: "A4",
    paperWidth: 210,
    paperHeight: 297,
    columns: 2,
    rows: 4,
    margin: 10,
    gap: 6,
    bleed: 0,
    cropMarks: false,
    duplex: "long",
    backRotate: false,
    transparent: false,
  });
  const base = `orgs/${org}/`;
  function setDateFilter(key: string, value: string) {
    try {
      setFilters({
        ...filters,
        [key]: value
          ? wallTimeToInstant(value, organizationTime.timeZone)
          : undefined,
      });
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    onError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (tab === "Dashboard") setData(await api(base + "dashboard"));
    if (tab === "Jobs") setJobs(await api(base + "generation"));
    if (tab === "Exports") {
      setExports(await api(base + "exports"));
      setProfiles(await api(base + "print-profiles"));
    }
    if (tab === "Privacy") {
      setSettings(await api(base + "settings"));
      setFields(await api(base + "fields"));
      setTokens(await api(base + "tokens"));
    }
    if (tab === "Locations") {
      const s = await api(base + "settings");
      setSettings(s);
      if (s.location_enabled) {
        setLocations(await api(base + "locations"));
        setAssets(await api(base + "assets"));
      }
    }
    if (tab === "Audit") setAudit(await api(base + "audit?offset=" + offset));
  }
  useEffect(() => {
    setMessage("");
    setToken("");
    setHistory(null);
    setSelected([]);
    setPersons([]);
    api(base + "units")
      .then(setUnits)
      .catch((e) => onError(e.message));
    void reload().catch((e) => onError(e.message));
  }, [org, tab, offset]);
  useEffect(() => {
    if (!["Jobs", "Exports"].includes(tab)) return;
    const t = setInterval(() => {
      void reload().catch((e) => onError(e.message));
    }, 2500);
    return () => clearInterval(t);
  }, [org, tab]);
  const filterForm = (
    <div className="toolbar">
      <input
        aria-label="Batch name or ID filter"
        placeholder="Name or organization ID"
        value={filters.q || ""}
        onChange={(e) =>
          setFilters({ ...filters, q: e.target.value || undefined })
        }
      />
      <select
        aria-label="Batch unit filter"
        value={filters.unit_id || ""}
        onChange={(e) =>
          setFilters({ ...filters, unit_id: e.target.value || undefined })
        }
      >
        <option value="">
          All branches / departments / classes / sections
        </option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.kind} · {u.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Batch status filter"
        value={filters.status || ""}
        onChange={(e) =>
          setFilters({ ...filters, status: e.target.value || undefined })
        }
      >
        <option value="">All statuses</option>
        {(tab === "Jobs"
          ? ["ACTIVE", "INACTIVE"]
          : [
              "DRAFT",
              "ACTIVE",
              "PRINTED",
              "EXPIRED",
              "LOST",
              "SUSPENDED",
              "REPLACED",
              "CANCELLED",
            ]
        ).map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </div>
  );
  if (tab === "Dashboard")
    return (
      <>
        <p>
          <a href={`/api/${base}reports`}>Download card status report (CSV)</a>
        </p>
        <section className="stats">
          {Object.entries(data.totals || {}).map(([name, value]) => (
            <div key={name}>
              <span>{name.toUpperCase()}</span>
              <strong>{String(value)}</strong>
            </div>
          ))}
        </section>
        <div className="settings-grid">
          <section className="panel">
            <h2>Active and expired cards</h2>
            {["active", "expired", "pending", "printed"].map((status) => (
              <div className="chart-row" key={status}>
                <span>{status}</span>
                <div
                  style={{
                    width:
                      Math.max(
                        1,
                        (Number(data.totals?.[status] || 0) /
                          Math.max(1, Number(data.totals?.total || 0))) *
                          60,
                      ) + "%",
                  }}
                />
                <b>{data.totals?.[status] || 0}</b>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Generated in the last 30 days</h2>
            {(data.generated || []).map((d: Row) => (
              <div className="chart-row" key={d.day}>
                <small>{formatCalendarDate(d.day)}</small>
                <div
                  style={{
                    width:
                      Math.max(
                        2,
                        (d.count /
                          Math.max(
                            1,
                            ...data.generated.map((x: Row) => x.count),
                          )) *
                          65,
                      ) + "%",
                  }}
                />
                <b>{d.count}</b>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>People per department</h2>
            {(data.departments || []).map((d: Row) => (
              <div className="chart-row" key={d.name}>
                <span>{d.name}</span>
                <div
                  style={{
                    width:
                      Math.max(
                        2,
                        (d.count /
                          Math.max(
                            1,
                            ...data.departments.map((x: Row) => x.count),
                          )) *
                          60,
                      ) + "%",
                  }}
                />
                <b>{d.count}</b>
              </div>
            ))}
            <p>
              {data.people || 0} people · {data.templates || 0} active templates
            </p>
          </section>
          <section className="panel">
            <h2>Recent imports</h2>
            {(data.imports || []).map((i: Row) => (
              <div className="chart-row" key={i.id}>
                <span>
                  {i.original_name} · {i.status}
                </span>
                <div
                  style={{ width: Math.min(60, Number(i.errors) * 5) + "%" }}
                />
                <b>{i.errors} invalid rows</b>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Recent generation jobs</h2>
            {(data.jobs || []).map((j: Row) => (
              <p key={j.id}>
                {j.id.slice(0, 8)} · {j.status}
              </p>
            ))}
          </section>
        </div>
      </>
    );
  if (tab === "Jobs")
    return (
      <>
        <section className="panel">
          <h2>Generate cards in the background</h2>
          <p className="muted">
            Jobs continue after this browser closes. The selected template
            version and person records are frozen when submitted.
          </p>
          <p className="muted">
            General cards use one template and the organization’s mandatory
            field rules.
          </p>
          <p className="muted">
            Each queued batch freezes one theme, template version, logo and
            mandatory-field policy.{" "}
            {appearance?.locked
              ? "The administrator’s locked card theme applies."
              : "New cards follow your selected app theme."}
          </p>
          <label>
            Template
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Choose template</option>
              {templates
                .filter(
                  (t) =>
                    !t.archived &&
                    (!filters.card_type ||
                      t.card_type === "shared" ||
                      t.card_type === "general" ||
                      t.card_type === filters.card_type),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Generate for all people matching these filters
          </label>
          {filterForm}
          {!all && (
            <div className="selection-list">
              {people
                .filter(
                  (p) =>
                    !filters.card_type ||
                    p.custom_fields?.card_type === filters.card_type,
                )
                .map((p) => (
                  <label className="check" key={p.id}>
                    <input
                      type="checkbox"
                      checked={persons.includes(p.id)}
                      onChange={(e) =>
                        setPersons(
                          e.target.checked
                            ? [...persons, p.id]
                            : persons.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.external_id} · {p.name}
                  </label>
                ))}
            </div>
          )}
          <button
            className="primary"
            disabled={busy || !template || (!all && !persons.length)}
            onClick={() =>
              void task(async () => {
                const j = await api(base + "generation", "POST", {
                  template_id: template,
                  person_ids: all ? undefined : persons,
                  filters,
                  request_key: key.current,
                  theme_key: themeKey,
                });
                key.current = browserId();
                setMessage("Job queued: " + j.id);
                await reload();
              })
            }
          >
            Queue generation
          </button>
        </section>
        <section className="panel">
          <h2>Generation jobs</h2>
          {jobs.map((j) => (
            <div className="job-row" key={j.id}>
              <strong>
                {j.id.slice(0, 8)} · {j.status}
              </strong>
              <progress value={j.completed + j.failed} max={j.total || 1} />
              <span>
                {j.completed}/{j.total} generated · {j.failed} failed ·{" "}
                {Math.round(((j.completed + j.failed) / (j.total || 1)) * 100)}%
              </span>
              <button
                onClick={() =>
                  void task(async () =>
                    setJobDetails(await api(base + "generation/" + j.id)),
                  )
                }
              >
                Details
              </button>
              {j.status === "FAILED" && (
                <button
                  onClick={() =>
                    void task(async () => {
                      await api(base + `generation/${j.id}/retry`, "POST", {});
                      await reload();
                    })
                  }
                >
                  Retry failed
                </button>
              )}
              {["QUEUED", "RUNNING"].includes(j.status) && (
                <button
                  onClick={() =>
                    void task(async () => {
                      await api(base + `generation/${j.id}/cancel`, "POST", {});
                      await reload();
                    })
                  }
                >
                  Cancel remaining
                </button>
              )}
            </div>
          ))}
          {jobDetails && (
            <div className="record-list">
              {jobDetails.items.map((i: Row) => (
                <p key={i.id}>
                  {i.person_id} · {i.status} {i.error}
                </p>
              ))}
            </div>
          )}
        </section>
      </>
    );
  if (tab === "Exports")
    return (
      <>
        <section className="panel">
          <h2>Download cards & prepare print sheets</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Export all generated cards matching filters
          </label>
          {filterForm}
          {all && (
            <div className="toolbar">
              <label>
                Generated from ({organizationTime.timeZone})
                <input
                  type="datetime-local"
                  onChange={(e) => setDateFilter("from", e.target.value)}
                />
              </label>
              <label>
                Generated until ({organizationTime.timeZone})
                <input
                  type="datetime-local"
                  onChange={(e) => setDateFilter("to", e.target.value)}
                />
              </label>
              <input
                placeholder="Generation batch UUID (optional)"
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    batch_id: e.target.value || undefined,
                  })
                }
              />
            </div>
          )}
          {!all && (
            <div className="selection-list">
              {cards
                .filter((c) => c.render_id)
                .map((c) => (
                  <label className="check" key={c.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(c.render_id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, c.render_id]
                            : selected.filter((id) => id !== c.render_id),
                        )
                      }
                    />
                    {c.number} · {c.name}
                  </label>
                ))}
            </div>
          )}
          <div className="mapping">
            {[
              ["format", ["png", "jpg", "zip", "pdf"]],
              ["side", ["front", "back", "both"]],
              ["layout", ["card", "sheet"]],
              ["paper", ["A4", "A3", "Letter", "custom"]],
              ["duplex", ["long", "short"]],
              ["imageFormat", ["png", "jpg"]],
            ].map(([field, values]) => (
              <label key={field as string}>
                {String(field).replace("imageFormat", "ZIP image format")}
                <select
                  value={options[field as string]}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      [field as string]: e.target.value,
                    })
                  }
                >
                  {(values as string[]).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Cards per sheet
              <select
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setOptions({ ...options, columns: 2, rows: n / 2 });
                }}
                defaultValue="8"
              >
                {[2, 4, 6, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            {[
              "dpi",
              "quality",
              "columns",
              "rows",
              "margin",
              "gap",
              "bleed",
              "paperWidth",
              "paperHeight",
            ].map((k) => (
              <label key={k}>
                {k}{" "}
                {[
                  "margin",
                  "gap",
                  "bleed",
                  "paperWidth",
                  "paperHeight",
                ].includes(k)
                  ? "· mm"
                  : ""}
                <input
                  type="number"
                  step={k === "bleed" ? 0.5 : 1}
                  value={options[k]}
                  onChange={(e) =>
                    setOptions({ ...options, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div className="toolbar">
            {["cropMarks", "backRotate", "transparent"].map((k) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  checked={options[k]}
                  onChange={(e) =>
                    setOptions({ ...options, [k]: e.target.checked })
                  }
                />
                {k === "cropMarks"
                  ? "Crop marks"
                  : k === "backRotate"
                    ? "Rotate backs 180°"
                    : "Transparent PNG background"}
              </label>
            ))}
          </div>
          <label>
            Optional background override
            <input
              placeholder="#ffffff (leave empty to preserve template)"
              maxLength={7}
              onChange={(e) =>
                setOptions({
                  ...options,
                  background: e.target.value || undefined,
                })
              }
            />
          </label>
          <div className="toolbar">
            <button
              className="primary"
              disabled={busy || (!all && !selected.length)}
              onClick={() =>
                void task(async () => {
                  await api(base + "exports", "POST", {
                    render_ids: all ? undefined : selected,
                    filters,
                    options,
                    request_key: key.current,
                  });
                  key.current = browserId();
                  setMessage(
                    "Export queued. It will continue after this page closes.",
                  );
                  await reload();
                })
              }
            >
              Prepare download
            </button>
            <button
              onClick={() =>
                void task(async () => {
                  const name = window.prompt("Print profile name");
                  if (name) {
                    await api(base + "print-profiles", "POST", {
                      name,
                      options,
                    });
                    await reload();
                  }
                })
              }
            >
              Save print profile
            </button>
            <select
              aria-label="Saved print profile"
              defaultValue=""
              onChange={(e) => {
                const p = profiles.find((p) => p.id === e.target.value);
                if (p) setOptions(p.options);
              }}
            >
              <option value="">Load print profile</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <p className="muted">
            Print PDFs at actual size / 100%, with fit-to-page disabled.
            Long-edge mirrors back columns; short-edge mirrors back rows. Test
            two distinct cards on plain paper before printing stock. Back
            rotation compensates for printer feed orientation. Bleed repeats
            edge pixels outside the trim box.
          </p>
        </section>
        <section className="panel">
          <h2>Export jobs</h2>
          {exports.map((j) => (
            <div className="job-row" key={j.id}>
              <strong>
                {j.options.format.toUpperCase()} · {j.status}
              </strong>
              <progress value={j.completed} max={j.total} />
              <span>
                {j.completed}/{j.total}
              </span>
              {j.error && <p className="error">{j.error}</p>}
              {j.status === "COMPLETED" && (
                <a
                  className="download"
                  href={`/api/${base}exports/${j.id}/download`}
                >
                  Download
                </a>
              )}
              {j.status === "FAILED" && (
                <button
                  onClick={() =>
                    void task(async () => {
                      await api(base + `exports/${j.id}/retry`, "POST", {});
                      await reload();
                    })
                  }
                >
                  Retry
                </button>
              )}
            </div>
          ))}
        </section>
        {message && <p className="notice">{message}</p>}
      </>
    );
  if (tab === "Cards")
    return (
      <section className="panel">
        <h2>Card status, renewal & history</h2>
        <label>
          Card
          <select
            value={chosenCard}
            onChange={(e) => {
              setChosenCard(e.target.value);
              setHistory(null);
            }}
          >
            <option value="">Choose card</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number} · {c.name} · {c.status}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          {[
            "ACTIVE",
            "PRINTED",
            "LOST",
            "SUSPENDED",
            "CANCELLED",
            "EXPIRED",
          ].map((status) => (
            <button
              key={status}
              disabled={!chosenCard || busy}
              onClick={() =>
                void task(async () => {
                  await api(base + `cards/${chosenCard}/state`, "POST", {
                    status,
                  });
                  setMessage("Card status changed to " + status);
                  onRefresh();
                })
              }
            >
              {status === "ACTIVE"
                ? "Activate"
                : status === "PRINTED"
                  ? "Mark printed"
                  : "Mark " + status.toLowerCase()}
            </button>
          ))}
          <button
            disabled={!chosenCard}
            onClick={() =>
              void task(async () =>
                setHistory(await api(base + `cards/${chosenCard}/history`)),
              )
            }
          >
            Show history
          </button>
          <a
            href={
              chosenCard ? `/api/${base}cards/${chosenCard}/pdf` : undefined
            }
          >
            Single-card PDF
          </a>
          <a
            href={
              chosenCard
                ? `/api/${base}cards/${chosenCard}/image?format=png`
                : undefined
            }
          >
            PNG
          </a>
          <a
            href={
              chosenCard
                ? `/api/${base}cards/${chosenCard}/image?format=jpg`
                : undefined
            }
          >
            JPG
          </a>
        </div>
        <label>
          Replacement template
          <select
            aria-label="Replacement template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="">
              Use previous template (choose one if renders were purged)
            </option>
            {templates
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          New expiry (optional for reissue, required to extend) ·{" "}
          {organizationTime.timeZone}
          <input
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>
        <div className="toolbar">
          <button
            disabled={busy || !chosenCard || !expiry}
            onClick={() =>
              void task(async () => {
                await api(base + `cards/${chosenCard}/extend`, "POST", {
                  expires_at: wallTimeToInstant(
                    expiry,
                    organizationTime.timeZone,
                  ),
                });
                setMessage(
                  "Expiry extended; activate an expired card separately when ready.",
                );
                onRefresh();
              })
            }
          >
            Extend expiry
          </button>
          {["renew", "replace", "reissue"].map((action) => (
            <button
              key={action}
              disabled={busy || !chosenCard}
              onClick={() =>
                void task(async () => {
                  const r = await api(
                    base + `cards/${chosenCard}/${action}`,
                    "POST",
                    {
                      request_key: key.current,
                      template_id: template || undefined,
                      expires_at: expiry
                        ? wallTimeToInstant(expiry, organizationTime.timeZone)
                        : undefined,
                    },
                  );
                  key.current = browserId();
                  setMessage(
                    "New active card " +
                      r.number +
                      " created. The previous card is REPLACED.",
                  );
                  onRefresh();
                })
              }
            >
              {action}
            </button>
          ))}
        </div>
        {history &&
          history.events.map((e: Row, i: number) => (
            <p key={i}>
              {organizationTime.format(e.created_at)} · {e.type} ·{" "}
              {JSON.stringify(e.details)}
            </p>
          ))}
        {message && <p className="notice">{message}</p>}
      </section>
    );
  if (tab === "Privacy")
    return (
      <div className="settings-grid">
        <section className="panel">
          <h2>Public verification & location</h2>
          <p className="muted">
            Public pages show current status and only the fields you explicitly
            allow. Inactive/lost/replaced cards reveal no person fields.
          </p>
          {[
            "name",
            "external_id",
            "designation",
            ...fields.filter((f) => !f.private).map((f) => f.key),
          ].map((k) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                checked={settings.verification_fields.includes(k)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    verification_fields: e.target.checked
                      ? [...settings.verification_fields, k]
                      : settings.verification_fields.filter(
                          (x: string) => x !== k,
                        ),
                  })
                }
              />
              {fields.find((f) => f.key === k)?.label || k}
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={settings.location_enabled}
              onChange={(e) =>
                setSettings({ ...settings, location_enabled: e.target.checked })
              }
            />
            Enable location features
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                await api(base + "settings", "PUT", settings);
                setMessage("Privacy settings saved.");
              })
            }
          >
            Save privacy settings
          </button>
          {message && <p className="notice">{message}</p>}
        </section>
        <section className="panel">
          <h2>Scoped API access</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              void task(async () => {
                const r = await api(base + "tokens", "POST", {
                  name: d.name,
                  scopes: String(d.scopes).split(","),
                  expires_at: wallTimeToInstant(
                    String(d.expires_at),
                    organizationTime.timeZone,
                  ),
                });
                setToken(r.token);
                await reload();
              });
            }}
          >
            <label>
              Token name
              <input name="name" required />
            </label>
            <label>
              Scopes
              <select name="scopes">
                <option value="read">Read only</option>
                <option value="read,people,asset">People and photos</option>
                <option value="read,generate">Generate and export</option>
              </select>
            </label>
            <label>
              Expires ({organizationTime.timeZone})
              <input type="datetime-local" name="expires_at" required />
            </label>
            <button>Create token</button>
          </form>
          {token && (
            <div className="notice">
              <p>Copy this token now. It will not be shown again.</p>
              <code className="token">{token}</code>
            </div>
          )}
          {tokens.map((t) => (
            <p key={t.id}>
              {t.name} · {t.scopes.join(", ")}{" "}
              <button
                onClick={() =>
                  void task(async () => {
                    await api(base + "tokens/" + t.id, "DELETE");
                    await reload();
                  })
                }
              >
                Revoke
              </button>
            </p>
          ))}
        </section>
      </div>
    );
  if (tab === "Locations")
    return (
      <section className="panel">
        <h2>Organization & branch location</h2>
        {!settings.location_enabled ? (
          <p>
            Location is disabled. An organization administrator can enable it in
            Privacy.
          </p>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                void task(async () => {
                  await api(base + "locations", "POST", {
                    address: f.address,
                    latitude: Number(f.latitude),
                    longitude: Number(f.longitude),
                    unit_id: f.unit_id || null,
                    map_asset_id: mapAsset || null,
                  });
                  await reload();
                  setMessage("Location saved.");
                });
              }}
            >
              <label>
                Address
                <input name="address" required />
              </label>
              <div className="two-columns">
                <label>
                  Latitude
                  <input
                    type="number"
                    step="any"
                    name="latitude"
                    min={-85}
                    max={85}
                    required
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    step="any"
                    name="longitude"
                    min={-180}
                    max={180}
                    required
                  />
                </label>
              </div>
              <label>
                Branch / unit
                <select name="unit_id">
                  <option value="">Organization location</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Optional licensed map image
                <select
                  value={mapAsset}
                  onChange={(e) => setMapAsset(e.target.value)}
                >
                  <option value="">No static map</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.original_name || a.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Save location</button>
            </form>
            <p className="muted">
              For a map on a card, select an uploaded image you have permission
              to print and add it as a Map element in the designer. Bulk
              requests to public OSM tiles are not used. Bind location.address
              or location.url to text/QR elements.
            </p>
            <button onClick={() => setShowMap(!showMap)}>
              {showMap ? "Hide" : "Load interactive OpenStreetMap"}
            </button>
            {showMap && <LocationMap locations={locations} />}
            <ul className="record-list">
              {locations.map((l) => (
                <li key={l.id}>
                  {l.address} · {l.latitude}, {l.longitude}
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=16/${l.latitude}/${l.longitude}`}
                  >
                    Open map
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {message && <p className="notice">{message}</p>}
      </section>
    );
  if (tab === "Audit")
    return (
      <section className="panel">
        <h2>Audit log</h2>
        <p className="muted">
          Actions are protected from editing. Administrators can purge older
          entries using a preview and confirmation. Purge receipts are retained.
          Passwords, tokens and person-field values are excluded.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((r, i) => (
                <tr key={i}>
                  <td>{organizationTime.format(r.created_at)}</td>
                  <td>{r.action}</td>
                  <td>{r.actor_id || "System"}</td>
                  <td>{r.target_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="toolbar">
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous
          </button>
          <button
            disabled={audit.length < 100}
            onClick={() => setOffset(offset + 100)}
          >
            Next
          </button>
        </div>
      </section>
    );
  return null;
}
