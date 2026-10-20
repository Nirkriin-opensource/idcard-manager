"use client";
import PrintSettings from "./PrintSettings";
import { useEffect, useState } from "react";
import { api } from "./client";
import { builtInThemes, themeContrast, type AppTheme } from "../core/themes";
import {
  cardTypes,
  generalCardTypes,
  generalCardFields,
  cardFieldCatalog,
  type CardType,
} from "../core/card-field-catalog";
import { appearanceSchema, type Appearance } from "../core/themes";

export default function AppearanceSettings({
  org,
  superAdmin,
  canAdmin,
  templates,
  onRefresh,
  onBranding,
}: {
  org: string;
  superAdmin: boolean;
  canAdmin: boolean;
  templates: Record<string, any>[];
  onRefresh: () => void;
  onBranding: () => void;
}) {
  const [settings, setSettings] = useState<Appearance>(
      appearanceSchema.parse({}),
    ),
    [draft, setDraft] = useState<AppTheme>({
      ...structuredClone(builtInThemes.paper),
      name: "Institution",
    }),
    [customKey, setCustomKey] = useState("institution"),
    [kind, setKind] = useState<CardType>("staff"),
    [presetTheme, setPresetTheme] = useState("paper"),
    [makeDefault, setMakeDefault] = useState(true),
    [brandName, setBrandName] = useState("iD card"),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const base = `orgs/${org}/`,
    themes = { ...builtInThemes, ...settings.customThemes },
    ratios = themeContrast(draft);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api(base + "appearance"), api("branding")])
      .then(([s, b]) => {
        if (!cancelled) {
          setSettings(s);
          setPresetTheme(s.defaultTheme);
          setBrandName(b.name);
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
  async function save(next = settings) {
    await api(base + "appearance", "PUT", next);
    setSettings(next);
    onRefresh();
  }
  if (!canAdmin)
    return (
      <section className="panel">
        <h2>Appearance & card themes</h2>
        <p>
          Use the App theme dropdown in Display preferences above. Ask an
          organization administrator to configure card styles and defaults.
        </p>
      </section>
    );
  return (
    <section className="panel appearance-settings">
      <h2>Appearance & card themes</h2>
      <PrintSettings
        org={org}
        superAdmin={superAdmin}
        settings={settings}
        onChange={setSettings}
      />
      <p>
        Select a dashboard default, manage card styles and lock card colours.
        Your display preference is personal; a card lock overrides personal
        colour choices for newly generated cards.
      </p>
      <div className="two-columns">
        <label>
          Default dashboard theme
          <select
            aria-label="Default dashboard theme"
            value={settings.defaultTheme}
            disabled={busy}
            onChange={(e) =>
              setSettings({ ...settings, defaultTheme: e.target.value })
            }
          >
            {Object.entries(themes).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Locked card theme
          <select
            aria-label="Locked card theme"
            value={settings.lockedTheme}
            disabled={busy}
            onChange={(e) =>
              setSettings({ ...settings, lockedTheme: e.target.value })
            }
          >
            {Object.entries(themes).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.locked}
          disabled={busy}
          onChange={(e) =>
            setSettings({ ...settings, locked: e.target.checked })
          }
        />
        Lock card colours for this organization
      </label>
      <h3>Default General template</h3>
      <div className="two-columns">
        {Object.entries(generalCardTypes).map(([key, label]) => (
          <label key={key}>
            {label} default template
            <select
              aria-label={`${label} default template`}
              value={settings.defaults[key as CardType] || ""}
              disabled={busy}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: {
                    ...settings.defaults,
                    [key]: e.target.value || undefined,
                  },
                })
              }
            >
              <option value="">Choose manually</option>
              {templates
                .filter(
                  (t) =>
                    !t.archived &&
                    (t.card_type === key ||
                      t.card_type === "shared" ||
                      t.card_type === "general"),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <button
        disabled={busy}
        onClick={() =>
          void task(async () => {
            await save();
            setMessage("Appearance defaults and card lock saved.");
          })
        }
      >
        Save appearance settings
      </button>
      <hr />
      <h3>One General card template</h3>
      <p>
        One General design for everyone. Choose the fields and mandatory rules
        below. The template includes photos, signatures, codes, themes and both
        sides. Creating again rebuilds the design from your current rules as a
        new version.
      </p>
      <div className="two-columns">
        <label>
          Preset theme
          <select
            aria-label="Preset theme"
            value={presetTheme}
            disabled={busy}
            onChange={(e) => setPresetTheme(e.target.value)}
          >
            {Object.entries(themes).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={makeDefault}
          onChange={(e) => setMakeDefault(e.target.checked)}
        />
        Use General as the default template
      </label>
      <button
        disabled={busy}
        onClick={() =>
          void task(async () => {
            await save();
            const created = await api(base + "appearance", "POST", {
              shared: true,
              general: true,
              theme: presetTheme,
            });
            if (makeDefault)
              await save({
                ...settings,
                defaults: Object.fromEntries(
                  Object.keys(cardTypes).map((kind) => [kind, created.id]),
                ),
              });
            onRefresh();
            setMessage(
              "General template saved. Open Templates to edit or preview it.",
            );
          })
        }
      >
        Create / update General template
      </button>
      <details>
        <summary>Custom institution theme</summary>
        <p>
          Save colours, logo position, font and visible fields without changing
          code. Mandatory card fields are always retained. Minimum text contrast
          is 4.5:1; QR and barcode areas remain black on white.
        </p>
        <label>
          Start from theme
          <select
            aria-label="Start from theme"
            onChange={(e) => setDraft(structuredClone(themes[e.target.value]))}
          >
            {Object.entries(themes).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="two-columns">
          <label>
            Custom theme key
            <input
              value={customKey}
              pattern="[a-z][a-z0-9_-]{0,39}"
              maxLength={40}
              onChange={(e) => setCustomKey(e.target.value)}
            />
          </label>
          <label>
            Theme display name
            <input
              value={draft.name}
              maxLength={60}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
        </div>
        <div className="theme-colours">
          {(
            [
              "paper",
              "surface",
              "ink",
              "muted",
              "accent",
              "line",
              "mint",
              "cardAccent",
              "cardBackground",
              "cardText",
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                {
                  paper: "Page background",
                  surface: "Panel background",
                  ink: "Dashboard text",
                  muted: "Secondary text",
                  accent: "Links and buttons",
                  line: "Borders",
                  mint: "Selected items",
                  cardAccent: "Card heading background",
                  cardBackground: "Card background",
                  cardText: "Card text",
                }[key]
              }
              <input
                type="color"
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="two-columns">
          <label>
            Card and dashboard font
            <select
              value={draft.font}
              onChange={(e) =>
                setDraft({ ...draft, font: e.target.value as AppTheme["font"] })
              }
            >
              {["DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>
            Card logo position
            <select
              value={draft.logoPosition}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  logoPosition: e.target.value as AppTheme["logoPosition"],
                })
              }
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
        <div className="contrast-grid">
          {Object.entries(ratios).map(([label, value]) => (
            <span key={label} className={value >= 4.5 ? "notice" : "error"}>
              {label}: {value.toFixed(2)}:1{" "}
              {value >= 4.5 ? "Pass" : "Needs more contrast"}
            </span>
          ))}
        </div>
        <div
          className="theme-sample"
          style={{
            background: draft.cardBackground,
            color: draft.cardText,
            borderColor: draft.line,
          }}
        >
          <strong style={{ background: draft.cardAccent, color: "#ffffff" }}>
            Card heading preview
          </strong>
          <p>Full name · Employee / Student / Pass ID</p>
          <small>Card colours remain fixed in generated snapshots.</small>
        </div>
        <label>
          Visible fields for
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CardType)}
          >
            {Object.entries(cardTypes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="theme-field-list">
          {generalCardFields.map((f) => (
            <label className="check" key={f.key}>
              <input
                type="checkbox"
                checked={(
                  draft.fields[kind] || cardFieldCatalog[kind].map((v) => v.key)
                ).includes(f.key)}
                disabled={["name", "external_id"].includes(f.key)}
                onChange={(e) => {
                  const keys =
                    draft.fields[kind] ||
                    cardFieldCatalog[kind].map((v) => v.key);
                  setDraft({
                    ...draft,
                    fields: {
                      ...draft.fields,
                      [kind]: e.target.checked
                        ? [...new Set([...keys, f.key])]
                        : keys.filter((k) => k !== f.key),
                    },
                  });
                }}
              />
              {f.label}
            </label>
          ))}
        </div>
        <button
          disabled={busy || Object.values(ratios).some((v) => v < 4.5)}
          onClick={() =>
            void task(async () => {
              if (
                !/^[a-z][a-z0-9_-]{0,39}$/.test(customKey) ||
                customKey in builtInThemes
              )
                throw new Error(
                  "Choose a unique custom key, such as institution or campus-blue.",
                );
              const next = {
                ...settings,
                customThemes: { ...settings.customThemes, [customKey]: draft },
              };
              await save(next);
              setMessage(
                "Custom theme saved and available in the Organization display preferences.",
              );
            })
          }
        >
          Save custom theme
        </button>
      </details>
      {superAdmin && (
        <details>
          <summary>Application name & logo (all organizations)</summary>
          <p>
            The uploaded image is public on the sign-in page and appears in the
            application sidebar. Card logos are managed separately in Card
            fields or the template designer.
          </p>
          <label>
            Application name
            <input
              value={brandName}
              maxLength={60}
              onChange={(e) => setBrandName(e.target.value)}
            />
          </label>
          <label>
            Upload application logo
            <input
              aria-label="Upload application logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void task(async () => {
                    await api(
                      `branding?org=${org}&name=${encodeURIComponent(brandName)}`,
                      "POST",
                      file,
                      true,
                    );
                    onBranding();
                    setMessage(
                      "Application logo uploaded. The sign-in page and sidebar now use it.",
                    );
                  });
              }}
            />
          </label>
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  await api(`branding?org=${org}`, "PUT", { name: brandName });
                  onBranding();
                  setMessage("Application name saved.");
                })
              }
            >
              Save application name
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  await api(`branding?org=${org}`, "PUT", {
                    name: brandName,
                    resetLogo: true,
                  });
                  onBranding();
                  setMessage("Application logo reset.");
                })
              }
            >
              Reset application logo
            </button>
          </div>
        </details>
      )}
      {message && <p className="notice">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
