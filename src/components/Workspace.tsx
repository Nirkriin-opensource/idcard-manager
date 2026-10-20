"use client";
import { importFields, matchImportColumns } from "../core/import-fields";
import SidebarNavigation from "./SidebarNavigation";
import DataManagement, { WorkflowNavigation } from "./DataManagement";
import RecycleBin from "./RecycleBin";
import PurgeData from "./PurgeData";
import CollectionForms from "./CollectionForms";
import OrganizationTimeSettings, {
  OrganizationTimeProvider,
} from "./OrganizationTime";
import {
  formatOrganizationTime,
  formatOrganizationDate,
} from "../core/organization-time";
import Workflows from "./Workflows";
import Setup from "./Setup";
import { useState, useEffect, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { api, setCsrf } from "./client";
import Numbering from "./Numbering";
import PhotoTools from "./PhotoTools";
import BulkPhotoMatch from "./BulkPhotoMatch";
import BulkRecordSelection from "./BulkRecordSelection";
import PhotoBatchUpload from "./PhotoBatchUpload";
import CardFields from "./CardFields";
import AppearanceSettings from "./AppearanceSettings";
import {
  builtInThemes,
  themeVariables,
  appearanceSchema,
  type Appearance,
} from "../core/themes";
import {
  cardTypes,
  cardFieldCatalog,
  type CardType,
} from "../core/card-field-catalog";
const Designer = dynamic(() => import("./Designer"), {
  ssr: false,
  loading: () => <p>Loading designer…</p>,
});
type Row = Record<string, any>;
export default function Workspace({
  initialTab = "People",
}: {
  initialTab?: string;
}) {
  const [me, setMe] = useState<Row | null>(null),
    [boot, setBoot] = useState(true),
    [orgs, setOrgs] = useState<Row[]>([]),
    [org, setOrg] = useState(""),
    [tab, setTab] = useState(initialTab),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [deletedView, setDeletedView] = useState(false),
    [deletedPhotosView, setDeletedPhotosView] = useState(false),
    [peopleSelection, setPeopleSelection] = useState<string[]>([]),
    [photoSelection, setPhotoSelection] = useState<string[]>([]);
  const canDeletePeople =
    !!me?.super_admin || orgs.find((o) => o.id === org)?.role === "ORG_ADMIN";
  useEffect(() => {
    setDeletedView(false);
    setDeletedPhotosView(false);
  }, [org, tab]);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const [people, setPeople] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState<Row>({}),
    [units, setUnits] = useState<Row[]>([]),
    [fields, setFields] = useState<Row[]>([]),
    [templates, setTemplates] = useState<Row[]>([]),
    [cards, setCards] = useState<Row[]>([]),
    [assets, setAssets] = useState<Row[]>([]),
    [imports, setImports] = useState<Row[]>([]),
    [health, setHealth] = useState<Row>({});
  useEffect(() => {
    setPeopleSelection([]);
  }, [org, tab, page, search, filters, deletedView, revision]);
  useEffect(() => {
    setPhotoSelection([]);
  }, [org, tab, deletedPhotosView, revision]);
  const [cardProfiles, setCardProfiles] = useState<Row>({});
  const [appearance, setAppearance] = useState<Appearance>(
      appearanceSchema.parse({}),
    ),
    [theme, setTheme] = useState("paper"),
    [branding, setBranding] = useState<{ name: string; logo: string | null }>({
      name: "iD card",
      logo: null,
    });
  const availableThemes = { ...builtInThemes, ...appearance.customThemes };
  const reloadBranding = () => {
    void api("branding")
      .then(setBranding)
      .catch(() => {});
  };
  useEffect(() => {
    reloadBranding();
  }, []);
  useEffect(() => {
    const palette = availableThemes[theme] || builtInThemes.paper;
    document.documentElement.dataset.theme = theme;
    for (const [key, value] of Object.entries(themeVariables(palette)))
      document.documentElement.style.setProperty(key, value);
  }, [theme, appearance]);
  useEffect(() => {
    if (!org) return;
    const choices = { ...builtInThemes, ...appearance.customThemes };
    let selected = appearance.defaultTheme;
    try {
      const saved = localStorage.getItem(`idcard.theme.${org}`);
      if (saved && choices[saved]) selected = saved;
    } catch {}
    setTheme(selected);
  }, [org, appearance]);
  const [edit, setEdit] = useState<Row | null>(null),
    [templateView, setTemplateView] = useState<"active" | "archive">("active"),
    [designerId, setDesignerId] = useState<string | null>(null),
    [batch, setBatch] = useState<Row | null>(null),
    [mapping, setMapping] = useState<Row>({}),
    [preview, setPreview] = useState<Row[]>([]),
    [validation, setValidation] = useState<Row | null>(null),
    [matchAsset, setMatchAsset] = useState(""),
    [selectedPerson, setSelectedPerson] = useState(""),
    [selectedTemplate, setSelectedTemplate] = useState(""),
    [image, setImage] = useState("");
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
  async function loadSession() {
    try {
      const user = await api("auth/me");
      setCsrf(user.csrf);
      setMe(user);
      if (!user.must_change_password) {
        const list = await api("orgs");
        setOrgs(list);
        if (!list.length && initialTab === "People") setTab("Setup");
        setOrg((old) =>
          list.some((o: Row) => o.id === old) ? old : list[0]?.id || "",
        );
      }
    } catch {
      setMe(null);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    void loadSession();
  }, []);
  useEffect(() => {
    if (!org || !me || me.must_change_password) return;
    let cancelled = false;
    const query = new URLSearchParams({
      page: String(page),
      q: search,
      deleted: deletedView ? "only" : "exclude",
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    });
    Promise.all([
      api(`orgs/${org}/people?${query}`),
      api(`orgs/${org}/units`),
      api(`orgs/${org}/fields`),
      api(`orgs/${org}/templates`),
      api(`orgs/${org}/card-profiles`),
      api(`orgs/${org}/appearance`),
    ])
      .then(([p, u, f, t, profiles, style]) => {
        if (cancelled) return;
        setPeople(p.items);
        setTotal(p.total);
        setUnits(u);
        setFields(f);
        setTemplates(t);
        setCardProfiles(profiles.profiles);
        setAppearance(style);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [org, revision, page, search, filters, me, deletedView]);
  useEffect(() => {
    if (!org || !me || me.must_change_password) return;
    let cancel = false;
    const resource = ["Cards", "Exports"].includes(tab)
      ? "cards"
      : tab === "Photos"
        ? "assets"
        : tab === "Imports"
          ? "imports"
          : null;
    if (resource)
      api(
        `orgs/${org}/${resource}${resource === "assets" && deletedPhotosView ? "?deleted=only" : ""}`,
      )
        .then((d) => {
          if (cancel) return;
          resource === "cards"
            ? setCards(d)
            : resource === "assets"
              ? setAssets(d)
              : setImports(d);
        })
        .catch((e) => {
          if (!cancel) setError(e.message);
        });
    if (tab === "System")
      api("system/health")
        .then((d) => {
          if (!cancel) setHealth(d);
        })
        .catch((e) => {
          if (!cancel) setError(e.message);
        });
    return () => {
      cancel = true;
    };
  }, [org, tab, revision, me, deletedPhotosView]);
  const refresh = () => setRevision((v) => v + 1),
    base = `orgs/${org}/`;
  function form(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  }
  if (boot)
    return (
      <main className="auth">
        <div className="brand-mark">iD</div>
        <p>Opening your workspace…</p>
      </main>
    );
  if (!me)
    return (
      <main className="auth">
        <div className="auth-card">
          {branding.logo ? (
            <img
              className="app-logo login-logo"
              src={branding.logo}
              alt="Application logo"
            />
          ) : (
            <div className="brand-mark">iD</div>
          )}
          <p className="eyebrow">YOUR ORGANIZATION. YOUR CARDS.</p>
          <h1>
            A clear identity.
            <br />A simpler workflow.
          </h1>
          <p className="muted">Sign in to your private ID card workspace.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const s = await api("auth/login", "POST", { email, password });
                setCsrf(s.csrf);
                setPassword("");
                await loadSession();
              });
            }}
          >
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary">
              {busy ? "Signing in…" : "Sign in →"}
            </button>
          </form>
          <small>Privately hosted · Access controlled</small>
        </div>
      </main>
    );
  if (me.must_change_password)
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="brand-mark">iD</div>
          <h1>Make it yours.</h1>
          <p>Replace your temporary password before opening the workspace.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("auth/password", "POST", {
                  current: password,
                  password: newPassword,
                });
                setMe(null);
                setPassword("");
                setNewPassword("");
              });
            }}
          >
            <label>
              Temporary password
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              New password · at least 14 characters
              <input
                required
                minLength={14}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Change password and sign in
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </div>
      </main>
    );
  return (
    <OrganizationTimeProvider org={org} settings={appearance.time}>
      <div className="shell">
        <aside className="sidebar">
          <a className="wordmark" href="/">
            {branding.logo ? (
              <img
                className="app-logo"
                src={branding.logo}
                alt="Application logo"
              />
            ) : (
              <span className="brand-mark">iD</span>
            )}
            <span className="app-name">{branding.name}</span>
          </a>
          <p className="eyebrow">WORKSPACE</p>
          <select
            aria-label="Organization"
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setPage(1);
              setDesignerId(null);
              setBatch(null);
              setImage("");
              setSearch("");
              setFilters({});
              setSelectedPerson("");
              setSelectedTemplate("");
              setMatchAsset("");
              setAssets([]);
            }}
          >
            <option value="">Select organization</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <SidebarNavigation
            user={me.id}
            active={tab}
            canAdmin={
              me.super_admin ||
              orgs.find((o) => o.id === org)?.role === "ORG_ADMIN"
            }
            superAdmin={me.super_admin}
            onSelect={(page) => {
              setTab(page);
              setError("");
              setNotice("");
            }}
          />
          <div className="sidebar-bottom">
            <div className="avatar">{me.email[0].toUpperCase()}</div>
            <div>
              <strong>{me.super_admin ? "Super Admin" : "Team member"}</strong>
              <small>{me.email}</small>
            </div>
            <button
              title="Sign out"
              onClick={() =>
                void run(async () => {
                  await api("auth/logout", "POST");
                  setMe(null);
                  setOrg("");
                })
              }
            >
              ↪
            </button>
          </div>
        </aside>
        <main className="content">
          <header>
            <div>
              <p className="eyebrow">
                ID CARD MANAGEMENT /{" "}
                {orgs.find((o) => o.id === org)?.name || "GET STARTED"}
              </p>
              <h1>{tab === "People" ? "People & identity" : tab}</h1>
              <p className="muted">
                {
                  (
                    {
                      People: "The people behind every card.",
                      Imports:
                        "Bring your records together, with a clear preview before import.",
                      Photos: "Match every face to the right record.",
                      Templates: "A consistent identity, designed your way.",
                      Cards: "Saved card renders with a permanent history.",
                      Organization: "Your structure, fields and team.",
                      System: "A live view of your application services.",
                      "Manage data": "Choose a task and get straight to work.",
                      "Recycle bin":
                        "Restore deleted records or preview permanent removal when work is complete.",
                      Jobs: "Generate cards in batches and track their progress.",
                      Exports: "Prepare downloads and print-ready files.",
                      Forms:
                        "Collect details, review responses and add approved people.",
                    } as Row
                  )[tab]
                }
              </p>
            </div>
          </header>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="working" role="status">
              Working… please keep this page open.
            </div>
          )}
          {!org ? (
            <section className="panel empty">
              <h2>Start with an organization</h2>
              <p>
                Create an organization below, then add people and design your
                first template.
              </p>
              {me.super_admin && (
                <form
                  onSubmit={(e) => {
                    const d = form(e);
                    void run(async () => {
                      await api("orgs", "POST", d);
                      await loadSession();
                    });
                  }}
                >
                  <label>
                    Organization name
                    <input name="name" required maxLength={200} />
                  </label>
                  <label>
                    Organization code
                    <input
                      name="code"
                      pattern="[A-Z0-9_-]{1,20}"
                      required
                      placeholder="ACME"
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Create organization
                  </button>
                </form>
              )}
            </section>
          ) : (
            <>
              {tab === "Manage data" && (
                <DataManagement
                  role={orgs.find((o) => o.id === org)?.role || "VIEWER"}
                  superAdmin={!!me.super_admin}
                  onNavigate={(page) => {
                    setTab(page);
                    setError("");
                    setNotice("");
                  }}
                />
              )}
              {tab === "Recycle bin" && canDeletePeople && (
                <RecycleBin key={org} org={org} onRefresh={refresh} />
              )}
              {["People", "Photos", "Templates", "Jobs", "Exports"].includes(
                tab,
              ) &&
                (tab !== "Templates" || designerId === null) && (
                  <WorkflowNavigation
                    active={tab}
                    onNavigate={(page) => {
                      setTab(page);
                      setError("");
                      setNotice("");
                    }}
                  />
                )}
              {(["Photos", "Cards"].includes(tab) ||
                (tab === "Templates" && designerId !== null)) && (
                <div className="toolbar">
                  <input
                    aria-label="Find person for selection"
                    placeholder="Find a person by name or ID…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setFilters({});
                      setPage(1);
                    }}
                  />
                  <small>
                    Person selectors show up to 50 matching records.
                  </small>
                </div>
              )}
              {tab === "Forms" &&
                (me.super_admin ||
                  orgs.find((o) => o.id === org)?.role === "ORG_ADMIN") && (
                  <CollectionForms
                    key={org}
                    org={org}
                    onPeopleChanged={refresh}
                  />
                )}
              {tab === "People" && (
                <>
                  <section className="stats">
                    <div>
                      <span>PEOPLE</span>
                      <strong>{total.toLocaleString()}</strong>
                      <small>Matching your current filters</small>
                    </div>
                    <div>
                      <span>TEMPLATES</span>
                      <strong>
                        {templates.filter((t) => !t.archived).length}
                      </strong>
                      <small>Available for card generation</small>
                    </div>
                    <div>
                      <span>ORGANIZATION</span>
                      <strong className="stat-name">
                        {orgs.find((o) => o.id === org)?.code}
                      </strong>
                      <small>Isolated records and assets</small>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          {deletedView ? "Deleted people" : "People directory"}
                        </h2>
                        <p>
                          {deletedView
                            ? "Restore a person to return them to the directory."
                            : "Search, update and prepare records for cards."}
                        </p>
                      </div>
                      <button
                        className="primary"
                        disabled={deletedView}
                        onClick={() =>
                          setEdit({
                            external_id: "",
                            name: "",
                            email: "",
                            phone: "",
                            designation: "",
                            status: "ACTIVE",
                            custom_fields: {},
                            unit_ids: [],
                          })
                        }
                      >
                        + Add person
                      </button>
                    </div>
                    {canDeletePeople && (
                      <div className="toolbar">
                        <button
                          aria-pressed={!deletedView}
                          onClick={() => {
                            setDeletedView(false);
                            setPage(1);
                          }}
                        >
                          Current people
                        </button>
                        <button
                          aria-pressed={deletedView}
                          onClick={() => {
                            setDeletedView(true);
                            setPage(1);
                          }}
                        >
                          Deleted people
                        </button>
                      </div>
                    )}
                    <div className="toolbar">
                      <input
                        aria-label="Search people"
                        placeholder="Search name or ID…"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                      />
                      {[
                        "status",
                        "designation",
                        "phone",
                        "email",
                        "card_number",
                      ].map((key) => (
                        <input
                          key={key}
                          aria-label={key}
                          placeholder={key.replace("_", " ")}
                          value={filters[key] || ""}
                          onChange={(e) => {
                            setFilters({ ...filters, [key]: e.target.value });
                            setPage(1);
                          }}
                        />
                      ))}
                    </div>
                    <div className="toolbar">
                      {["BRANCH", "DEPARTMENT", "CLASS", "SECTION"].map(
                        (kind) => (
                          <select
                            aria-label={kind}
                            key={kind}
                            value={filters[kind.toLowerCase()] || ""}
                            onChange={(e) => {
                              setFilters({
                                ...filters,
                                [kind.toLowerCase()]: e.target.value,
                              });
                              setPage(1);
                            }}
                          >
                            <option value="">
                              All{" "}
                              {kind === "CLASS"
                                ? "classes"
                                : kind.toLowerCase() + "s"}
                            </option>
                            {units
                              .filter((u) => u.kind === kind)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                          </select>
                        ),
                      )}
                    </div>
                    <div className="table-scroll">
                      {canDeletePeople && (
                        <BulkRecordSelection
                          org={org}
                          kind="people"
                          ids={people.map((p) => p.id)}
                          selected={peopleSelection}
                          onSelect={setPeopleSelection}
                          deleted={deletedView}
                          onDone={(message) => {
                            setNotice(message);
                            setPage(1);
                            refresh();
                          }}
                        />
                      )}
                      <table>
                        <thead>
                          <tr>
                            {canDeletePeople && <th>Select</th>}
                            <th>Person</th>
                            <th>Organization ID</th>
                            <th>Designation</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {people.map((p) => (
                            <tr key={p.id}>
                              {canDeletePeople && (
                                <td>
                                  <input
                                    style={{ width: "auto" }}
                                    type="checkbox"
                                    aria-label={`Select person ${p.name} (${p.external_id})`}
                                    checked={peopleSelection.includes(p.id)}
                                    onChange={(e) =>
                                      setPeopleSelection(
                                        e.target.checked
                                          ? [...peopleSelection, p.id]
                                          : peopleSelection.filter(
                                              (id) => id !== p.id,
                                            ),
                                      )
                                    }
                                  />
                                </td>
                              )}
                              <td>
                                <div className="person">
                                  {p.photo_asset_id ? (
                                    <img
                                      alt=""
                                      src={`/api/${base}assets/${p.photo_asset_id}?thumb=1`}
                                    />
                                  ) : (
                                    <span className="avatar">{p.name[0]}</span>
                                  )}
                                  <div>
                                    <strong>{p.name}</strong>
                                    <small>
                                      {p.email ||
                                        p.phone ||
                                        "No contact details"}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <code>{p.external_id}</code>
                              </td>
                              <td>{p.designation || "—"}</td>
                              <td>
                                <span
                                  className={
                                    "badge " +
                                    (!deletedView && p.status === "ACTIVE"
                                      ? "green"
                                      : "")
                                  }
                                >
                                  {deletedView ? "Deleted" : p.status}
                                </span>
                              </td>
                              <td>
                                {!deletedView && (
                                  <button
                                    onClick={() =>
                                      void run(async () => {
                                        setEdit(
                                          await api(base + "people/" + p.id),
                                        );
                                      })
                                    }
                                  >
                                    Edit ↗
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!people.length && (
                        <div className="empty">
                          <h3>
                            {deletedView
                              ? "No deleted people"
                              : "Your directory starts here"}
                          </h3>
                          <p>
                            {deletedView
                              ? "Deleted records will appear here and can be restored."
                              : "Add a person or import a spreadsheet to get started."}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="pagination">
                      <span>
                        {total} records · Page {page}
                      </span>
                      <button
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        ← Previous
                      </button>
                      <button
                        disabled={page * 50 >= total}
                        onClick={() => setPage(page + 1)}
                      >
                        Next →
                      </button>
                    </div>
                  </section>
                </>
              )}
              {org && tab === "Organization" && (
                <nav
                  className="organization-shortcuts"
                  aria-label="Organization settings sections"
                >
                  {[
                    ["organization-display", "Display"],
                    ["organization-time", "Time"],
                    ["organization-appearance", "Appearance"],
                    ["organization-fields", "Card fields"],
                    ["organization-units", "Units"],
                    ["organization-custom", "Custom fields"],
                    ["organization-team", "Team"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        document.getElementById(id)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              )}
              {org && tab === "Organization" && (
                <section
                  id="organization-display"
                  className="panel display-preferences"
                >
                  <h2>Display preferences</h2>
                  <label>
                    App theme
                    <select
                      aria-label="App theme"
                      value={theme}
                      onChange={(e) => {
                        setTheme(e.target.value);
                        try {
                          localStorage.setItem(
                            `idcard.theme.${org}`,
                            e.target.value,
                          );
                        } catch {}
                      }}
                    >
                      {Object.entries(availableThemes).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">
                    Your theme is saved for this organization on this device.
                    All six themes remain available.
                  </p>
                  <p className="muted">
                    {appearance.locked
                      ? `Card colours are locked to ${availableThemes[appearance.lockedTheme]?.name || appearance.lockedTheme}.`
                      : "New card colours follow your selected theme."}
                  </p>
                </section>
              )}
              {org && tab === "Organization" && (
                <div id="organization-time">
                  <OrganizationTimeSettings
                    org={org}
                    canAdmin={
                      me.super_admin ||
                      orgs.find((o) => o.id === org)?.role === "ORG_ADMIN"
                    }
                    onSaved={(time) => {
                      setAppearance((previous) => ({ ...previous, time }));
                      refresh();
                    }}
                  />
                </div>
              )}
              {org && tab === "Organization" && (
                <div id="organization-appearance">
                  <AppearanceSettings
                    key={org + "appearance"}
                    org={org}
                    superAdmin={me.super_admin}
                    canAdmin={
                      me.super_admin ||
                      orgs.find((o) => o.id === org)?.role === "ORG_ADMIN"
                    }
                    templates={templates}
                    onRefresh={refresh}
                    onBranding={reloadBranding}
                  />
                </div>
              )}
              {org && tab === "Organization" && (
                <div id="organization-fields">
                  <CardFields key={org} org={org} onRefresh={refresh} />
                </div>
              )}
              {tab === "Organization" && (
                <div className="settings-grid">
                  <Numbering org={org} onError={setError} />
                  <section className="panel">
                    <h2 id="organization-units">Organization units</h2>
                    <p className="muted">
                      Branches, departments, classes and sections.
                    </p>
                    <form
                      onSubmit={(e) => {
                        const d = form(e);
                        void run(async () => {
                          await api(base + "units", "POST", {
                            ...d,
                            parent_id: d.parent_id || null,
                          });
                          refresh();
                          setNotice("Unit created.");
                        });
                      }}
                    >
                      <label>
                        Name
                        <input name="name" required />
                      </label>
                      <label>
                        Code
                        <input name="code" required />
                      </label>
                      <label>
                        Type
                        <select name="kind">
                          {["BRANCH", "DEPARTMENT", "CLASS", "SECTION"].map(
                            (k) => (
                              <option key={k}>{k}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Parent
                        <select name="parent_id">
                          <option value="">None</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy}>Add unit</button>
                    </form>
                    <ul className="record-list">
                      {units.map((u) => (
                        <li key={u.id}>
                          {u.name}
                          <span>
                            {u.kind} · {u.code}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="panel">
                    <h2 id="organization-custom">Custom fields</h2>
                    <p className="muted">Fields are private by default.</p>
                    <form
                      onSubmit={(e) => {
                        const d = form(e);
                        void run(async () => {
                          await api(base + "fields", "POST", {
                            ...d,
                            required: d.required === "on",
                            private: d.private === "on",
                          });
                          refresh();
                          setNotice("Field created.");
                        });
                      }}
                    >
                      <label>
                        Field key
                        <input
                          name="key"
                          required
                          pattern="[a-z][a-z0-9_]{0,63}"
                          placeholder="employee_grade"
                        />
                      </label>
                      <label>
                        Display label
                        <input name="label" required />
                      </label>
                      <label>
                        Type
                        <select name="type">
                          {["text", "number", "date", "boolean"].map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <label className="check">
                        <input type="checkbox" name="required" />
                        Required
                      </label>
                      <label className="check">
                        <input type="checkbox" name="private" defaultChecked />
                        Private
                      </label>
                      <button disabled={busy}>Add field</button>
                    </form>
                    <ul className="record-list">
                      {fields.map((f) => (
                        <li key={f.id}>
                          {f.label}
                          <span>
                            {f.key} · {f.type}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="panel">
                    <h2 id="organization-team">Team access</h2>
                    <form
                      onSubmit={(e) => {
                        const d = form(e);
                        void run(async () => {
                          await api(base + "members", "POST", {
                            ...d,
                            password: d.password || undefined,
                          });
                          setNotice(
                            "Team access updated. New users must change their temporary password.",
                          );
                        });
                      }}
                    >
                      <label>
                        Email
                        <input type="email" name="email" required />
                      </label>
                      <label>
                        Temporary password · new users only
                        <input type="password" name="password" minLength={14} />
                      </label>
                      <label>
                        Role
                        <select name="role">
                          {["ORG_ADMIN", "DESIGNER", "OPERATOR", "VIEWER"].map(
                            (r) => (
                              <option key={r}>{r}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <button disabled={busy}>Assign access</button>
                    </form>
                  </section>
                  {me.super_admin && (
                    <section className="panel">
                      <h2>Add organization</h2>
                      <form
                        onSubmit={(e) => {
                          const d = form(e);
                          void run(async () => {
                            await api("orgs", "POST", d);
                            await loadSession();
                            setNotice(
                              "Organization created. Select it in the sidebar.",
                            );
                          });
                        }}
                      >
                        <label>
                          Name
                          <input name="name" required />
                        </label>
                        <label>
                          Code
                          <input
                            name="code"
                            pattern="[A-Z0-9_-]{1,20}"
                            required
                          />
                        </label>
                        <button disabled={busy}>Create organization</button>
                      </form>
                    </section>
                  )}
                </div>
              )}
              {tab === "Imports" && (
                <section className="panel">
                  <h2>Import a spreadsheet</h2>
                  <p>
                    One kit for General cards. Match spreadsheet columns to your
                    fields; mandatory rules apply automatically.
                  </p>
                  <p>
                    <a
                      href={
                        "/api/" + base + "upload-templates?kind=kit&general=1"
                      }
                    >
                      Download complete import kit (ZIP)
                    </a>
                  </p>
                  <p className="muted">
                    Fill in external_id and name plus required fields. General
                    is automatic. Keep IDs as text to preserve leading zeros.
                    Import people first, then upload photos from Photos.
                  </p>
                  <p className="muted">
                    CSV or XLSX · up to 10,000 rows · 15 MB · first worksheet
                  </p>
                  <label className="dropzone">
                    Choose a spreadsheet
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            const b = await api(
                              base +
                                "imports?filename=" +
                                encodeURIComponent(file.name),
                              "POST",
                              file,
                              true,
                            );
                            setBatch(b);
                            setValidation(null);
                            setPreview([]);
                            setMapping(
                              matchImportColumns(
                                b.columns,
                                fields.map((f) => ({
                                  key: f.key,
                                  label: f.label,
                                })),
                              ),
                            );
                            refresh();
                          });
                      }}
                    />
                  </label>
                  {batch && (
                    <>
                      <h3>Map your columns</h3>
                      <div className="mapping">
                        {batch.columns.map((col: string) => (
                          <label key={col}>
                            {col}
                            <select
                              value={mapping[col] || ""}
                              onChange={(e) =>
                                setMapping({
                                  ...mapping,
                                  [col]: e.target.value,
                                })
                              }
                            >
                              <option value="">Ignore column</option>
                              {importFields(
                                fields.map((f) => ({
                                  key: f.key,
                                  label: f.label,
                                })),
                              )
                                .filter(
                                  (field) => field.key !== "custom.card_type",
                                )
                                .map((field) => (
                                  <option key={field.key} value={field.key}>
                                    {field.label} · {field.key}
                                  </option>
                                ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const v = await api(
                              base + `imports/${batch.id}/validate`,
                              "POST",
                              {
                                mapping: Object.fromEntries(
                                  Object.entries(mapping).filter(([, v]) => v),
                                ),
                              },
                            );
                            setValidation(v);
                            setPreview(await api(base + "imports/" + batch.id));
                          })
                        }
                      >
                        Validate and preview
                      </button>
                      {validation && (
                        <>
                          <p
                            className={validation.invalid ? "error" : "notice"}
                          >
                            {validation.valid} valid rows · {validation.invalid}{" "}
                            invalid rows
                          </p>
                          <a
                            href={`/api/${base}imports/${batch.id}?report=csv`}
                          >
                            Download CSV error report
                          </a>{" "}
                          ·{" "}
                          <a
                            href={`/api/${base}imports/${batch.id}?report=xlsx`}
                          >
                            Excel error report
                          </a>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Row</th>
                                  <th>Preview</th>
                                  <th>Errors</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.map((r) => (
                                  <tr key={r.row_number}>
                                    <td>{r.row_number}</td>
                                    <td>
                                      {r.normalized?.external_id} ·{" "}
                                      {r.normalized?.name}
                                    </td>
                                    <td>
                                      {r.errors
                                        .map(
                                          (e: Row) => e.field + ": " + e.error,
                                        )
                                        .join("; ") || "Ready"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button
                            className="primary"
                            disabled={busy || validation.invalid > 0}
                            onClick={() =>
                              void run(async () => {
                                const r = await api(
                                  base + `imports/${batch.id}/commit`,
                                  "POST",
                                  {},
                                );
                                setNotice(`${r.imported} people imported.`);
                                setBatch(null);
                                refresh();
                              })
                            }
                          >
                            Import {validation.valid} people
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <h3>Recent imports</h3>
                  <ul className="record-list">
                    {imports.map((i) => (
                      <li key={i.id}>
                        {i.original_name}
                        <span>{i.status}</span>
                        <button
                          onClick={() => {
                            setBatch(i);
                            setMapping(i.mapping || {});
                            setValidation(null);
                          }}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tab === "Photos" && (
                <>
                  {!deletedPhotosView && (
                    <>
                      <BulkPhotoMatch
                        key={org}
                        org={org}
                        fields={fields.map((f) => ({
                          key: f.key,
                          label: f.label,
                        }))}
                        onChange={() => void refresh()}
                      />
                      <section className="panel">
                        <h2>Upload & match photos</h2>
                        <p>
                          <a
                            href={
                              "/api/" + base + "upload-templates?kind=photos"
                            }
                          >
                            Download photo filename guide (CSV)
                          </a>
                          {" · "}
                          <a
                            href={
                              "/api/" +
                              base +
                              "upload-templates?kind=kit&general=1"
                            }
                          >
                            Download complete import kit (ZIP)
                          </a>
                        </p>
                        <p className="muted">
                          Import people first, then download the guide. Rename
                          each portrait to the person’s external ID (for example
                          STAFF001.jpg), select Organization ID below, and
                          upload multiple images or a ZIP containing only
                          photos. The kit contains instructions and templates;
                          add your own portraits.
                        </p>
                        <PhotoTools
                          org={org}
                          asset={assets.find((x) => x.id === matchAsset)}
                          fields={fields}
                          onError={setError}
                          onChange={(id) => {
                            if (id) setMatchAsset(id);
                            refresh();
                          }}
                        />
                        <PhotoBatchUpload
                          key={org}
                          org={org}
                          fields={fields.map((field) => ({
                            key: field.key,
                            label: field.label,
                          }))}
                          busy={busy}
                          run={run}
                          onChange={refresh}
                          onNotice={setNotice}
                        />
                        <p className="muted">
                          ZIP filenames match the selected field, without the
                          extension. Use batches of up to 200 photos / 25 MB.
                        </p>
                        <div className="toolbar">
                          <select
                            aria-label="Photo to match"
                            value={matchAsset}
                            onChange={(e) => setMatchAsset(e.target.value)}
                          >
                            <option value="">Select an uploaded photo</option>
                            {assets.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.original_name || x.id.slice(0, 8)} · {x.kind}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Person to match"
                            value={selectedPerson}
                            onChange={(e) => setSelectedPerson(e.target.value)}
                          >
                            <option value="">Select person</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.external_id} · {p.name}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={busy || !matchAsset || !selectedPerson}
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  base + "photos/" + selectedPerson,
                                  "PUT",
                                  {
                                    asset_id: matchAsset,
                                  },
                                );
                                refresh();
                                setNotice("Photo matched.");
                              })
                            }
                          >
                            Match photo
                          </button>
                          <button
                            disabled={busy || !selectedPerson}
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  base + "photos/" + selectedPerson,
                                  "PUT",
                                  {
                                    asset_id: null,
                                  },
                                );
                                refresh();
                                setNotice(
                                  "Photo removed from person; historical renders are retained.",
                                );
                              })
                            }
                          >
                            Remove match
                          </button>
                        </div>
                      </section>
                    </>
                  )}

                  <section className="panel photo-library">
                    <h2>
                      {deletedPhotosView ? "Deleted photos" : "Photo library"}
                    </h2>
                    <p className="muted">
                      Select photos using the checkboxes below. Use Select all
                      loaded photos for a batch, then Delete selected. Deleted
                      photos remain recoverable.
                    </p>
                    {canDeletePeople && (
                      <>
                        <div className="toolbar">
                          <button
                            aria-pressed={!deletedPhotosView}
                            onClick={() => setDeletedPhotosView(false)}
                          >
                            Current photos
                          </button>
                          <button
                            aria-pressed={deletedPhotosView}
                            onClick={() => setDeletedPhotosView(true)}
                          >
                            Deleted photos
                          </button>
                        </div>
                        <BulkRecordSelection
                          org={org}
                          kind="photos"
                          ids={assets
                            .filter(
                              (x) =>
                                x.kind === "PHOTO" && !x.collection_private,
                            )
                            .map((x) => x.id)}
                          selected={photoSelection}
                          onSelect={setPhotoSelection}
                          deleted={deletedPhotosView}
                          onDone={(message) => {
                            setNotice(message);
                            setMatchAsset("");
                            refresh();
                          }}
                        />
                      </>
                    )}
                    <div className="asset-grid">
                      {assets.map((x) => (
                        <div key={x.id}>
                          {canDeletePeople &&
                            x.kind === "PHOTO" &&
                            !x.collection_private && (
                              <label
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  style={{ width: "auto" }}
                                  type="checkbox"
                                  aria-label={`Select photo ${x.original_name || x.id}`}
                                  checked={photoSelection.includes(x.id)}
                                  onChange={(e) =>
                                    setPhotoSelection(
                                      e.target.checked
                                        ? [...photoSelection, x.id]
                                        : photoSelection.filter(
                                            (id) => id !== x.id,
                                          ),
                                    )
                                  }
                                />
                                Select photo
                              </label>
                            )}
                          <button
                            className={
                              "asset-tile " +
                              (matchAsset === x.id ? "selected" : "")
                            }
                            key={x.id}
                            onClick={() => setMatchAsset(x.id)}
                          >
                            <img
                              loading="lazy"
                              alt={`Uploaded ${x.kind.toLowerCase()}`}
                              src={`/api/${base}assets/${x.id}?thumb=1`}
                            />
                            <span>
                              {x.original_name || x.id.slice(0, 8)} · {x.width}{" "}
                              × {x.height}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                  {assets.length >= 100 && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const more = await api(
                            base +
                              "assets?offset=" +
                              assets.length +
                              (deletedPhotosView ? "&deleted=only" : ""),
                          );
                          setAssets([...assets, ...more]);
                          if (!more.length) setNotice("All assets loaded.");
                        })
                      }
                    >
                      Load older images
                    </button>
                  )}
                </>
              )}
              {tab === "Templates" &&
                (designerId !== null ? (
                  <Designer
                    themeKey={theme}
                    key={org + designerId}
                    org={org}
                    templateId={designerId || undefined}
                    people={people}
                    onClose={() => {
                      setDesignerId(null);
                      refresh();
                    }}
                    onError={setError}
                  />
                ) : (
                  <>
                    <div className="section-action">
                      <div
                        className="segmented"
                        role="tablist"
                        aria-label="Template lists"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={templateView === "active"}
                          className={templateView === "active" ? "active" : ""}
                          onClick={() => setTemplateView("active")}
                        >
                          General templates (
                          {templates.filter((t) => !t.archived).length})
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={templateView === "archive"}
                          className={templateView === "archive" ? "active" : ""}
                          onClick={() => setTemplateView("archive")}
                        >
                          Archive ({templates.filter((t) => t.archived).length})
                        </button>
                      </div>
                      <button
                        className="primary"
                        onClick={() => setDesignerId("")}
                      >
                        + Create template
                      </button>
                    </div>
                    <div className="template-grid">
                      {templates
                        .filter(
                          (t) => !!t.archived === (templateView === "archive"),
                        )
                        .map((t) => (
                          <article className="template-tile" key={t.id}>
                            <div className="template-cover">
                              <span>iD</span>
                              <div />
                              <div />
                              <div />
                            </div>
                            <h3>{t.name}</h3>
                            <p className="muted">
                              Version {t.version}{" "}
                              {(
                                t.card_type === "shared" ||
                                t.card_type === "general"
                                  ? Object.values(appearance.defaults).includes(
                                      t.id,
                                    )
                                  : t.card_type
                                    ? appearance.defaults[
                                        t.card_type as CardType
                                      ] === t.id
                                    : t.is_default
                              )
                                ? "· Default"
                                : ""}{" "}
                              {t.archived ? "· Archived" : ""}
                            </p>
                            <div className="toolbar">
                              <button onClick={() => setDesignerId(t.id)}>
                                Open designer
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api(
                                      base + `templates/${t.id}/duplicate`,
                                      "POST",
                                      {},
                                    );
                                    refresh();
                                  })
                                }
                              >
                                Duplicate
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api(
                                      base + "templates/" + t.id,
                                      "PUT",
                                      {
                                        archived: !t.archived,
                                      },
                                    );
                                    refresh();
                                  })
                                }
                              >
                                {t.archived ? "Restore" : "Archive"}
                              </button>
                              <button
                                disabled={
                                  busy ||
                                  t.archived ||
                                  !(
                                    me.super_admin ||
                                    orgs.find((o) => o.id === org)?.role ===
                                      "ORG_ADMIN"
                                  )
                                }
                                onClick={() =>
                                  void run(async () => {
                                    await api(
                                      base + "templates/" + t.id,
                                      "PUT",
                                      {
                                        is_default: true,
                                      },
                                    );
                                    refresh();
                                  })
                                }
                              >
                                Set default
                              </button>
                            </div>
                          </article>
                        ))}
                    </div>
                    {templateView === "archive" &&
                      !templates.some((t) => t.archived) && (
                        <section className="panel empty">
                          <h2>No archived templates</h2>
                          <p>
                            Archived templates appear here. Restore one to
                            return it to General templates.
                          </p>
                        </section>
                      )}
                    {templateView === "active" &&
                      !templates.some((t) => !t.archived) && (
                        <div className="panel empty">
                          <h2>Design your first card</h2>
                          <p>
                            Create a front and back, add dynamic fields, and
                            preview with a real person.
                          </p>
                        </div>
                      )}
                  </>
                ))}
              {tab === "Cards" && (
                <>
                  <section className="panel">
                    <h2>Generate a card</h2>
                    <p className="muted">
                      This creates a DRAFT card and freezes its data, assets and
                      template version. Use card history below to activate,
                      renew, replace or report a lost card.
                    </p>
                    <div className="toolbar">
                      <select
                        aria-label="Person"
                        value={selectedPerson}
                        onChange={(e) => {
                          setSelectedPerson(e.target.value);
                          const kind = people.find(
                            (p) => p.id === e.target.value,
                          )?.custom_fields?.card_type;
                          setSelectedTemplate(
                            appearance.defaults[
                              kind as keyof typeof appearance.defaults
                            ] || "",
                          );
                        }}
                      >
                        <option value="">Choose person</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.external_id} · {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Template"
                        value={selectedTemplate}
                        onChange={(e) => setSelectedTemplate(e.target.value)}
                      >
                        <option value="">Choose template</option>
                        {templates
                          .filter((t) => !t.archived)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                      <button
                        className="primary"
                        disabled={busy || !selectedPerson || !selectedTemplate}
                        onClick={() =>
                          void run(async () => {
                            const r = await api(base + "cards", "POST", {
                              person_id: selectedPerson,
                              template_id: selectedTemplate,
                              theme_key: theme,
                            });
                            setNotice(`Card ${r.number} generated.`);
                            setImage(`/api/${base}renders/${r.render_id}`);
                            refresh();
                          })
                        }
                      >
                        Generate card
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Card number</th>
                            <th>Person</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Preview</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cards.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <code>{c.number}</code>
                              </td>
                              <td>{c.name}</td>
                              <td>
                                <span className="badge">{c.status}</span>
                              </td>
                              <td>
                                {formatOrganizationDate(
                                  c.created_at,
                                  appearance.time,
                                )}
                              </td>
                              <td>
                                {c.render_id && (
                                  <>
                                    <button
                                      onClick={() =>
                                        setImage(
                                          `/api/${base}renders/${c.render_id}`,
                                        )
                                      }
                                    >
                                      Front
                                    </button>
                                    <button
                                      onClick={() =>
                                        setImage(
                                          `/api/${base}renders/${c.render_id}?side=back`,
                                        )
                                      }
                                    >
                                      Back
                                    </button>
                                  </>
                                )}
                                {!c.render_id && (
                                  <span className="muted">Render purged</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  {image && (
                    <section className="panel">
                      <h2>Saved render</h2>
                      <img
                        className="card-preview"
                        src={image}
                        alt="Saved card render"
                        onError={() => {
                          setError(
                            "This side could not be loaded. The template may have no back side; check system health if the front also fails.",
                          );
                          setImage("");
                        }}
                      />
                    </section>
                  )}
                </>
              )}
              {tab === "System" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Service health</h2>
                    <button onClick={refresh}>Refresh</button>
                  </div>
                  <div className="health-grid">
                    {Object.entries(health).map(([name, value]) => (
                      <div className="health-item" key={name}>
                        <span className={value.ok ? "dot good" : "dot bad"} />
                        <h3>{name}</h3>
                        <strong>
                          {value.ok ? "Healthy" : "Needs attention"}
                        </strong>
                        {!value.ok && (
                          <p>
                            {value.fix ||
                              "Run migrations and inspect service logs."}
                          </p>
                        )}
                        {value.lastSeen && (
                          <small>
                            Last seen{" "}
                            {formatOrganizationTime(
                              value.lastSeen,
                              appearance.time,
                            )}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {org &&
            ["Organization", "Cards", "Audit", "Jobs"].includes(tab) &&
            (me.super_admin ||
              orgs.find((o) => o.id === org)?.role === "ORG_ADMIN") && (
              <PurgeData
                key={org + tab + "purge"}
                org={org}
                initialKind={
                  tab === "Cards"
                    ? "renders"
                    : tab === "Jobs"
                      ? "jobs"
                      : "audit"
                }
                onRefresh={refresh}
              />
            )}
          {org && (
            <Workflows
              themeKey={theme}
              appearance={appearance}
              key={org + tab}
              org={org}
              tab={tab}
              cards={cards}
              people={people}
              templates={templates}
              onError={setError}
              onRefresh={refresh}
            />
          )}
          {org && tab === "Setup" && (
            <Setup
              key={org}
              org={org}
              user={me.id}
              name={orgs.find((o) => o.id === org)?.name || "Organization"}
              onNavigate={setTab}
              onRefresh={refresh}
            />
          )}
          <footer>Multipurpose card Manager</footer>
        </main>
        {edit && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="person-title"
            >
              <div className="panel-heading">
                <h2 id="person-title">
                  {edit.id ? "Edit person" : "Add person"}
                </h2>
                <button onClick={() => setEdit(null)} aria-label="Close">
                  ×
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api(
                      base + "people" + (edit.id ? "/" + edit.id : ""),
                      edit.id ? "PUT" : "POST",
                      edit,
                    );
                    setEdit(null);
                    refresh();
                    setNotice("Person saved.");
                  });
                }}
              >
                <p className="muted">
                  General card · Organization field rules apply automatically.
                </p>
                {["external_id", "name", "email", "phone", "designation"].map(
                  (key) => (
                    <label key={key}>
                      {key.replace("_", " ")}
                      <input
                        required={
                          ["external_id", "name"].includes(key) ||
                          cardProfiles.staff?.required?.includes(key)
                        }
                        type={key === "email" ? "email" : "text"}
                        value={edit[key] || ""}
                        onChange={(e) =>
                          setEdit({ ...edit, [key]: e.target.value })
                        }
                      />
                    </label>
                  ),
                )}
                <label>
                  Status
                  <select
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({ ...edit, status: e.target.value })
                    }
                  >
                    <option>ACTIVE</option>
                    <option>INACTIVE</option>
                  </select>
                </label>
                {fields
                  .filter(
                    (f) =>
                      f.key !== "card_type" && f.key !== "cardholder_signature",
                  )
                  .map((f) => (
                    <label key={f.key}>
                      {f.label}
                      {f.required ||
                      cardProfiles.staff?.required?.includes(f.key)
                        ? " *"
                        : ""}
                      {f.type === "boolean" ? (
                        <select
                          value={String(edit.custom_fields[f.key] ?? "")}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              custom_fields: {
                                ...edit.custom_fields,
                                [f.key]:
                                  e.target.value === ""
                                    ? null
                                    : e.target.value === "true",
                              },
                            })
                          }
                        >
                          <option value="">Unset</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          type={
                            f.type === "number"
                              ? "number"
                              : f.type === "date"
                                ? "date"
                                : "text"
                          }
                          required={
                            f.required ||
                            cardProfiles.staff?.required?.includes(f.key)
                          }
                          value={edit.custom_fields[f.key] ?? ""}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              custom_fields: {
                                ...edit.custom_fields,
                                [f.key]:
                                  f.type === "number"
                                    ? e.target.value === ""
                                      ? null
                                      : Number(e.target.value)
                                    : e.target.value,
                              },
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                <label>
                  Cardholder signature (PNG, JPEG or WebP)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const a = await api(
                            base +
                              "assets?kind=SIGNATURE&filename=" +
                              encodeURIComponent(file.name),
                            "POST",
                            file,
                            true,
                          );
                          setEdit({
                            ...edit,
                            custom_fields: {
                              ...edit.custom_fields,
                              cardholder_signature: a.id,
                            },
                          });
                        });
                    }}
                  />
                </label>
                {edit.custom_fields?.cardholder_signature && (
                  <p>
                    Signature selected.{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          custom_fields: {
                            ...edit.custom_fields,
                            cardholder_signature: "",
                          },
                        })
                      }
                    >
                      Remove signature
                    </button>
                  </p>
                )}
                <label>
                  Units
                  <select
                    multiple
                    value={edit.unit_ids || []}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        unit_ids: Array.from(e.target.selectedOptions).map(
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.kind} · {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Save person
                </button>
                {error && <p className="error">{error}</p>}
              </form>
            </section>
          </div>
        )}
      </div>
    </OrganizationTimeProvider>
  );
}
