import { z } from "zod";
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";
export function validTimeZone(zone: string) {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export const timeSettingsSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .max(100)
    .refine(validTimeZone, "Choose a valid IANA time zone.")
    .default(DEFAULT_TIME_ZONE),
  hour12: z.boolean().default(true),
});
export type TimeSettings = z.infer<typeof timeSettingsSchema>;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let result = formatters.get(zone);
  if (!result) {
    result = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 64)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(zone, result);
  }
  return result;
}
export function toWallTime(
  value: string | number | Date,
  zone: string,
  seconds = false,
) {
  const p = Object.fromEntries(
    formatter(zone)
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}${seconds ? ":" + p.second : ""}`;
}
export function wallTimeToInstant(value: string, zone: string) {
  if (!validTimeZone(zone))
    throw new Error("Choose a valid organization time zone.");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!parts) throw new Error("Enter a complete date and time.");
  const [, year, month, day, hour, minute, second = "00"] = parts;
  const stamp = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
    wall = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (
    +year < 1000 ||
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 19) !== wall
  )
    throw new Error("Enter a valid date and time.");
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const sample = stamp + hours * 3600000;
    offsets.add(Date.parse(toWallTime(sample, zone, true) + "Z") - sample);
  }
  const candidates = [...offsets]
    .map((offset) => stamp - offset)
    .filter((candidate) => toWallTime(candidate, zone, true) === wall);
  if (!candidates.length)
    throw new Error(
      "This clock time does not exist because of daylight saving. Choose another time.",
    );
  if (candidates.length > 1)
    throw new Error(
      "This clock time occurs twice because of daylight saving. Choose an unambiguous time.",
    );
  return new Date(candidates[0]).toISOString();
}
export function formatOrganizationTime(
  value: string | number | Date,
  settings: TimeSettings,
  seconds = false,
) {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: settings.timeZone,
      dateStyle: "medium",
      timeStyle: seconds ? "medium" : "short",
      hour12: settings.hour12,
    }).format(new Date(value)) + ` (${settings.timeZone})`
  );
}
export function formatOrganizationDate(
  value: string | number | Date,
  settings: TimeSettings,
) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: settings.timeZone,
    dateStyle: "medium",
  }).format(new Date(value));
}
export function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    dateStyle: "medium",
  }).format(new Date(value.slice(0, 10) + "T00:00:00Z"));
}
export function normalizeLocalAnswers(
  fields: { key: string; type: string }[],
  raw: Record<string, unknown>,
  zone: string,
) {
  const result = { ...raw };
  for (const field of fields) {
    const value = result[field.key];
    if (
      field.type === "datetime-local" &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
    )
      result[field.key] = wallTimeToInstant(value, zone);
  }
  return result;
}
