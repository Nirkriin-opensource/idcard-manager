"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { printLanguages, legacyFonts } from "../core/printing";
import type { Appearance } from "../core/themes";
export default function PrintSettings({
  org,
  superAdmin,
  settings,
  onChange,
}: {
  org: string;
  superAdmin: boolean;
  settings: Appearance;
  onChange: (next: Appearance) => void;
}) {
  const [fonts, setFonts] = useState<string[]>(legacyFonts),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = () =>
    api("fonts").then((c) =>
      setFonts([
        ...new Set<string>([
          ...legacyFonts,
          ...c.fonts.map((f: { family: string }) => f.family),
        ]),
      ]),
    );
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);
  const change = (key: string, value: string) =>
    onChange({
      ...settings,
      printing: { ...settings.printing, [key]: value || undefined },
    });
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const result = (await action()) as { imported?: number };
      await refresh();
      setMessage(
        result.imported !== undefined
          ? `${result.imported} PC font files synced. Font choices are ready.`
          : "Font uploaded and available for printing.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>Card printing languages & PC fonts</legend>
      <p>
        English is the primary language by default. Enter card text in the
        languages you need; text is printed as entered, without automatic
        translation. Save appearance defaults after changing these choices.
      </p>
      <div className="form-grid">
        <label>
          Primary print language
          <select
            aria-label="Primary print language"
            value={settings.printing.language}
            onChange={(e) => change("language", e.target.value)}
          >
            {printLanguages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Additional print language
          <select
            aria-label="Additional print language"
            value={settings.printing.secondaryLanguage || ""}
            onChange={(e) => change("secondaryLanguage", e.target.value)}
          >
            <option value="">None</option>
            {printLanguages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {(["font", "secondaryFont"] as const).map((key, i) => (
          <label key={key}>
            {i ? "Additional language font" : "Primary print font"}
            <select
              aria-label={i ? "Additional language font" : "Primary print font"}
              value={settings.printing[key] || ""}
              onChange={(e) => change(key, e.target.value)}
            >
              <option value="">Follow card theme</option>
              {fonts.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {superAdmin && (
        <div className="actions">
          <button
            type="button"
            onClick={() => run(() => api(`fonts/sync?org=${org}`, "POST"))}
          >
            Sync fonts from PC
          </button>
          <label className="button">
            Upload font file
            <input
              aria-label="Upload print font"
              type="file"
              accept=".ttf,.otf,.ttc"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(() =>
                    api(
                      `fonts?org=${org}&filename=${encodeURIComponent(file.name)}`,
                      "POST",
                      file,
                      true,
                    ),
                  );
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      <p className="muted">
        {fonts.length} font families available. PC sync supports Windows and
        Windows 11 with Ubuntu WSL. On another server, upload your TTF, OTF or
        TTC font files. Missing characters are checked before printing.
      </p>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
