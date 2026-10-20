"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./client";
import {
  timeSettingsSchema,
  formatOrganizationTime,
  formatOrganizationDate,
  type TimeSettings,
} from "../core/organization-time";
const defaults = timeSettingsSchema.parse({});
const TimeContext = createContext({
  ...defaults,
  now: () => Date.now(),
  format: (value: string | number | Date) =>
    formatOrganizationTime(value, defaults),
  formatDate: (value: string | number | Date) =>
    formatOrganizationDate(value, defaults),
});
export function OrganizationTimeProvider({
  org,
  settings,
  children,
}: {
  org: string;
  settings: TimeSettings;
  children: ReactNode;
}) {
  const [clock, setClock] = useState<{
    epoch: number;
    monotonic: number;
  } | null>(null);
  useEffect(() => {
    if (!org) return;
    let live = true;
    setClock(null);
    const sync = () =>
      api(`orgs/${org}/time-settings`)
        .then((data) => {
          if (live)
            setClock({
              epoch: Date.parse(data.serverNow),
              monotonic: performance.now(),
            });
        })
        .catch(() => {});
    void sync();
    const timer = setInterval(() => void sync(), 60000);
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [org]);
  const value = useMemo(
    () => ({
      ...settings,
      now: () =>
        clock ? clock.epoch + performance.now() - clock.monotonic : Date.now(),
      format: (date: string | number | Date) =>
        formatOrganizationTime(date, settings),
      formatDate: (date: string | number | Date) =>
        formatOrganizationDate(date, settings),
    }),
    [settings, clock],
  );
  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
}
export const useOrganizationTime = () => useContext(TimeContext);
export default function OrganizationTimeSettings({
  org,
  canAdmin,
  onSaved,
}: {
  org: string;
  canAdmin: boolean;
  onSaved: (settings: TimeSettings) => void;
}) {
  const organization = useOrganizationTime();
  const [settings, setSettings] = useState<TimeSettings>(defaults),
    [zones, setZones] = useState<string[]>(["Asia/Kolkata", "UTC"]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [now, setNow] = useState(() => organization.now());
  useEffect(() => {
    let live = true;
    api(`orgs/${org}/time-settings`)
      .then((d) => {
        if (live) {
          setSettings(timeSettingsSchema.parse(d));
          setZones(d.zones);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [org]);
  useEffect(() => {
    const tick = () => setNow(organization.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [organization.now]);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = timeSettingsSchema.parse(
        await api(`orgs/${org}/time-settings`, "PUT", settings),
      );
      setSettings(saved);
      onSaved(saved);
      setNotice("Organization time settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Time management</h2>
      <p>
        Closing dates, submission times, logs and card issue dates use this
        organization’s time zone.
      </p>
      <p>
        <strong>Organization time: </strong>
        <output aria-label="Organization time">
          {formatOrganizationTime(now, settings, true)}
        </output>
      </p>
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
      <div className="two-columns">
        <label>
          Time zone
          <select
            aria-label="Organization time zone"
            value={settings.timeZone}
            disabled={busy || !canAdmin}
            onChange={(e) =>
              setSettings({ ...settings, timeZone: e.target.value })
            }
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone === "Asia/Kolkata"
                  ? "India Standard Time (IST) · Asia/Kolkata"
                  : zone}
              </option>
            ))}
          </select>
        </label>
        <label>
          Time display
          <select
            aria-label="Organization time display"
            value={settings.hour12 ? "12" : "24"}
            disabled={busy || !canAdmin}
            onChange={(e) =>
              setSettings({ ...settings, hour12: e.target.value === "12" })
            }
          >
            <option value="12">12-hour clock with AM / PM</option>
            <option value="24">24-hour clock</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Deadlines follow the server clock. Changing the time zone keeps existing
        deadlines at the same scheduled moment.
      </p>
      {canAdmin && (
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save time settings
        </button>
      )}
    </section>
  );
}
