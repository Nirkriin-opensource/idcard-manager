import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timeSettingsSchema,
  toWallTime,
  wallTimeToInstant,
  formatOrganizationTime,
  normalizeLocalAnswers,
} from "../src/core/organization-time.ts";
test("organization clock converts India wall times independently of the host zone", () => {
  assert.equal(timeSettingsSchema.parse({}).timeZone, "Asia/Kolkata");
  assert.equal(
    toWallTime("2026-10-19T21:20:00Z", "Asia/Kolkata"),
    "2026-10-20T02:50",
  );
  assert.equal(
    wallTimeToInstant("2026-10-20T14:50", "Asia/Kolkata"),
    "2026-10-20T09:20:00.000Z",
  );
  assert.equal(
    wallTimeToInstant("2026-10-20T02:50", "Asia/Kolkata"),
    "2026-10-19T21:20:00.000Z",
  );
  assert.equal(
    toWallTime("2026-10-19T20:00:00Z", "Asia/Kolkata").slice(0, 10),
    "2026-10-20",
  );
  assert.match(
    formatOrganizationTime(
      "2026-10-19T21:20:00Z",
      timeSettingsSchema.parse({}),
    ),
    /2:50\s*am/i,
  );
  assert.match(
    formatOrganizationTime(
      "2026-10-20T09:20:00Z",
      timeSettingsSchema.parse({ hour12: false }),
    ),
    /14:50/,
  );
});
test("organization wall times reject invalid dates, DST gaps and ambiguous clock times", () => {
  assert.throws(() => wallTimeToInstant("2026-02-30T14:00", "Asia/Kolkata"));
  assert.throws(() => wallTimeToInstant("2026-10-20T24:00", "Asia/Kolkata"));
  assert.throws(
    () => wallTimeToInstant("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => wallTimeToInstant("2026-11-01T01:30", "America/New_York"),
    /occurs twice/,
  );
  assert.equal(
    wallTimeToInstant("2026-03-08T03:30", "America/New_York"),
    "2026-03-08T07:30:00.000Z",
  );
  assert.equal(
    timeSettingsSchema.safeParse({ timeZone: "Asia/Fake" }).success,
    false,
  );
});
test("datetime answers use the organization's clock and explicit instants stay unchanged", () => {
  const fields = [
    { key: "valid_until", type: "datetime-local" },
    { key: "birth_date", type: "date" },
  ];
  const normalized = normalizeLocalAnswers(
    fields,
    { valid_until: "2026-10-20T14:50", birth_date: "2000-01-02" },
    "Asia/Kolkata",
  );
  assert.equal(normalized.valid_until, "2026-10-20T09:20:00.000Z");
  assert.equal(normalized.birth_date, "2000-01-02");
  assert.equal(
    normalizeLocalAnswers(
      fields,
      { valid_until: "2026-10-20T14:50Z" },
      "Asia/Kolkata",
    ).valid_until,
    "2026-10-20T14:50Z",
  );
});
